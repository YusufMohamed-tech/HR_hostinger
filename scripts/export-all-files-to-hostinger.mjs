import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputRoot = outputArgument
  ? path.resolve(outputArgument.slice("--output=".length))
  : "";
if (!outputRoot) {
  throw new Error("Usage: node scripts/export-all-files-to-hostinger.mjs --output=/absolute/new/directory");
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
];
for (const field of required) {
  if (!process.env[field]?.trim()) throw new Error(`Missing ${field}.`);
}

fs.mkdirSync(outputRoot, { recursive: false, mode: 0o700 });

const queryResponse = await fetch(
  `https://api.supabase.com/v1/projects/${encodeURIComponent(process.env.SUPABASE_PROJECT_REF.trim())}/database/query`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN.trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `
        select bucket_id, name, metadata
        from storage.objects
        order by bucket_id, name
      `,
    }),
  },
);
if (!queryResponse.ok) {
  throw new Error(`Supabase storage inventory failed with HTTP ${queryResponse.status}.`);
}
const rows = await queryResponse.json();
if (!Array.isArray(rows)) throw new Error("Supabase storage inventory returned an invalid response.");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const manifest = {
  exportedAt: new Date().toISOString(),
  source: "supabase-storage",
  destination: "hostinger-filesystem",
  objectCount: 0,
  totalBytes: 0,
  objects: [],
};

for (const row of rows) {
  const bucket = String(row.bucket_id || "");
  const objectPath = String(row.name || "").replaceAll("\\", "/");
  const segments = objectPath.split("/");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(bucket)
    || !objectPath
    || objectPath.startsWith("/")
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Storage inventory contained an unsafe object path.");
  }
  const downloaded = await supabase.storage.from(bucket).download(objectPath);
  if (downloaded.error || !downloaded.data) {
    throw new Error(`Unable to download ${bucket}/${objectPath}: ${downloaded.error?.message || "unknown error"}`);
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const expectedSize = Number(row.metadata?.size ?? row.metadata?.contentLength ?? bytes.byteLength);
  if (Number.isFinite(expectedSize) && expectedSize !== bytes.byteLength) {
    throw new Error(`Size mismatch for ${bucket}/${objectPath}.`);
  }
  const destination = path.resolve(outputRoot, bucket, ...segments);
  if (!destination.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("Storage object escaped the export root.");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  manifest.objectCount += 1;
  manifest.totalBytes += bytes.byteLength;
  manifest.objects.push({ bucket, path: objectPath, size: bytes.byteLength, sha256 });
}

fs.writeFileSync(
  path.join(outputRoot, "hostinger-storage-migration-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify({
  outputRoot,
  objectCount: manifest.objectCount,
  totalBytes: manifest.totalBytes,
}));
