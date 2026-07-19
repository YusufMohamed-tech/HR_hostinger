import fs from "node:fs";
import path from "node:path";
import { readManifest, sha256, readProjectFile, validateManifest } from "./migration-manifest.mjs";

const manifest = readManifest();
const { errors, entries } = validateManifest(manifest);
const runtimeSchemaVersion = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), "src", "lib", "schema-version.json"),
  "utf8",
));
const manifestHead = manifest.migrations.at(-1);

if (
  !manifestHead
  || runtimeSchemaVersion.id !== manifestHead.id
  || runtimeSchemaVersion.file !== manifestHead.file
  || runtimeSchemaVersion.checksumSha256 !== sha256(readProjectFile(manifestHead.file))
) {
  errors.push("Runtime readiness schema version does not match the manifest head and checksum.");
}

if (errors.length > 0) {
  console.error("Migration manifest verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Migration manifest is valid: ${manifest.migrations.length} ordered migrations.`);
console.log(`Baseline: ${manifest.baseline.id} (${manifest.baseline.file})`);
for (const entry of entries) {
  console.log(`${entry.id}\t${sha256(readProjectFile(entry.file))}\t${entry.file}`);
}
