# HRMS Operations Runbook

Owner: Engineering / Operations  
Approvers: Security, HR operations, Finance, Product  
Last reviewed: 2026-07-19

This runbook is the required operating procedure for staging and production. A release is not approved merely because the application builds; the environment-specific evidence in `PRE_LAUNCH_AUDIT.md` must also be complete.

## 1. Release gates

Before a production change:

1. The exact release commit passes `npm ci` and `npm run verify:ci`.
2. `npm run db:migrate -- --dry-run` and `npm run db:migrate -- --status` show the expected migration set with no checksum drift.
3. A current database backup/restore point exists and a restore has been rehearsed on a non-production clone for this release train.
4. Staging has the production migration sequence, production-like feature flags, private storage buckets, worker schedules, malware scanner, email delivery, and monitoring.
5. The role-based UAT checklist and financial/payroll reconciliations are signed.
6. A release owner, database operator, rollback owner, and incident commander are named in the change record.

## 2. Required configuration

Use a secret manager. Never place real values in the repository, build output, tickets, screenshots, or chat.

| Setting | Requirement | Rotation / validation |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Environment-specific Supabase URL | Verify `/api/ready` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Environment-specific public key | Rotate with the platform key procedure |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service key | Restrict to runtime; rotate after suspected disclosure |
| `SUPABASE_DB_URL` | Pooler/direct migration URL | Migration operator only; do not expose to app clients |
| `OUTBOX_WORKER_SECRET` | Unique random value, at least 32 characters | Rotate quarterly and after disclosure |
| `COMPLIANCE_WORKER_SECRET` | Unique random value, at least 32 characters | Rotate quarterly and after disclosure |
| `FILE_RETENTION_WORKER_SECRET` | Unique random value, at least 32 characters | Rotate quarterly and after disclosure |
| `MALWARE_SCAN_URL` / `MALWARE_SCAN_TOKEN` | Production malware-scanning service | Test clean, infected, timeout, and unavailable cases |
| `AUDIT_EVIDENCE_SECRET` | Unique pseudonymization secret, at least 32 characters | Document custody and rotation impact before rotating |
| `RATE_LIMIT_HASH_SECRET` | Unique abuse-control hashing secret, at least 32 characters | Rotate through an approved maintenance change |

`ALLOW_DESTRUCTIVE_SCHEMA_APPLY`, `ALLOW_DESTRUCTIVE_MIGRATION`, and `ALLOW_MIGRATION_ADOPTION` must remain `false` in normal runtime configuration. Demo login and seed settings must remain disabled in production.

## 3. Staging deployment

```bash
npm ci
npm run verify:ci
npm run db:migrate -- --dry-run
npm run db:migrate -- --status
npm run db:migrate
npm run verify:accounting
npm run verify:lms
npm run build
```

After deployment:

- Confirm `GET /api/health` returns `200`.
- Confirm `GET /api/ready` returns `200` with configuration, database, and migrations checks equal to `ok`, and that `schemaHead` is the release manifest head.
- Run UAT with separate accounts for every role in `ROLE_CAPABILITY_MATRIX.md`.
- Exercise a real email invitation and recovery link; do not use an operator-selected password.
- Upload a clean file, a blocked signature, an oversized file, and simulate scanner unavailability.
- Run at least one outbox, compliance, and file-retention job and archive their request IDs/results.
- Reconcile attendance, leave, payroll, accounting, sales cash, assets, advances, and commissions against the UAT fixtures.

## 4. Production deployment

1. Freeze conflicting administrative changes for the approved window.
2. Record backup identifier, timestamp, database point-in-time recovery coverage, release commit, and migration operator.
3. Run `npm run db:migrate -- --status`, archive the output, then run `npm run db:migrate` once.
4. Deploy the application commit that was tested against the same schema sequence.
5. Check health/readiness, sign-in, tenant isolation, one read-only workflow per enabled module, and the internal outbox status.
6. Watch error rate, latency, database saturation, authentication failures, outbox backlog, dead letters, and worker failures through the heightened-observation window.

Do not run `apply:schema`, `apply:migration`, an individual SQL file, migration adoption, cleanup scripts, or seed scripts during production deployment.

## 5. Scheduled workers

Workers authenticate with a dedicated bearer secret. Log request IDs and aggregate results, never the secret or row payloads containing personal data.

| Worker | Endpoint | Recommended schedule | Success condition |
|---|---|---|---|
| Event outbox | `POST /api/internal/outbox` | Every minute; batch 25–100 | `failed=0`, `deadLettered=0` |
| Personnel compliance | `POST /api/internal/compliance` | Daily after local midnight | HTTP 200 and no unhandled error |
| Managed-file retention | `POST /api/internal/file-retention` | Daily in a low-traffic window | Failures retried; dead letters investigated |

Example pattern (supply the secret from the scheduler, not shell history):

```text
Authorization: Bearer <worker-secret>
Content-Type: application/json
Body: {"batchSize":25}
```

Use authenticated `GET /api/internal/outbox` for queue health. Alert on any dead letter, repeated failed count, a growing pending backlog, or no successful worker invocation in two expected intervals.

## 6. Monitoring and alerts

Minimum production signals:

- availability and latency for `/api/health` and `/api/ready`;
- HTTP 5xx, 429, authentication/recovery failures, and request IDs;
- database connection, CPU, storage, lock wait, slow query, and replication/PITR health;
- outbox pending/processing/failed/dead-letter counts and oldest pending age;
- compliance and retention job last-success timestamps;
- malware scanner availability, rejection, timeout, and error counts;
- email invitation/recovery delivery failures;
- accounting auto-posting and reconciliation failures;
- suspicious platform-admin, role, MFA, and account-control activity.

Page the on-call owner for readiness failure, cross-tenant access suspicion, unauthorized privilege change, financial imbalance, malware-scanner fail-open behavior, backup failure, or any dead-letter event that blocks a critical workflow.

## 7. Backup and restore rehearsal

For every release train, record:

- backup/PITR identifier, coverage start/end, encryption status, owner, and storage region;
- restore target, start/end time, achieved RPO/RTO, integrity checks, and cleanup owner;
- row counts and reconciliations for organizations, employees, attendance, leave ledgers, payroll, journals/lines, payments, business events/outbox, managed files, and storage objects;
- authentication and private-file access checks after restore;
- defects and the approved remediation owner/date.

A backup is not accepted as evidence until a restore has succeeded in an isolated environment.

## 8. Rollback

- Prefer application rollback only when the previous application is compatible with all applied migrations.
- Database migrations roll forward with a corrective migration. Never edit or delete an applied migration or reset the production schema.
- If a release causes corruption or unsafe writes, stop traffic/workers, preserve logs and request IDs, take a forensic snapshot, and follow the incident process before restoring.
- Re-enable workers only after schema/application compatibility and idempotent replay have been confirmed.

## 9. Incident response

1. Declare severity and incident commander; open a timestamped incident record.
2. Contain affected accounts, modules, workers, or traffic without deleting evidence.
3. Preserve application/database/auth/storage logs, request IDs, business events, command ledgers, outbox rows, and platform audit records.
4. Assess tenant, data-classification, payroll/financial, and regulatory impact with Security/Legal/HR.
5. Recover using a tested corrective migration, application rollback, replay-safe command, or verified restore.
6. Reconcile affected ledgers and notify stakeholders through the approved communication plan.
7. Complete root-cause and corrective-action review before closing the incident.

## 10. Routine access and control review

Monthly, and before launch:

- review platform admins, organization admins, HR, Finance, payroll, recruitment, LMS, sales-manager, and service accounts;
- remove stale invitations and suspend departed users through the lifecycle/account-control workflows;
- confirm MFA enrollment and recent authentication assurance for privileged roles;
- review role changes, recovery emails, suspensions, failed logins, rate-limit anomalies, and service-role use;
- verify feature entitlements and organization suspension behave fail-closed;
- record reviewer, date, exceptions, owner, and due date.
