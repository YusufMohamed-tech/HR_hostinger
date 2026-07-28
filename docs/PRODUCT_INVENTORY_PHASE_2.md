# Product Inventory — Phase 2 Implementation

Phase 2 adds secure Excel/CSV receiving to the Phase 1 serialized inventory workflow. A receiver can download a stable template, upload a supplier workbook, review and correct every source row, and convert the complete file into priced receipt groups. Final stock creation still uses the Phase 1 confirmation command, so manual and workbook receipts produce the same receipt, unit, movement, valuation, and finance records.

Photo extraction is intentionally Phase 3.

## Receiver workflow

1. Open **Product inventory → Import Excel / CSV** and download the CSV template.
2. Select the supplier, warehouse, ownership type, receipt date, and optional delivery/invoice references.
3. Upload one `.xlsx` or `.csv` file. Legacy `.xls` and macro-enabled `.xlsm` files are rejected.
4. Review the preview counts: valid, warning, invalid, duplicate, and unmatched.
5. Correct product matches, serials, unit costs, planned selling prices, currency, and physical condition in the paginated row table.
6. Export invalid rows with their messages when the supplier file needs correction.
7. Commit only after every original data row is valid or warning-only. Phase 2 does not permit silent deletion or partial file acceptance.
8. Review the generated receipt groups and use **Confirm and enter stock**. Confirmation creates one stock unit and one receipt movement for every unique serial.

Rows are grouped by canonical product, unit cost, planned selling price, currency, and condition. Thus equivalent rows become one priced group while any valuation or condition difference remains traceable as a separate group.

## Workbook contract

The v1 template contains:

`supplier_code`, `receipt_reference`, `product_sku`, `product_name`, `model`, `serial_number`, `barcode`, `unit_cost`, `planned_sale_price`, `currency`, `tax_code`, `condition`, `notes`.

- One row represents one serialized physical unit.
- `serial_number` is required and should be formatted as text so leading zeros are retained.
- At least one of SKU, product name, or barcode is required for matching.
- Unit cost and planned selling price must each be greater than zero.
- Currency is a three-letter code and defaults to `SAR`.
- Condition accepts new, open-box, or refurbished values, including documented Arabic variants.
- English and Arabic header aliases are normalized.
- Matching order is exact SKU, barcode, normalized name, then approved catalog aliases; model narrows ambiguous matches.
- Original spreadsheet row numbers are preserved in review and error exports.

The server rejects formula-like product/serial/price cells and neutralizes formula prefixes in exported CSV files.

## Security and evidence

- Maximum upload size is 10 MB; the row cap defaults to 10,000 and can be lowered with `PRODUCT_INVENTORY_IMPORT_MAX_ROWS`.
- Upload signature/MIME inspection and the configured malware-scanning gate run before parsing or storage.
- The original file is stored in the private `product-inventory-imports` bucket under an organization/receipt/command-scoped path.
- SHA-256, detected MIME, scan engine/status/time, original name, size, and retention metadata are recorded in `managed_files`.
- Every original row, raw values, matched product, raw/normalized serial, corrections, confidence, errors, and warnings are retained in `product_inventory_import_rows`.
- Authorized receivers and managers open evidence through a short-lived signed URL; no public storage URL is persisted.
- Browser users cannot write import evidence or call preview/commit functions directly. Trusted API commands enforce tenant, role, active-account, supplier, warehouse, product, optimistic-version, and replay checks.

## Atomicity and replay

`execute_product_workbook_preview` registers the draft receipt, source evidence, all parsed rows, managed file, command result, business event, and outbox event in one transaction.

`execute_product_workbook_commit` requires the exact stored row set, rechecks product ownership and serial uniqueness, forms deterministic groups, and invokes `execute_product_receipt_command` from Phase 1 in the same transaction. A repeated command with the same payload returns its first result; reusing a command ID with different input fails.

The commit creates a `ready_to_confirm` receipt. Physical stock is not created until the receiver explicitly confirms it from the receipt screen.

## Application routes

| Route | Purpose |
|---|---|
| `/sales/inventory/receipts/import` | Upload, preview, correct, and commit a workbook |
| `GET /api/sales/inventory/template` | Download the v1 CSV template |
| `POST /api/sales/inventory/receipts/[id]/excel-preview` | Inspect, parse, store, and preview XLSX/CSV evidence |
| `POST /api/sales/inventory/receipts/[id]/excel-commit` | Validate all rows and atomically build receipt groups |
| `GET /api/sales/inventory/receipts/[id]/sources/[sourceId]` | Issue an authorized short-lived evidence URL |
| `/sales/inventory/receipts/[id]` | Review grouped results, open the original file, and confirm stock |

## Verification

Run:

```bash
npm run db:verify-migrations
npm run verify:outbox
npm run typecheck
npm run lint:strict
npm run test:unit
npm run test:db
npm run verify:launch-contract
npm run verify:accounting
npm run test:sim
npm run build
```

Unit tests cover Arabic headers, leading-zero strings, numeric-serial rejection, duplicate and unmatched rows, quoted CSV cells, and formula-safe export. The disposable PostgreSQL test proves replay, evidence linkage, full-row enforcement, grouping splits, valuations, Phase 1 confirmation reuse, event emission, and denial of browser writes/RPC execution.
