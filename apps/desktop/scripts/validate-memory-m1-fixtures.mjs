#!/usr/bin/env node

import { loadCorpus, queryCases, validateCorpus } from "./memory-m1-fixtures.mjs";

function usage() {
  return [
    "Usage:",
    "  node scripts/validate-memory-m1-fixtures.mjs [--corpus PATH] [--materialized]",
    "  node scripts/validate-memory-m1-fixtures.mjs [--corpus PATH] --requests development|held-out",
    "",
    "The --requests form writes JSON Lines request inputs without expected card IDs.",
  ].join("\n");
}

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option);
  if (index < 0) return undefined;
  if (!argumentsList[index + 1]) throw new Error(`${option} requires a value.`);
  return argumentsList[index + 1];
}

try {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }
  const loaded = loadCorpus(optionValue(argumentsList, "--corpus"));
  const summary = validateCorpus(loaded.corpus, loaded);
  const requestPartition = optionValue(argumentsList, "--requests");
  if (requestPartition) {
    for (const query of queryCases(loaded.corpus, requestPartition)) {
      console.log(JSON.stringify({
        queryId: query.id,
        partition: query.partition,
        class: query.class,
        query: query.text,
        request: query.request,
        mutationCardId: query.mutationCardId,
      }));
    }
  } else if (argumentsList.includes("--materialized")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const { materializedLocators: _locators, ...compact } = summary;
    console.log(JSON.stringify(compact, null, 2));
  }
} catch (error) {
  if (error instanceof AggregateError) {
    console.error(error.message);
    for (const item of error.errors) console.error(`- ${item.message}`);
  } else {
    console.error(error.stack ?? error.message);
  }
  process.exit(1);
}
