import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const read = (file) => fs.readFileSync(path.resolve(projectRoot, file), "utf8");
const failures = [];
let checks = 0;

function includes(file, expectations) {
  const source = read(file);
  for (const [description, expected] of expectations) {
    checks += 1;
    if (!source.includes(expected)) failures.push(`${description} (${file})`);
  }
}

includes("src/app/api/ready/route.ts", [
  ["readiness validates runtime configuration", "validateRuntimeConfiguration()"],
  ["readiness verifies the migration ledger", '.from("schema_migrations")'],
  ["readiness checks the expected schema checksum", "migration.data.checksum_sha256 === schemaVersion.checksumSha256"],
  ["readiness fails when migrations are not current", "configuration.ready && databaseReady && migrationsReady"],
]);

includes("src/lib/runtime-config.ts", [
  ["runtime requires the outbox worker secret", '"OUTBOX_WORKER_SECRET"'],
  ["runtime requires the compliance worker secret", '"COMPLIANCE_WORKER_SECRET"'],
  ["runtime requires the retention worker secret", '"FILE_RETENTION_WORKER_SECRET"'],
  ["runtime requires an audit evidence secret", '"AUDIT_EVIDENCE_SECRET"'],
  ["runtime requires a rate-limit hashing secret", '"RATE_LIMIT_HASH_SECRET"'],
  ["runtime requires production HTTPS", 'parsed.protocol !== "https:"'],
  ["runtime rejects reused secrets", '"must_not_be_reused"'],
  ["runtime rejects dangerous production switches", '"must_be_disabled"'],
]);

includes("src/middleware.ts", [
  ["CSP uses a request-specific nonce", "btoa(crypto.randomUUID())"],
  ["CSP blocks objects", '"object-src \'none\'"'],
  ["tenant dependency failures fail closed", "Tenant authorization is temporarily unavailable."],
  ["module access checks organization feature flags", "featureEnabled(organizationFeatures, requiredFeature)"],
  ["module access checks plan entitlements", "planAllowsFeature(plan, requiredFeature)"],
  ["privileged access requires AAL2", 'assurance.data.currentLevel !== "aal2"'],
]);

includes("next.config.mjs", [
  ["clickjacking protection is configured", 'key: "X-Frame-Options", value: "DENY"'],
  ["MIME sniffing is disabled", 'key: "X-Content-Type-Options", value: "nosniff"'],
  ["referrer policy is configured", 'key: "Referrer-Policy"'],
  ["permissions policy is configured", 'key: "Permissions-Policy"'],
  ["production HSTS is configured", 'key: "Strict-Transport-Security"'],
]);

for (const worker of ["outbox", "compliance", "file-retention"]) {
  includes(`src/app/api/internal/${worker}/route.ts`, [
    [`${worker} worker uses constant-time secret comparison`, "timingSafeEqual"],
    [`${worker} worker rejects secrets shorter than 32 characters`, "expected.length < 32"],
    [`${worker} worker returns request IDs`, '"x-request-id"'],
  ]);
}

includes("src/lib/server/upload-security.ts", [
  ["production uploads fail closed without a scanner", 'if (production) {'],
  ["scanner failure blocks uploads", '"scanner_unavailable"'],
  ["upload content is hashed", 'createHash("sha256")'],
]);

includes("src/lib/server/lms.ts", [
  ["LMS lesson HTML is sanitized on write", "sanitizeRichTextHtml(text(values.content))"],
  ["LMS external lesson URLs are protocol validated", "safeExternalUrl(requestedContentUrl)"],
]);

includes("src/components/lms/classroom/LessonExperience.tsx", [
  ["learner lesson HTML is sanitized on render", "dangerouslySetInnerHTML={{ __html: safeContent }}"],
  ["learner external URLs are protocol validated", "safeExternalUrl(S(lesson.content_url))"],
]);

for (const route of ["recovery", "reset-password"]) {
  includes(`src/app/api/auth/${route}/route.ts`, [
    [`${route} is rate limited`, "consumeRateLimit"],
    [`${route} fails closed when abuse protection is unavailable`, "status: 503"],
    [`${route} returns request IDs`, "requestId"],
  ]);
}

includes(".env.example", [
  ["destructive schema apply defaults off", "ALLOW_DESTRUCTIVE_SCHEMA_APPLY=false"],
  ["destructive migration defaults off", "ALLOW_DESTRUCTIVE_MIGRATION=false"],
  ["migration adoption defaults off", "ALLOW_MIGRATION_ADOPTION=false"],
  ["demo login defaults off", "NEXT_PUBLIC_SHOW_DEMO_LOGINS=false"],
]);

includes(".gitignore", [
  ["bare environment files are ignored", ".env\n"],
  ["the environment template remains committable", "!.env.example"],
]);

if (failures.length > 0) {
  console.error("Launch contract verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Launch security/readiness contract passed ${checks} checks.`);
