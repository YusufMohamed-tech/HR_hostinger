import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HOSTINGER_OBJECT_STORAGE_ENDPOINT",
  "HOSTINGER_OBJECT_STORAGE_REGION",
  "HOSTINGER_OBJECT_STORAGE_ACCESS_KEY",
  "HOSTINGER_OBJECT_STORAGE_SECRET_KEY",
  "HOSTINGER_OBJECT_STORAGE_BUCKET",
];
for (const field of required) {
  if (!process.env[field]?.trim()) {
    console.error(`Missing ${field}.`);
    process.exit(1);
  }
}

const dryRun = process.env.DRY_RUN !== "0";
const bucket = process.env.HOSTINGER_OBJECT_STORAGE_BUCKET.trim();
const encryption = process.env.HOSTINGER_OBJECT_STORAGE_ENCRYPTION === "aws:kms" ? "aws:kms" : "AES256";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const s3 = new S3Client({
  endpoint: process.env.HOSTINGER_OBJECT_STORAGE_ENDPOINT,
  region: process.env.HOSTINGER_OBJECT_STORAGE_REGION,
  forcePathStyle: process.env.HOSTINGER_OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.HOSTINGER_OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.HOSTINGER_OBJECT_STORAGE_SECRET_KEY,
  },
});

await s3.send(new HeadBucketCommand({ Bucket: bucket }));

let offset = 0;
let inspected = 0;
let migrated = 0;
let failed = 0;
const pageSize = 100;
const rowsToMigrate = [];

while (true) {
  const { data: rows, error } = await supabase
    .from("managed_files")
    .select("id,org_id,bucket_id,storage_path,original_name,detected_mime,sha256,storage_provider,deleted_at")
    .eq("storage_provider", "supabase_storage")
    .is("deleted_at", null)
    .order("created_at")
    .range(offset, offset + pageSize - 1);
  if (error) throw new Error(`Managed-file query failed: ${error.message}`);
  if (!rows?.length) break;
  rowsToMigrate.push(...rows);
  if (rows.length < pageSize) break;
  offset += pageSize;
}

for (const row of rowsToMigrate) {
    inspected += 1;
    try {
      const source = await supabase.storage.from(row.bucket_id).download(row.storage_path);
      if (source.error || !source.data) {
        throw new Error(source.error?.message || "Source object could not be downloaded.");
      }
      const bytes = new Uint8Array(await source.data.arrayBuffer());
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (row.sha256 && row.sha256 !== sha256) {
        throw new Error(`SHA-256 mismatch: database=${row.sha256} source=${sha256}`);
      }

      if (dryRun) {
        console.log(`DRY RUN ${row.id} ${row.storage_path} ${bytes.byteLength} bytes ${sha256}`);
        continue;
      }

      const uploaded = await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: row.storage_path,
        Body: bytes,
        ContentType: row.detected_mime || "application/octet-stream",
        ServerSideEncryption: encryption,
        ...(encryption === "aws:kms" && process.env.HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID
          ? { SSEKMSKeyId: process.env.HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID }
          : {}),
        Metadata: {
          sha256,
          organization: row.org_id,
          source: "supabase-personnel-migration",
        },
      }));
      const { error: updateError } = await supabase.from("managed_files").update({
        storage_provider: "hostinger_s3",
        storage_container: bucket,
        storage_version: uploaded.VersionId || null,
        storage_etag: uploaded.ETag?.replaceAll('"', "") || null,
        encryption_status: encryption === "aws:kms" ? "sse_kms" : "sse_s3",
        migrated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("storage_provider", "supabase_storage");
      if (updateError) throw new Error(`Metadata update failed: ${updateError.message}`);
      migrated += 1;
      console.log(`MIGRATED ${row.id} ${row.storage_path}`);
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${row.id}: ${error instanceof Error ? error.message : error}`);
    }
}

console.log(JSON.stringify({ dryRun, inspected, migrated, failed, legacyObjectsDeleted: false }));
if (failed > 0) process.exitCode = 1;
