# Progressive Employee Onboarding — Production Deployment and Manual Test Guide

## What “activated” means

Creating an employee now performs two separate jobs:

1. The employee master record is created with active employment.
2. Supabase Auth receives the email and the password chosen by HR, the email is confirmed, organization membership is linked, and the profile is activated.

Missing files, contracts, social-insurance data, bank details, work location, shift, or emergency contact no longer disable the employee or block login. They appear in **استكمال ملفات الموظفين** as readiness requirements.

Passwords are never stored in application tables and cannot be displayed later. HR can set a new password at any time from the employee edit dialog. The system records only who changed it and when.

## Deployment order

Use this order in staging and then production:

1. Create and secure Hostinger object storage.
2. Back up PostgreSQL and record the restore point.
3. Apply database migrations through the migration ledger.
4. Configure production environment variables.
5. Dry-run and execute the legacy personnel-file migration.
6. Deploy the application.
7. Verify readiness and perform the manual acceptance tests below.

Do not deploy the new application before migrations v129–v132 are present. Do not delete legacy Supabase Storage objects during this release.

## 1. Prepare private Hostinger storage

Provision a private S3-compatible bucket on Hostinger. Public listing and anonymous reads must be disabled. Create a dedicated application access key that can only read, write, and delete objects in this bucket.

Set these server-only production variables:

```dotenv
HOSTINGER_OBJECT_STORAGE_ENDPOINT=https://your-private-storage-endpoint
HOSTINGER_OBJECT_STORAGE_REGION=your-region
HOSTINGER_OBJECT_STORAGE_ACCESS_KEY=...
HOSTINGER_OBJECT_STORAGE_SECRET_KEY=...
HOSTINGER_OBJECT_STORAGE_BUCKET=tatwir-private-personnel
HOSTINGER_OBJECT_STORAGE_FORCE_PATH_STYLE=true
HOSTINGER_OBJECT_STORAGE_ENCRYPTION=AES256
```

If the provider supports KMS, use `HOSTINGER_OBJECT_STORAGE_ENCRYPTION=aws:kms` and set `HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID`.

Never use `NEXT_PUBLIC_` prefixes for storage credentials. Keep bucket versioning enabled if supported. Configure backups and lifecycle retention according to the company’s legal retention policy.

## 2. Apply migrations safely

From the release commit:

```bash
npm ci
npm run db:verify-migrations
SUPABASE_DB_URL='postgresql://...' npm run db:migrate -- --status
SUPABASE_DB_URL='postgresql://...' MIGRATION_ACTOR='release-operator@tatwir.sa' npm run db:migrate
SUPABASE_DB_URL='postgresql://...' npm run db:migrate -- --status
```

The final status must show the manifest head as applied. Preserve the command output with the deployment evidence.

Verify the important database objects:

```sql
select id, file_path, applied_at
from public.schema_migrations
where id in (
  'schema_v129_progressive_employee_onboarding',
  'schema_v130_hostinger_personnel_storage',
  'schema_v131_onboarding_readiness_reminders',
  'schema_v132_custom_employee_requirements'
)
order by applied_at;

select count(*) as active_employees_with_readiness_case
from public.employees employee
join public.employee_onboarding_cases onboarding_case
  on onboarding_case.org_id = employee.org_id
 and onboarding_case.employee_id = employee.id
where employee.lifecycle_status = 'active';
```

## 3. Migrate existing personnel binaries

The migration script copies bytes to Hostinger, verifies SHA-256, and then changes the authoritative `managed_files` provider metadata. It deliberately leaves the Supabase object in place for rollback.

First rehearse:

```bash
DRY_RUN=1 npm run migrate:personnel-files
```

Resolve every `FAILED` line. Then execute:

```bash
DRY_RUN=0 npm run migrate:personnel-files
```

Validate:

```sql
select storage_provider, count(*)
from public.managed_files
where deleted_at is null
group by storage_provider;

select id, storage_path, storage_container, storage_etag, encryption_status, migrated_at
from public.managed_files
where storage_provider = 'hostinger_s3'
order by migrated_at desc
limit 20;
```

Download a sample of migrated files through the application and compare their SHA-256 values with `managed_files.sha256`. Keep legacy Supabase objects until the agreed rollback window and a separate, approved cleanup task.

## 4. Verify application readiness

After deployment:

```bash
curl --fail --silent 'https://YOUR_DOMAIN/api/ready'
```

The response must be HTTP 200 and show `configuration`, `database`, `migrations`, and `personnelStorage` as `ok`.

Also verify the outbox:

```bash
curl --fail --silent \
  -H "Authorization: Bearer $OUTBOX_WORKER_SECRET" \
  'https://YOUR_DOMAIN/api/internal/outbox'
```

`dead_letter` must be zero.

## 5. Manual acceptance test: employee creation and immediate login

1. Sign in as an organization Admin or HR Admin.
2. Open **الموظفون** and choose **إضافة موظف**.
3. Enter only the essential data:
   - full name;
   - email;
   - employment type;
   - starting/hiring date;
   - account role;
   - an HR-selected password that meets the displayed policy.
4. Do not upload identity, contract, insurance, or banking files during creation.
5. Save.
6. Confirm the employee appears as **نشط** immediately.
7. Open a private/incognito browser and sign in using the new employee email and HR-selected password.
8. Confirm login succeeds without a forced password-change screen.
9. Confirm the employee can only access pages allowed by the selected role.

Database evidence:

```sql
select
  employee.email,
  employee.lifecycle_status,
  employee.status,
  profile.account_status,
  profile.access_activated_at,
  profile.password_last_changed_at,
  profile.password_last_changed_by
from public.employees employee
join public.profiles profile
  on profile.org_id = employee.org_id
 and profile.user_id = employee.user_id
where lower(employee.email) = lower('TEST_EMPLOYEE_EMAIL');
```

Expected: lifecycle `active`, employee status `Active`, profile status `Active`, and non-null activation/password audit timestamps.

## 6. Manual acceptance test: HR password control

1. As HR, open **الموظفون**.
2. Edit the new employee.
3. Enter and confirm a different password, then save.
4. Confirm the old password no longer signs in.
5. Confirm the new password signs in.
6. Confirm there is no password value in `profiles`, `employees`, or audit metadata.
7. Confirm `password_last_changed_at` advanced and `password_last_changed_by` is the HR user.

This is a password replacement, not password recovery. HR cannot read the existing password.

## 7. Manual acceptance test: default readiness checklist

1. As HR, open **استكمال ملفات الموظفين**.
2. Find the new employee.
3. Confirm the employee is active while checklist progress is below 100%.
4. Confirm default items exist for:
   - official identity/file;
   - signed contract;
   - social insurance, except for interns;
   - bank/payment details;
   - work location;
   - work shift;
   - emergency contact.
5. Confirm capability badges show login/employment independently from payroll, payment, and attendance readiness.
6. Use **تعديل الموعد** on an item and confirm the date changes without changing login access.
7. Use **تجاوز** and provide a reason. Confirm the reason is displayed and the action appears in `operational_audit_logs`.
8. Use **إعادة فتح** and confirm progress recalculates.

## 8. Manual acceptance test: ad-hoc HR requirement

1. In the employee readiness card, choose **إضافة ملف أو متطلب خاص**.
2. Enter a specific request, for example “شهادة الآيبان مختومة”.
3. Enter a due date.
4. Choose **طلب الاستكمال**.
5. Sign in as the employee and open **استكمال ملفي**.
6. Confirm the employee sees this request and can upload a supported PDF, DOCX, JPEG, or PNG.
7. Upload the file.
8. Return as HR. Confirm the item shows **تم الرفع**.
9. Choose **بدء المراجعة**, then **اعتماد**.
10. Confirm progress and readiness recalculate.

Attempt to upload an executable, an oversized file, or a file with a false extension. The server must reject it before storage registration.

## 9. Manual acceptance test: Hostinger privacy

1. Upload a personnel file from the readiness page.
2. Verify `managed_files.storage_provider = 'hostinger_s3'`.
3. Confirm the object exists in the private Hostinger bucket under:
   `organization-id/employee-id/command-id/randomized-filename`.
4. Confirm opening the bucket object without a signed URL returns access denied.
5. Open the file through the application and confirm it downloads.
6. Wait more than 60 seconds and confirm the prior signed URL no longer works.
7. Confirm another employee cannot request the file URL.
8. Confirm the HR user can request it.

## 10. Manual acceptance test: reminders

Set a test requirement due date to one of the reminder milestones: 30, 14, 7, 3, 1, or 0 days ahead, or 1, 7, 14, or 30 days overdue.

Run:

```bash
curl --fail --silent --request POST \
  -H "Authorization: Bearer $COMPLIANCE_WORKER_SECRET" \
  'https://YOUR_DOMAIN/api/internal/compliance'

curl --fail --silent --request POST \
  -H "Authorization: Bearer $OUTBOX_WORKER_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"batchSize":100}' \
  'https://YOUR_DOMAIN/api/internal/outbox'
```

Confirm:

- Admin and HR Admin receive the notification.
- The employee receives it only when the requirement allows employee submission.
- Re-running the jobs does not create a duplicate notification for the same item, deadline, and milestone.
- The notification links to `/onboarding`.

## 11. Rollback boundaries

Application rollback is permitted only if the previous release is compatible with the added columns and tables. Database changes roll forward with a corrective migration; do not edit an applied SQL file.

If Hostinger access fails during the initial rollback window:

1. Stop new personnel uploads.
2. Restore application configuration or metadata only after identifying the exact affected rows.
3. Use the retained Supabase source objects as recovery inputs.
4. Do not bulk-change `storage_provider` without verifying that every corresponding legacy object exists and matches its recorded SHA-256.

Record every rollback action and preserve the database backup, migration ledger, migration-script output, and readiness responses.
