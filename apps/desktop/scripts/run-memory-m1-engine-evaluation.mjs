#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  evaluateResults,
  loadCorpus,
  materializeLocator,
  queryCases,
  validateCorpus,
} from "./memory-m1-fixtures.mjs";

const API_VERSION = "1.8";

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option);
  if (index < 0) return undefined;
  if (!argumentsList[index + 1]) throw new Error(`${option} requires a value.`);
  return argumentsList[index + 1];
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-memory-m1-engine-evaluation.mjs --engine-cli PATH --partition development|held-out --results PATH --report PATH",
    "",
    "Runs the frozen synthetic corpus through a built Memory Engine Admin API 1.8 service.",
    "It creates and deletes only an isolated temporary Git/data fixture.",
  ].join("\n");
}

function run(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    shell: false,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return run("git", args, cwd);
}

function initializeGitRepository(root, branch) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "m1-fixture@invalid.example");
  git(root, "config", "user.name", "M1 Fixture");
  git(root, "checkout", "-q", "-b", branch);
}

function writeFixtureSources(root, cards) {
  for (const card of cards) {
    const path = join(root, card.source.relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, card.source.markdown, "utf8");
  }
}

function initializeMemoryProject(nodePath, cliPath, dataRoot, projectRoot) {
  run(nodePath, [cliPath, "init"], projectRoot, { POLARBEAR_MEMORY_DATA_DIR: dataRoot });
}

async function waitForPath(path, timeoutMs = 5_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function startEngine(nodePath, cliPath, dataRoot) {
  const child = spawn(nodePath, [cliPath, "service", "run"], {
    env: { ...process.env, POLARBEAR_MEMORY_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
  const socketPath = join(dataRoot, "service", "admin-v1.sock");
  try {
    await waitForPath(socketPath, 10_000);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\nEngine exit code: ${child.exitCode ?? "running"}\n${diagnostics}`);
  }
  return {
    child,
    socketPath,
    token: readFileSync(join(dataRoot, "service", "admin-v1.token"), "utf8").trim(),
    diagnostics: () => diagnostics,
  };
}

async function stopEngine(engine, request) {
  await request("system.shutdown", {});
  if (engine.child.exitCode !== null) return;
  await new Promise((resolveStop, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Memory Engine did not stop.\n${engine.diagnostics()}`));
    }, 5_000);
    engine.child.once("close", () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}

function adminRequest(engine, projectRoot, method, params) {
  return new Promise((resolveRequest, reject) => {
    const id = `m1-eval-${process.pid}-${crypto.randomUUID()}`;
    const socket = createConnection(engine.socketPath);
    let output = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { output += chunk; });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const envelope = JSON.parse(output);
        if (envelope.id !== id) throw new Error("Memory Engine returned a mismatched response ID.");
        if (!envelope.ok) {
          throw new Error(`${envelope.error?.code ?? "MEMORY_ERROR"}: ${envelope.error?.message ?? "Request failed."}`);
        }
        resolveRequest(envelope.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("connect", () => socket.end(`${JSON.stringify({
      id,
      apiVersion: API_VERSION,
      token: engine.token,
      method,
      params: {
        ...(projectRoot ? { projectRoot } : {}),
        ...params,
      },
    })}\n`));
  });
}

async function createTask(request, projectRoot, title) {
  return request(projectRoot, "tasks.create", {
    title,
    objective: `Synthetic M1 evaluation task: ${title}`,
  });
}

async function captureCorpus(request, projectRoot, cards, taskIds) {
  const runtimeToOracle = new Map();
  const oracleToRuntime = new Map();
  const context = await request(projectRoot, "projects.context", {});
  for (const card of cards) {
    const locator = materializeLocator(card.source);
    const registered = await request(projectRoot, "sources.register", {
      worktreeId: context.worktreeId,
      relativePath: card.source.relativePath,
      startLine: locator.startLine,
      endLine: locator.endLine,
      startOffset: locator.startOffset,
      endOffset: locator.endOffset,
      selectedText: locator.selectedText,
      requestId: `register-${card.id}`,
    });
    let runtimeCard = await request(projectRoot, "knowledge.capture", {
      ownerKind: card.owner.kind,
      ...(card.owner.kind === "TASK" ? { taskId: taskIds[card.owner.id] } : {}),
      topicKey: card.topicKey,
      kind: card.kind,
      answer: card.claim.answer,
      appliesWhen: card.applicability.appliesWhen,
      reason: card.claim.reason,
      workingCopyPolicy: "CAPTURED_CONTEXT",
      sourceId: registered.source.id,
      sourceRevision: registered.observedRevision,
      sectionDigest: registered.approvedSection.sectionDigest,
      validationDigest: registered.approvedSection.validationDigest,
      ...registered.approvedSection.locator,
      requestId: `capture-${card.id}`,
    });
    if (card.applicability.workingCopyPolicy === "COMPATIBLE_SOURCES") {
      runtimeCard = await request(projectRoot, "knowledge.review", {
        cardId: runtimeCard.id,
        ...(card.owner.kind === "TASK" ? { taskId: taskIds[card.owner.id] } : {}),
        expectedRevision: runtimeCard.revision,
        expectedSourceVersion: registered.source.version,
        expectedObservedRevision: registered.observedRevision,
        answer: card.claim.answer,
        appliesWhen: card.applicability.appliesWhen,
        reason: card.claim.reason,
        workingCopyPolicy: "COMPATIBLE_SOURCES",
        ...registered.approvedSection.locator,
        requestId: `review-${card.id}`,
      });
    }
    runtimeToOracle.set(runtimeCard.id, card.id);
    oracleToRuntime.set(card.id, runtimeCard);
  }
  return { runtimeToOracle, oracleToRuntime };
}

function applyMutation(root, card) {
  const path = join(root, card.source.relativePath);
  const mutation = card.mutation;
  if (mutation.operation === "DELETE_SOURCE") {
    unlinkSync(path);
    return;
  }
  let changed = card.source.markdown;
  if (mutation.operation === "REPLACE_SELECTION" || mutation.operation === "SAME_LENGTH_REWRITE") {
    changed = changed.replace(card.source.locator.selectedText, mutation.replacement);
  } else if (mutation.operation === "CHANGE_QUALIFIER" || mutation.operation === "CHANGE_PREREQUISITE") {
    changed = changed.replace(card.source.locator.qualifierText, mutation.replacement);
  } else if (mutation.operation === "CHANGE_HEADING") {
    changed = changed.replace("# Rule", mutation.replacement);
  } else if (mutation.operation === "UNRELATED_EDIT") {
    changed = `${changed.trimEnd()}\n\n${mutation.replacement}\n`;
  } else if (mutation.operation === "DUPLICATE_SELECTION") {
    changed = `${changed.trimEnd()}\n\n# Duplicate\n\n${card.source.locator.selectedText}\n`;
  } else {
    throw new Error(`Unsupported mutation: ${mutation.operation}`);
  }
  writeFileSync(path, changed, "utf8");
}

function restoreSource(root, card) {
  const path = join(root, card.source.relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, card.source.markdown, "utf8");
}

function observedHit(hit, runtimeToOracle) {
  return {
    cardId: runtimeToOracle.get(hit.card.id) ?? `unknown:${hit.card.id}`,
    decision: hit.decision,
    rank: hit.rank,
    reasonCodes: hit.reasonCodes,
  };
}

async function runQueries({
  request,
  cases,
  contexts,
  cardsById,
  runtimeToOracle,
}) {
  const observations = [];
  for (const query of cases) {
    const target = contexts[query.request.id];
    const mutationCard = query.mutationCardId ? cardsById.get(query.mutationCardId) : undefined;
    if (mutationCard) applyMutation(target.root, mutationCard);
    try {
      const started = performance.now();
      const result = await request(target.root, "knowledge.search", {
        query: query.text,
        ...(query.request.taskId === null ? {} : { taskId: target.taskId }),
        limit: 5,
      });
      const initialResponseMs = performance.now() - started;
      const items = result.items.map((hit) => observedHit(hit, runtimeToOracle));
      const reviewNotices = result.reviewNotices.map((hit) => observedHit(hit, runtimeToOracle));
      let evidenceOpen;
      if (query.evidenceCheck && result.items[0]) {
        const hit = result.items[0];
        const resolved = await request(target.root, "sources.resolve", {
          cardId: hit.card.id,
          expectedCardRevision: hit.card.revision,
          ...(query.request.taskId === null ? {} : { taskId: target.taskId }),
        });
        const oracleId = runtimeToOracle.get(hit.card.id);
        const oracleCard = oracleId ? cardsById.get(oracleId) : undefined;
        const section = resolved.observedSection ?? resolved.approvedSection;
        if (oracleCard && section) {
          const currentSource = readFileSync(join(target.root, resolved.source.relativePath), "utf8");
          evidenceOpen = {
            cardId: oracleId,
            relativePath: resolved.source.relativePath,
            startLine: section.locator.startLine,
            endLine: section.locator.endLine,
            selectedText: section.excerpt,
            qualifierText: currentSource.includes(oracleCard.source.locator.qualifierText)
              ? oracleCard.source.locator.qualifierText
              : null,
          };
        }
      }
      observations.push({
        queryId: query.id,
        items,
        reviewNotices,
        partial: result.partial,
        initialResponseMs,
        usableResponseMs: performance.now() - started,
        ...(evidenceOpen ? { evidenceOpen } : {}),
      });
    } finally {
      if (mutationCard) restoreSource(target.root, mutationCard);
    }
  }
  return observations;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help")) {
    console.log(usage());
    return;
  }
  const cliPath = resolve(optionValue(argumentsList, "--engine-cli") ?? "");
  const nodePath = resolve(optionValue(argumentsList, "--engine-node") ?? process.execPath);
  const partition = optionValue(argumentsList, "--partition");
  const resultsPath = resolve(optionValue(argumentsList, "--results") ?? "");
  const reportPath = resolve(optionValue(argumentsList, "--report") ?? "");
  if (!cliPath || !partition || !resultsPath || !reportPath) throw new Error(usage());
  if (!existsSync(cliPath)) throw new Error(`Engine CLI does not exist: ${cliPath}`);
  const loaded = loadCorpus(optionValue(argumentsList, "--corpus"));
  validateCorpus(loaded.corpus, loaded);
  const fixtureRoot = mkdtempSync(join("/tmp", "pbm-m1-eval-"));
  const dataRoot = join(fixtureRoot, "data");
  const alphaRoot = join(fixtureRoot, "alpha");
  const alphaMainRoot = join(fixtureRoot, "alpha-main");
  const alphaDivergedRoot = join(fixtureRoot, "alpha-diverged");
  const betaRoot = join(fixtureRoot, "beta");
  let engine;
  try {
    initializeGitRepository(alphaRoot, "feature/reliability");
    writeFixtureSources(alphaRoot, loaded.corpus.cards);
    git(alphaRoot, "add", "docs");
    git(alphaRoot, "commit", "-q", "-m", "Freeze M1 source corpus");
    git(alphaRoot, "branch", "main");
    git(alphaRoot, "branch", "feature/diverged");
    git(alphaRoot, "worktree", "add", "-q", alphaMainRoot, "main");
    git(alphaRoot, "worktree", "add", "-q", alphaDivergedRoot, "feature/diverged");
    initializeMemoryProject(nodePath, cliPath, dataRoot, alphaRoot);
    for (const worktree of [alphaMainRoot, alphaDivergedRoot]) {
      mkdirSync(join(worktree, ".polarbear"), { recursive: true });
      copyFileSync(join(alphaRoot, ".polarbear", "config.toml"), join(worktree, ".polarbear", "config.toml"));
    }

    initializeGitRepository(betaRoot, "main");
    writeFileSync(join(betaRoot, "README.md"), "# Isolated beta fixture\n", "utf8");
    git(betaRoot, "add", "README.md");
    git(betaRoot, "commit", "-q", "-m", "Initialize isolated project");
    initializeMemoryProject(nodePath, cliPath, dataRoot, betaRoot);

    engine = await startEngine(nodePath, cliPath, dataRoot);
    let request = (projectRoot, method, params) => adminRequest(engine, projectRoot, method, params);
    const taskA = await createTask(request, alphaRoot, "Task A");
    const taskB = await createTask(request, alphaRoot, "Task B");
    const taskC = await createTask(request, betaRoot, "Task C");
    const mappings = await captureCorpus(request, alphaRoot, loaded.corpus.cards, {
      "task-a": taskA.id,
      "task-b": taskB.id,
    });

    await stopEngine(engine, (method, params) => adminRequest(engine, "", method, params));
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    engine = await startEngine(nodePath, cliPath, dataRoot);
    request = (projectRoot, method, params) => adminRequest(engine, projectRoot, method, params);

    const contexts = {
      "alpha-task-a-feature": { id: "alpha-task-a-feature", root: alphaRoot, taskId: taskA.id },
      "alpha-task-b-feature": { id: "alpha-task-b-feature", root: alphaRoot, taskId: taskB.id },
      "alpha-task-a-main": { id: "alpha-task-a-main", root: alphaMainRoot, taskId: taskA.id },
      "alpha-task-a-diverged": { id: "alpha-task-a-diverged", root: alphaDivergedRoot, taskId: taskA.id },
      "beta-task-c-main": { id: "beta-task-c-main", root: betaRoot, taskId: taskC.id },
    };
    const cardsById = new Map(loaded.corpus.cards.map((card) => [card.id, card]));
    const requestCases = queryCases(loaded.corpus, partition).map((query) => ({
      id: query.id,
      text: query.text,
      class: query.class,
      request: { id: query.request.id ?? query.contextId, taskId: query.request.taskId },
      mutationCardId: query.mutationCardId,
      evidenceCheck: query.evidenceCheck,
    }));
    const observations = await runQueries({
      request,
      cases: requestCases,
      contexts,
      cardsById,
      runtimeToOracle: mappings.runtimeToOracle,
    });
    const serializedResults = observations.map((observation) => JSON.stringify(observation)).join("\n") + "\n";
    mkdirSync(dirname(resultsPath), { recursive: true });
    writeFileSync(resultsPath, serializedResults, "utf8");
    const report = {
      generatedAt: new Date().toISOString(),
      engineCli: cliPath,
      corpusPath: loaded.path,
      corpusSha256: loaded.sha256,
      ...evaluateResults(loaded.corpus, partition, observations, {
        requireEvidence: true,
        requireLatency: true,
      }),
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.overall !== "PASS") process.exitCode = 1;
  } finally {
    if (engine && engine.child.exitCode === null) {
      try {
        await adminRequest(engine, "", "system.shutdown", {});
        await once(engine.child, "exit");
      } catch {
        engine.child.kill();
      }
    }
    if (!argumentsList.includes("--keep-fixture")) rmSync(fixtureRoot, { recursive: true, force: true });
    else console.error(`Kept fixture: ${fixtureRoot}`);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
