import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration, type RuntimeEnvironment } from "../src/lib/runtime-config";

const productionEnvironment: RuntimeEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-id.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-the-production-project",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-the-production-project",
  OUTBOX_WORKER_SECRET: "outbox-worker-secret-000000000000001",
  COMPLIANCE_WORKER_SECRET: "compliance-worker-secret-0000000001",
  FILE_RETENTION_WORKER_SECRET: "retention-worker-secret-00000000001",
  FILE_ACCESS_SIGNING_SECRET: "file-access-signing-secret-0000000001",
  AUDIT_EVIDENCE_SECRET: "audit-evidence-secret-0000000000001",
  RATE_LIMIT_HASH_SECRET: "rate-limit-hash-secret-000000000001",
  HOSTINGER_OBJECT_STORAGE_ENDPOINT: "https://s3.eu-central-1.hostingerusercontent.com",
  HOSTINGER_OBJECT_STORAGE_REGION: "eu-central-1",
  HOSTINGER_OBJECT_STORAGE_ACCESS_KEY: "hostinger-access-key-production",
  HOSTINGER_OBJECT_STORAGE_SECRET_KEY: "hostinger-secret-key-production-0001",
  HOSTINGER_OBJECT_STORAGE_BUCKET: "tatwir-private-personnel",
  HOSTINGER_OBJECT_STORAGE_ENCRYPTION: "AES256",
  ALLOW_DESTRUCTIVE_SCHEMA_APPLY: "false",
  ALLOW_DESTRUCTIVE_MIGRATION: "false",
  ALLOW_MIGRATION_ADOPTION: "false",
  NEXT_PUBLIC_SHOW_DEMO_LOGINS: "false",
};

test("production runtime configuration accepts independent strong secrets and HTTPS integrations", () => {
  assert.deepEqual(validateRuntimeConfiguration(productionEnvironment), {
    ready: true,
    production: true,
    issues: [],
  });
});

test("production accepts the private Supabase personnel-storage fallback", () => {
  const environment = { ...productionEnvironment };
  for (const field of [
    "HOSTINGER_OBJECT_STORAGE_ENDPOINT",
    "HOSTINGER_OBJECT_STORAGE_REGION",
    "HOSTINGER_OBJECT_STORAGE_ACCESS_KEY",
    "HOSTINGER_OBJECT_STORAGE_SECRET_KEY",
    "HOSTINGER_OBJECT_STORAGE_BUCKET",
    "HOSTINGER_OBJECT_STORAGE_ENCRYPTION",
  ]) {
    delete environment[field];
  }

  assert.deepEqual(validateRuntimeConfiguration(environment), {
    ready: true,
    production: true,
    issues: [],
  });
});

test("production rejects a partially configured Hostinger personnel store", () => {
  const environment = { ...productionEnvironment };
  delete environment.HOSTINGER_OBJECT_STORAGE_ACCESS_KEY;

  const result = validateRuntimeConfiguration(environment);
  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, [
    { field: "HOSTINGER_OBJECT_STORAGE_ACCESS_KEY", reason: "missing" },
  ]);
});

test("production runtime configuration rejects missing and weak operational dependencies", () => {
  const result = validateRuntimeConfiguration({
    ...productionEnvironment,
    OUTBOX_WORKER_SECRET: "too-short",
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, [
    { field: "OUTBOX_WORKER_SECRET", reason: "minimum_32_characters" },
  ]);
});

test("production runtime configuration rejects reused secrets and unsafe switches", () => {
  const result = validateRuntimeConfiguration({
    ...productionEnvironment,
    COMPLIANCE_WORKER_SECRET: productionEnvironment.OUTBOX_WORKER_SECRET,
    ALLOW_MIGRATION_ADOPTION: "true",
    NEXT_PUBLIC_SHOW_DEMO_LOGINS: "TRUE",
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, [
    { field: "OUTBOX_WORKER_SECRET", reason: "must_not_be_reused" },
    { field: "ALLOW_MIGRATION_ADOPTION", reason: "must_be_disabled" },
    { field: "NEXT_PUBLIC_SHOW_DEMO_LOGINS", reason: "must_be_disabled" },
  ]);
});

test("production runtime configuration rejects placeholders, insecure URLs, and key reuse", () => {
  const result = validateRuntimeConfiguration({
    ...productionEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: productionEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, [
    { field: "NEXT_PUBLIC_SUPABASE_URL", reason: "placeholder" },
    { field: "SUPABASE_SERVICE_ROLE_KEY", reason: "must_differ_from_anon_key" },
  ]);
});

test("development requires only valid core Supabase configuration", () => {
  assert.deepEqual(validateRuntimeConfiguration({
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  }), {
    ready: true,
    production: false,
    issues: [],
  });
});
