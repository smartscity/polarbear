import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const defaultCorpusPath = resolve(
  scriptDirectory,
  "../fixtures/long-memory-m1/corpus.v1.json",
);

const decisions = new Set([
  "REUSABLE",
  "NEEDS_REVIEW",
  "VALIDATION_PENDING",
  "INAPPLICABLE",
  "NOT_RELEVANT",
  "DENIED",
]);

const mutationOperations = new Set([
  "REPLACE_SELECTION",
  "CHANGE_QUALIFIER",
  "CHANGE_HEADING",
  "CHANGE_PREREQUISITE",
  "UNRELATED_EDIT",
  "DELETE_SOURCE",
  "DUPLICATE_SELECTION",
  "SAME_LENGTH_REWRITE",
]);

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function normalized(text) {
  return text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function occurrenceIndexes(text, needle) {
  const indexes = [];
  let offset = 0;
  while (offset <= text.length) {
    const found = text.indexOf(needle, offset);
    if (found < 0) break;
    indexes.push(found);
    offset = found + Math.max(needle.length, 1);
  }
  return indexes;
}

export function materializeLocator(source) {
  const indexes = occurrenceIndexes(source.markdown, source.locator.selectedText);
  const occurrenceIndex = source.locator.occurrence - 1;
  const startOffset = indexes[occurrenceIndex];
  if (startOffset === undefined) {
    throw new Error(`Selected evidence does not have occurrence ${source.locator.occurrence}.`);
  }
  const endOffset = startOffset + source.locator.selectedText.length;
  const startLine = source.markdown.slice(0, startOffset).split("\n").length;
  const endLine = startLine + source.locator.selectedText.split("\n").length - 1;
  return {
    headingPath: source.locator.headingPath,
    startLine,
    endLine,
    startOffset,
    endOffset,
    selectedText: source.locator.selectedText,
    qualifierText: source.locator.qualifierText,
  };
}

export function loadCorpus(path = defaultCorpusPath) {
  const bytes = readFileSync(path);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    corpus: JSON.parse(bytes.toString("utf8")),
  };
}

export function validateCorpus(corpus, metadata = {}) {
  const errors = [];
  assert(corpus.schemaVersion === 1, "schemaVersion must be 1.", errors);
  assert(typeof corpus.corpusId === "string" && corpus.corpusId.length > 0, "corpusId is required.", errors);
  assert(!Number.isNaN(Date.parse(corpus.frozenAt)), "frozenAt must be an ISO timestamp.", errors);
  assert(corpus.offsetBasis === "UTF16", "offsetBasis must be UTF16.", errors);
  assert(
    corpus.policy?.compatibleSourcesState === "EXPLICITLY_REVIEWED",
    "COMPATIBLE_SOURCES fixtures must represent an explicitly reviewed state.",
    errors,
  );
  assert(Array.isArray(corpus.contexts) && corpus.contexts.length >= 5, "At least five contexts are required.", errors);
  assert(Array.isArray(corpus.cards) && corpus.cards.length >= 30, "At least 30 cards are required.", errors);
  assert(Array.isArray(corpus.negativeQueries), "negativeQueries must be an array.", errors);

  const contexts = new Map();
  for (const context of corpus.contexts ?? []) {
    assert(!contexts.has(context.id), `Duplicate context ID: ${context.id}`, errors);
    contexts.set(context.id, context);
    for (const field of ["projectId", "taskId", "worktreeId", "branch"]) {
      assert(typeof context[field] === "string" && context[field].length > 0, `Context ${context.id} lacks ${field}.`, errors);
    }
  }

  const ids = new Set();
  const topicKeys = new Set();
  const sourcePaths = new Set();
  const queryTextsByPartition = { development: new Set(), "held-out": new Set() };
  const materializedLocators = {};
  const operationCoverage = new Set();
  let chineseDevelopment = 0;
  let chineseHeldOut = 0;

  for (const [cardIndex, card] of (corpus.cards ?? []).entries()) {
    const label = card.id ?? `card at index ${cardIndex}`;
    assert(/^m1-\d{3}$/u.test(card.id), `${label} must use an m1-NNN ID.`, errors);
    assert(!ids.has(card.id), `Duplicate card ID: ${card.id}`, errors);
    ids.add(card.id);
    assert(typeof card.topicKey === "string" && card.topicKey.length > 0, `${label} lacks topicKey.`, errors);
    assert(!topicKeys.has(card.topicKey), `Duplicate topicKey: ${card.topicKey}`, errors);
    topicKeys.add(card.topicKey);
    assert([
      "DECISION",
      "PITFALL",
      "FACT",
      "CONSTRAINT",
      "ARCHITECTURE",
      "CONVENTION",
      "WORKAROUND",
    ].includes(card.kind), `${label} has an unsupported kind.`, errors);
    assert(["TASK", "PROJECT"].includes(card.owner?.kind), `${label} has an invalid owner kind.`, errors);
    assert(typeof card.owner?.id === "string" && card.owner.id.length > 0, `${label} lacks owner ID.`, errors);
    assert(["CAPTURED_CONTEXT", "COMPATIBLE_SOURCES"].includes(card.applicability?.workingCopyPolicy), `${label} has an invalid working-copy policy.`, errors);
    const context = contexts.get(card.applicability?.contextId);
    assert(Boolean(context), `${label} references an unknown context.`, errors);
    if (context && card.owner?.kind === "TASK") {
      assert(card.owner.id === context.taskId, `${label} task owner does not match its capture context.`, errors);
    }
    if (context && card.owner?.kind === "PROJECT") {
      assert(card.owner.id === context.projectId, `${label} project owner does not match its capture context.`, errors);
    }
    assert(typeof card.claim?.answer === "string" && card.claim.answer.length >= 20, `${label} has no usable answer.`, errors);
    assert(typeof card.claim?.reason === "string" && card.claim.reason.length >= 20, `${label} has no usable reason.`, errors);
    assert(typeof card.applicability?.appliesWhen === "string" && card.applicability.appliesWhen.length >= 20, `${label} has no use condition.`, errors);
    assert(/^docs\//u.test(card.source?.relativePath ?? ""), `${label} source path must be a fixture-relative docs path.`, errors);
    assert(!sourcePaths.has(card.source?.relativePath), `Duplicate source path: ${card.source?.relativePath}`, errors);
    sourcePaths.add(card.source?.relativePath);
    assert(/^[0-9a-f]{40}$/u.test(card.source?.commit ?? ""), `${label} source commit must be a fixed 40-character hex value.`, errors);
    assert(typeof card.source?.markdown === "string" && card.source.markdown.length > 0, `${label} lacks frozen source bytes.`, errors);
    assert(card.source?.markdown.includes(card.source?.locator?.qualifierText ?? "__missing__"), `${label} qualifier is not in the frozen source.`, errors);
    const occurrences = occurrenceIndexes(card.source?.markdown ?? "", card.source?.locator?.selectedText ?? "");
    assert(occurrences.length === 1, `${label} selected evidence must occur exactly once before mutation.`, errors);
    try {
      const locator = materializeLocator(card.source);
      materializedLocators[card.id] = locator;
      assert(locator.startLine === card.source.locator.startLine, `${label} startLine does not match frozen bytes.`, errors);
      assert(locator.endLine === card.source.locator.endLine, `${label} endLine does not match frozen bytes.`, errors);
      const heading = card.source.locator.headingPath?.at(-1);
      assert(card.source.markdown.startsWith(`# ${heading}\n`), `${label} headingPath does not identify the source heading.`, errors);
    } catch (error) {
      errors.push(`${label} locator failed: ${error.message}`);
    }
    assert(mutationOperations.has(card.mutation?.operation), `${label} has an unsupported mutation operation.`, errors);
    operationCoverage.add(card.mutation?.operation);
    assert(decisions.has(card.mutation?.expectedDecision), `${label} mutation has an invalid expected decision.`, errors);
    assert(Array.isArray(card.mutation?.expectedReasonCodes) && card.mutation.expectedReasonCodes.length > 0, `${label} mutation requires reason codes.`, errors);
    assert(typeof card.performanceClass === "string" && card.performanceClass.length > 0, `${label} lacks a performance class.`, errors);

    for (const partition of ["development", "held-out"]) {
      const queryKey = partition === "held-out" ? "heldOut" : partition;
      const queries = card.queries?.[queryKey];
      assert(Array.isArray(queries) && queries.length === 3, `${label} requires exactly three ${partition} queries.`, errors);
      const kinds = new Set();
      const localTexts = new Set();
      for (const query of queries ?? []) {
        assert(typeof query.kind === "string" && query.kind.length > 0, `${label} ${partition} query lacks kind.`, errors);
        assert(!kinds.has(query.kind), `${label} repeats a ${partition} query kind.`, errors);
        kinds.add(query.kind);
        const text = normalized(query.text ?? "");
        assert(text.length >= 8, `${label} has a too-short ${partition} query.`, errors);
        assert(!localTexts.has(text), `${label} repeats ${partition} wording.`, errors);
        localTexts.add(text);
        queryTextsByPartition[partition].add(text);
        if (/\p{Script=Han}/u.test(query.text ?? "")) {
          if (partition === "development") chineseDevelopment += 1;
          else chineseHeldOut += 1;
        }
      }
    }
  }

  const negativeIds = new Set();
  const negativeClasses = { development: new Set(), "held-out": new Set() };
  for (const query of corpus.negativeQueries ?? []) {
    assert(!negativeIds.has(query.id), `Duplicate negative query ID: ${query.id}`, errors);
    negativeIds.add(query.id);
    assert(["development", "held-out"].includes(query.partition), `${query.id} has an invalid partition.`, errors);
    assert(contexts.has(query.contextId), `${query.id} references an unknown context.`, errors);
    assert(typeof query.text === "string" && query.text.length >= 8, `${query.id} has no useful text.`, errors);
    assert(Array.isArray(query.expectedEligibleIds) && query.expectedEligibleIds.length === 0, `${query.id} must not declare eligible cards.`, errors);
    assert(Array.isArray(query.forbiddenCardIds), `${query.id} must declare forbiddenCardIds.`, errors);
    for (const cardId of query.forbiddenCardIds ?? []) assert(ids.has(cardId), `${query.id} forbids unknown card ${cardId}.`, errors);
    for (const blocked of query.expectedBlocked ?? []) {
      assert(ids.has(blocked.cardId), `${query.id} blocks unknown card ${blocked.cardId}.`, errors);
      assert(decisions.has(blocked.decision), `${query.id} has invalid blocked decision.`, errors);
      assert(typeof blocked.reasonCode === "string" && blocked.reasonCode.length > 0, `${query.id} lacks a blocked reason.`, errors);
    }
    if (query.mutationCardId) assert(ids.has(query.mutationCardId), `${query.id} mutates unknown card ${query.mutationCardId}.`, errors);
    negativeClasses[query.partition]?.add(query.class);
  }

  for (const partition of ["development", "held-out"]) {
    const count = (corpus.negativeQueries ?? []).filter((query) => query.partition === partition).length;
    assert(count >= 10, `${partition} requires at least ten no-answer or safety queries.`, errors);
    for (const requiredClass of ["no-answer", "same-keyword-distractor", "wrong-task", "wrong-working-copy", "denied-project", "changed-source", "unavailable-source", "task-required"]) {
      assert(negativeClasses[partition].has(requiredClass), `${partition} lacks negative class ${requiredClass}.`, errors);
    }
  }
  assert(chineseDevelopment >= 10 && chineseHeldOut >= 10, "Each partition requires at least ten Chinese/English-variant queries.", errors);
  assert(operationCoverage.size >= 7, "Mutation fixtures must cover at least seven operation classes.", errors);

  const developmentCases = queryCases(corpus, "development");
  const heldOutCases = queryCases(corpus, "held-out");
  assert(developmentCases.length >= 100, "Development partition requires at least 100 cases.", errors);
  assert(heldOutCases.length >= 100, "Held-out partition requires at least 100 cases.", errors);

  if (errors.length > 0) {
    throw new AggregateError(errors.map((message) => new Error(message)), `Invalid M1 corpus (${errors.length} errors).`);
  }
  return {
    corpusId: corpus.corpusId,
    frozenAt: corpus.frozenAt,
    sha256: metadata.sha256,
    cards: corpus.cards.length,
    sourceFiles: sourcePaths.size,
    developmentQueries: developmentCases.length,
    heldOutQueries: heldOutCases.length,
    answerablePerPartition: corpus.cards.length * 3,
    negativePerPartition: corpus.negativeQueries.length / 2,
    materializedLocators,
    mutationOperations: [...operationCoverage].sort(),
  };
}

export function queryCases(corpus, partition) {
  if (!["development", "held-out"].includes(partition)) {
    throw new Error(`Unknown partition: ${partition}`);
  }
  const contexts = new Map(corpus.contexts.map((context) => [context.id, context]));
  const cases = [];
  for (const card of corpus.cards) {
    const context = contexts.get(card.applicability.contextId);
    const evidence = {
      relativePath: card.source.relativePath,
      commit: card.source.commit,
      ...materializeLocator(card.source),
    };
    const queryKey = partition === "held-out" ? "heldOut" : partition;
    for (const query of card.queries[queryKey]) {
      cases.push({
        id: `${partition}:${card.id}:${query.kind}`,
        partition,
        class: query.kind,
        text: query.text,
        request: { ...context },
        expectedEligibleIds: [card.id],
        expectedBlocked: [],
        forbiddenCardIds: [],
        expectedEvidence: evidence,
        evidenceCheck: query.kind === (partition === "development" ? "direct" : "natural"),
      });
    }
  }
  for (const query of corpus.negativeQueries.filter((candidate) => candidate.partition === partition)) {
    const context = contexts.get(query.contextId);
    cases.push({
      ...query,
      request: { ...context, ...(query.requestOverrides ?? {}) },
      expectedBlocked: query.expectedBlocked ?? [],
    });
  }
  return cases;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function latencySummary(values) {
  return {
    measured: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

function itemCardId(item) {
  return item.cardId ?? item.card?.id;
}

function collectMentions(result) {
  return [
    ...(result.items ?? []),
    ...(result.reviewNotices ?? []),
    ...(result.blocked ?? []),
  ];
}

function classAccumulator() {
  return { queries: 0, answerable: 0, hitAt5: 0, shown: 0, relevantShown: 0 };
}

function recordUnsafeReuse(target, queryId, cardId, cause) {
  const key = `${queryId}\0${cardId}`;
  const current = target.get(key) ?? { queryId, cardId, causes: [] };
  if (!current.causes.includes(cause)) current.causes.push(cause);
  target.set(key, current);
}

export function evaluateResults(corpus, partition, observations, options = {}) {
  const expectedCases = queryCases(corpus, partition);
  const expectedById = new Map(expectedCases.map((query) => [query.id, query]));
  const actualById = new Map();
  const duplicateResultIds = [];
  const unknownResultIds = [];
  for (const observation of observations) {
    if (actualById.has(observation.queryId)) duplicateResultIds.push(observation.queryId);
    actualById.set(observation.queryId, observation);
    if (!expectedById.has(observation.queryId)) unknownResultIds.push(observation.queryId);
  }

  let answerable = 0;
  let hitAt5 = 0;
  let shown = 0;
  let relevantShown = 0;
  let misleadingNoAnswer = 0;
  let falseWithholding = 0;
  let pendingAnswerable = 0;
  let evidenceExpected = 0;
  let evidenceMeasured = 0;
  let evidenceCorrect = 0;
  const unsafeReuseByKey = new Map();
  const disclosureFailures = [];
  const perClass = new Map();
  const initialLatencies = [];
  const usableLatencies = [];

  for (const expected of expectedCases) {
    const bucket = perClass.get(expected.class) ?? classAccumulator();
    perClass.set(expected.class, bucket);
    bucket.queries += 1;
    const eligible = new Set(expected.expectedEligibleIds);
    if (expected.expectedEligibleIds.length > 0) {
      answerable += 1;
      bucket.answerable += 1;
      if (expected.evidenceCheck) evidenceExpected += 1;
    }
    const actual = actualById.get(expected.id);
    if (!actual) continue;
    if (Number.isFinite(actual.initialResponseMs)) initialLatencies.push(actual.initialResponseMs);
    if (Number.isFinite(actual.usableResponseMs)) usableLatencies.push(actual.usableResponseMs);
    const reusable = (actual.items ?? [])
      .filter((item) => item.decision === "REUSABLE")
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 5);
    const reusableIds = reusable.map(itemCardId).filter(Boolean);
    shown += reusable.length;
    bucket.shown += reusable.length;
    for (const cardId of reusableIds) {
      if (eligible.has(cardId)) {
        relevantShown += 1;
        bucket.relevantShown += 1;
      }
      if (expected.forbiddenCardIds.includes(cardId)) {
        recordUnsafeReuse(unsafeReuseByKey, expected.id, cardId, expected.class);
      }
      const blocked = expected.expectedBlocked.find((entry) => entry.cardId === cardId);
      if (blocked) {
        recordUnsafeReuse(
          unsafeReuseByKey,
          expected.id,
          cardId,
          `${blocked.decision}:${blocked.reasonCode}`,
        );
      }
    }
    if (expected.expectedEligibleIds.length > 0) {
      const hit = expected.expectedEligibleIds.some((cardId) => reusableIds.includes(cardId));
      if (hit) {
        hitAt5 += 1;
        bucket.hitAt5 += 1;
      } else {
        const withheldIds = new Set(collectMentions(actual).filter((item) => item.decision !== "REUSABLE").map(itemCardId));
        if (expected.expectedEligibleIds.some((cardId) => withheldIds.has(cardId))) falseWithholding += 1;
      }
      if (actual.partial === true || actual.validationPending === true || actual.pendingCount > 0) pendingAnswerable += 1;
      if (expected.evidenceCheck) {
        if (actual.evidenceOpen) {
          evidenceMeasured += 1;
          const evidence = expected.expectedEvidence;
          const opened = actual.evidenceOpen;
          if (
            opened.cardId && eligible.has(opened.cardId)
            && opened.relativePath === evidence.relativePath
            && opened.startLine === evidence.startLine
            && opened.endLine === evidence.endLine
            && opened.selectedText === evidence.selectedText
            && opened.qualifierText === evidence.qualifierText
          ) evidenceCorrect += 1;
        }
      }
    } else if (reusable.length > 0) {
      misleadingNoAnswer += 1;
    }
    if (expected.mustNotDisclose) {
      const serialized = JSON.stringify(actual);
      for (const cardId of expected.forbiddenCardIds) {
        if (serialized.includes(cardId)) disclosureFailures.push({ queryId: expected.id, cardId });
      }
    }
  }

  const unsafeReuse = [...unsafeReuseByKey.values()];
  const missingQueries = expectedCases.filter((query) => !actualById.has(query.id)).map((query) => query.id);
  const precisionAt5 = shown === 0 ? (answerable === 0 ? 1 : 0) : relevantShown / shown;
  const eligibleHitAt5 = answerable === 0 ? 1 : hitAt5 / answerable;
  const pendingFraction = answerable === 0 ? 0 : pendingAnswerable / answerable;
  const classes = Object.fromEntries([...perClass].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => [name, {
    ...value,
    precisionAt5: value.shown === 0 ? (value.answerable === 0 ? 1 : 0) : value.relevantShown / value.shown,
    eligibleHitAt5: value.answerable === 0 ? null : value.hitAt5 / value.answerable,
  }]));
  const hitThreshold = partition === "development" ? 1 : 0.9;
  const classHitFailures = partition === "held-out"
    ? Object.entries(classes).filter(([, value]) => value.answerable > 0 && value.eligibleHitAt5 < 0.8).map(([name]) => name)
    : [];
  const searchGate = missingQueries.length === 0
    && duplicateResultIds.length === 0
    && unknownResultIds.length === 0
    && unsafeReuse.length === 0
    && disclosureFailures.length === 0
    && misleadingNoAnswer === 0
    && precisionAt5 >= 0.9
    && eligibleHitAt5 >= hitThreshold
    && classHitFailures.length === 0;
  const evidenceGate = evidenceMeasured === 0
    ? "NOT_MEASURED"
    : evidenceMeasured === evidenceExpected && evidenceCorrect === evidenceExpected ? "PASS" : "FAIL";
  const initialLatency = latencySummary(initialLatencies);
  const usableLatency = latencySummary(usableLatencies);
  const latencyGate = initialLatencies.length !== expectedCases.length || usableLatencies.length !== expectedCases.length
    ? "NOT_MEASURED"
    : initialLatency.p95 <= 350 && usableLatency.p95 <= 1000 && pendingFraction <= 0.05 ? "PASS" : "FAIL";
  const requireEvidence = options.requireEvidence === true;
  const requireLatency = options.requireLatency === true;
  const overall = searchGate
    && (!requireEvidence || evidenceGate === "PASS")
    && (!requireLatency || latencyGate === "PASS")
    ? "PASS"
    : "FAIL";

  return {
    corpusId: corpus.corpusId,
    partition,
    overall,
    gates: {
      searchSafetyAndFindability: searchGate ? "PASS" : "FAIL",
      evidence: evidenceGate,
      supportedProfileLatency: latencyGate,
    },
    counts: {
      expectedQueries: expectedCases.length,
      observedQueries: actualById.size,
      missingQueries: missingQueries.length,
      answerable,
      hitAt5,
      reusableResultsShown: shown,
      relevantReusableShown: relevantShown,
      unsafeReuse: unsafeReuse.length,
      misleadingNoAnswer,
      falseWithholding,
      pendingAnswerable,
      evidenceExpected,
      evidenceMeasured,
      evidenceCorrect,
    },
    metrics: {
      precisionAt5,
      eligibleHitAt5,
      pendingFraction,
      initialResponseMs: initialLatency,
      usableResponseMs: usableLatency,
    },
    perClass: classes,
    failures: {
      missingQueries,
      duplicateResultIds,
      unknownResultIds,
      classHitFailures,
      unsafeReuse,
      disclosureFailures,
    },
  };
}

export function parseJsonLines(text) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSON on result line ${index + 1}: ${error.message}`);
    }
  }
  return rows;
}
