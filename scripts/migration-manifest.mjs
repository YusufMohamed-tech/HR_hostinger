import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const projectRoot = process.cwd();
export const manifestPath = path.resolve(projectRoot, "db", "migrations.manifest.json");

export function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function resolveProjectFile(file) {
  const resolved = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Manifest path escapes the project root: ${file}`);
  }
  return resolved;
}

export function readProjectFile(file) {
  return fs.readFileSync(resolveProjectFile(file), "utf8");
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function sqlWithoutComments(sql) {
  return sql
    .replace(/--.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "");
}

export function validateManifest(manifest = readManifest()) {
  const errors = [];
  const ids = new Set();
  const files = new Set();
  const entries = [manifest.baseline, ...manifest.migrations];
  const excludedEntries = manifest.excludedSqlFiles ?? [];
  const excluded = new Set();

  if (manifest.manifestVersion !== 1) errors.push("Unsupported manifestVersion; expected 1.");
  if (!manifest.baseline?.id || !manifest.baseline?.file) errors.push("A baseline id and file are required.");
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) errors.push("At least one migration is required.");

  for (const entry of entries) {
    if (!entry?.id || !entry?.file) {
      errors.push("Every manifest entry must contain id and file.");
      continue;
    }
    if (ids.has(entry.id)) errors.push(`Duplicate migration id: ${entry.id}`);
    if (files.has(entry.file)) errors.push(`Duplicate migration file: ${entry.file}`);
    ids.add(entry.id);
    files.add(entry.file);

    try {
      const resolved = resolveProjectFile(entry.file);
      if (!fs.existsSync(resolved)) errors.push(`Missing migration file: ${entry.file}`);
      else if (!fs.readFileSync(resolved, "utf8").trim()) errors.push(`Empty migration file: ${entry.file}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const entry of excludedEntries) {
    if (!entry?.file || !entry?.reason) {
      errors.push("Every excluded SQL file must contain file and reason.");
      continue;
    }
    if (files.has(entry.file) || excluded.has(entry.file)) {
      errors.push(`Duplicate or conflicting excluded SQL file: ${entry.file}`);
      continue;
    }
    excluded.add(entry.file);
    try {
      const resolved = resolveProjectFile(entry.file);
      if (!fs.existsSync(resolved)) errors.push(`Missing excluded SQL file: ${entry.file}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const diskMigrations = fs
    .readdirSync(path.resolve(projectRoot, "db"))
    .filter((name) => /^schema_v\d+.*\.sql$/u.test(name))
    .map((name) => `db/${name}`)
    .sort();
  const manifestMigrations = manifest.migrations.map((entry) => entry.file).sort();

  for (const file of diskMigrations) {
    if (!manifestMigrations.includes(file) && !excluded.has(file)) {
      errors.push(`SQL migration is not in the manifest or exclusions: ${file}`);
    }
  }
  for (const file of manifestMigrations) {
    if (!diskMigrations.includes(file)) errors.push(`Manifest migration is not a schema_v SQL file: ${file}`);
  }

  for (const entry of manifest.migrations) {
    const sql = sqlWithoutComments(readProjectFile(entry.file));
    if (/\bdrop\s+table\b|\btruncate\b/iu.test(sql)) {
      errors.push(`Forward migration contains DROP TABLE or TRUNCATE: ${entry.file}`);
    }
  }

  for (const name of fs.readdirSync(path.resolve(projectRoot, "db")).filter((file) => file.endsWith(".sql"))) {
    const file = `db/${name}`;
    if (file !== manifest.baseline.file && !files.has(file) && !excluded.has(file)) {
      errors.push(`SQL file is neither migrated nor explicitly excluded: ${file}`);
    }
  }

  return { errors, entries };
}
