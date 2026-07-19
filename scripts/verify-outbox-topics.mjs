import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "db/migrations.manifest.json"), "utf8"));
const sqlFiles = [manifest.baseline.file, ...manifest.migrations.map((entry) => entry.file)];
const workerPath = path.join(root, "src/lib/server/outbox-worker.ts");
const workerSource = fs.readFileSync(workerPath, "utf8");
const handlerTopics = new Set(
  [...workerSource.matchAll(/^\s*"([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)"\s*:/gm)]
    .map((match) => match[1])
);

// These SQL expressions concatenate a validated finite action to a prefix.
// Keep the expansion explicit so a new database action cannot silently invent
// an outbox topic without updating the worker contract.
const dynamicTopicsByFile = new Map([
  ["db/schema_v65_atomic_advances.sql", new Set([
    "advance.request_approved",
    "advance.request_partial_approved",
    "advance.request_rejected",
  ])],
  ["db/schema_v71_recruitment_lms_integrity.sql", new Set([
    "recruitment.offer_accepted",
    "recruitment.offer_declined",
  ])],
  ["db/schema_v90_atomic_deduction_policies.sql", new Set([
    "payroll.deduction_policy_saved",
    "payroll.deduction_policy_deleted",
  ])],
]);

function splitSqlList(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === "(") {
      depth += 1;
    } else if (!quoted && character === ")") {
      depth -= 1;
    } else if (!quoted && depth === 0 && character === ",") {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function topicLiterals(expression) {
  const values = [];
  const literalPattern = /'((?:''|[^'])*)'/g;
  for (const match of expression.matchAll(literalPattern)) {
    const value = match[1].replaceAll("''", "'");
    if (/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value)) values.push(value);
  }
  return values;
}

function assignedTopicLiterals(source, variableName) {
  const values = [];
  const assignmentPattern = new RegExp(`\\b${variableName}\\s*:?=\\s*([\\s\\S]*?);`, "gi");
  for (const match of source.matchAll(assignmentPattern)) values.push(...topicLiterals(match[1]));
  return values;
}

const producedTopics = new Map();
const unresolved = [];
const insertPattern = /INSERT\s+INTO\s+public\.event_outbox\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT[\s\S]*?)?;/gi;

for (const relativeFile of sqlFiles) {
  const source = fs.readFileSync(path.join(root, relativeFile), "utf8");
  for (const match of source.matchAll(insertPattern)) {
    const columns = splitSqlList(match[1]).map((column) => column.replace(/\s+/g, "").toLowerCase());
    const expressions = splitSqlList(match[2]);
    const topicIndex = columns.indexOf("topic");
    if (topicIndex < 0 || !expressions[topicIndex]) {
      unresolved.push(`${relativeFile}: event_outbox insert has no statically identifiable topic column`);
      continue;
    }

    const expression = expressions[topicIndex];
    let topics = topicLiterals(expression).filter((topic) => !topic.endsWith("_"));
    const variable = expression.trim().match(/^([a-z_][a-z0-9_]*)$/i)?.[1];
    if (variable) topics = assignedTopicLiterals(source, variable);
    if (expression.includes("||")) topics = [...(dynamicTopicsByFile.get(relativeFile) ?? [])];
    if (topics.length === 0) {
      unresolved.push(`${relativeFile}: unable to resolve topic expression ${JSON.stringify(expression)}`);
      continue;
    }
    for (const topic of topics) {
      const files = producedTopics.get(topic) ?? new Set();
      files.add(relativeFile);
      producedTopics.set(topic, files);
    }
  }
}

const missingHandlers = [...producedTopics.keys()].filter((topic) => !handlerTopics.has(topic)).sort();
if (unresolved.length > 0 || missingHandlers.length > 0) {
  if (unresolved.length > 0) {
    console.error("Unresolved outbox topic producers:\n" + unresolved.map((value) => `- ${value}`).join("\n"));
  }
  if (missingHandlers.length > 0) {
    console.error("Database outbox topics without worker handlers:");
    for (const topic of missingHandlers) {
      console.error(`- ${topic} (${[...producedTopics.get(topic)].join(", ")})`);
    }
  }
  process.exit(1);
}

console.log(
  `Outbox topic contract is complete: ${producedTopics.size} database topics have worker handlers `
  + `(${handlerTopics.size} handlers registered).`
);
