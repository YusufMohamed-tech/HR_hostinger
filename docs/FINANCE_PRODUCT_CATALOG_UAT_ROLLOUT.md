# Finance Product Catalog — UAT, Rollout, and Operations Runbook

## Purpose

This runbook covers the Finance Manager product catalog at `/sales/inventory/products`, including manual products, automatic XLSX/CSV recognition, atomic bulk commit, receipt matching, monitoring, and rollback.

## Preconditions

- Migrations through `schema_v155_product_catalog_operations` are applied and checksum verified.
- The organization has Sales or Accounting enabled.
- The test user has `finance_manager` or `admin` role.
- At least one active `sales_companies` supplier exists.
- `finance_product_catalog_enabled` is true in `product_inventory_commerce_settings`.
- Private `product-inventory-imports` storage is available.
- Background retention and outbox workers are running.

## Required UAT matrix

### Access and least privilege

1. Sign in as Finance Manager and confirm **كتالوج المنتجات** appears in the inventory sidebar.
2. Confirm Admin can open the page.
3. Confirm Accountant, Finance Viewer, Employee, Supervisor, and Field Agent receive 403 from the catalog APIs.
4. Confirm Finance Manager does not gain access to unrelated Sales Manager endpoints.
5. Attempt cross-tenant supplier, account, product, analysis, and command IDs; every attempt must fail closed.

### Manual product management

1. Add an active product with supplier, name, SKU, model, sale price, cost, and flat commission.
2. Confirm it is stored as `inventory_enabled = true` and `tracking_mode = serialized`.
3. Try duplicate normalized SKU under the same supplier and duplicate barcode in the organization; both must fail.
4. Edit price and commission with the current `inventory_version` and confirm the version increments.
5. Repeat the same command ID and payload; it must return the original result without duplication.
6. Reuse the command ID with a changed payload; it must fail.
7. Submit a stale version; it must return a conflict.
8. Deactivate and reactivate the product, confirming audit history and receipt lookup behavior.

### Workbook recognition

1. Download `product-catalog-template.xlsx` and open both **المنتجات** and **تعليمات** sheets.
2. Upload the unmodified example after selecting a supplier.
3. Confirm the system detects sheet `المنتجات`, header row 3, and preserves the leading zero in the barcode.
4. Repeat with reordered columns, English headers, a title row, multiple worksheets, and CSV.
5. Confirm no product is written during analysis.
6. Test malformed ZIP/XLSX, `.xlsm`, `.xls`, oversized files, more than 10,000 rows, and more than 200 columns.
7. Test formula-like cells and verify they are rejected.
8. Test duplicate SKU/barcode rows and barcode ownership by a different supplier.
9. Confirm low-confidence recognition is labeled for review and raw JSON is never required from the user.

### Atomic bulk commit

1. Upload a mixed file containing new, unchanged, changed, invalid, duplicate, and conflicting rows.
2. Confirm counts and row classifications before commit.
3. Leave **update existing products** unchecked; new products must be created and changed existing rows skipped.
4. Repeat with update enabled; safe existing matches must update.
5. Modify a matched product after analysis and before commit; the entire selected mutation transaction must roll back with a version conflict.
6. Cause a uniqueness conflict before commit; no selected product may be partially written.
7. Retry an identical commit command; it must return the original result.
8. Download the rejection CSV and verify spreadsheet-formula injection is neutralized.
9. Confirm each created/updated product has a `product_catalog_audit_logs` row and a durable outbox event.

### Catalog-to-receipt integration

1. Create a product for Supplier A and confirm it appears in the Supplier A receipt setup/API immediately.
2. Confirm it does not appear for Supplier B.
3. Match it by barcode, then SKU, then exact supported name/model evidence.
4. Change receipt cost and planned sale price from catalog defaults.
5. Confirm receipt preview displays warnings but preserves workbook values as transaction evidence.
6. Confirm a deactivated product is excluded from new receipt matching while historical receipt snapshots remain unchanged.

## Monitoring

Call the authenticated internal endpoint:

```text
GET /api/internal/product-inventory
Authorization: Bearer <OUTBOX_WORKER_SECRET>
```

The `product_catalog` section must report:

- stale commands;
- stale committing analyses;
- failed analyses in the last 24 hours;
- low-confidence analyses in the last 24 hours;
- overdue source-file cleanup;
- oldest active exception.

Operational alerts should fire when any stale, failed, or overdue count is non-zero, or when low-confidence analyses exceed the configured daily threshold.

## Retention and recovery

- Uncommitted analyses expire after 24 hours.
- Source workbooks are private managed files with a 30-day maximum retention unless legal hold applies.
- The retention worker calls `expire_product_catalog_import_analyses` in bounded batches.
- The worker calls `recover_stale_product_catalog_commands` for commands abandoned longer than 15 minutes.
- Recovered commands and their committing analyses enter a terminal failed state; the user re-analyzes with new IDs.

## Controlled rollout

1. Deploy additive migrations and application code with the organization flag disabled if a staged rollout is needed.
2. Run migration, type, lint, unit, database/RLS, outbox contract, hardening, and production build checks.
3. Enable one internal organization and complete all Required UAT cases.
4. Enable the client organization and import a small representative router catalog.
5. Complete a catalog-to-receipt transaction before importing the full catalog.
6. Monitor conflicts, low-confidence recognition, commit duration, stale commands, and receipt match rate for one business cycle.
7. Record Finance, Operations, and Engineering sign-off.

## GO / NO-GO

GO requires:

- all UAT cases pass;
- no cross-tenant or role bypass;
- atomic rollback and idempotent retry verified;
- downloaded template parses through the production reader;
- catalog products match only the selected supplier in receipt imports;
- monitoring and cleanup return healthy results;
- rollback switch tested.

Any missing condition is NO-GO.

## Rollback and forward-fix

1. Set `finance_product_catalog_enabled = false` for the affected organization.
2. This hides/disables new catalog mutations while existing products and receipt operations remain available.
3. Do not drop migrations, products, analyses, audit logs, events, or historical receipt snapshots.
4. Allow active database transactions to finish; recover any command left stale after 15 minutes.
5. Diagnose using request ID, command ID, analysis ID, audit log, and outbox event.
6. Deploy an additive forward migration or application patch.
7. Re-run the Required UAT subset and monitoring checks before re-enabling.

## Sign-off record

Record:

- organization ID;
- deployed commit and schema checksum;
- UAT operator and date;
- representative analysis and command IDs;
- created/updated/skipped counts;
- receipt used for integration proof;
- monitoring snapshot;
- Finance approver;
- Operations approver;
- Engineering approver;
- final GO or NO-GO decision.
