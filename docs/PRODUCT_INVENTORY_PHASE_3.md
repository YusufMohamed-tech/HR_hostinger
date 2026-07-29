# Product Inventory — Phase 3 Implementation

Phase 3 adds mobile photo receiving to the serialized inventory workflow. A receiver can photograph one or more product labels, extract product and serial candidates locally, correct every candidate, set mandatory cost and planned selling prices, and convert the complete reviewed photo set into the same priced receipt groups used by manual and workbook receiving.

No external AI service receives the image. The browser uses Tesseract OCR and ZXing barcode recognition, and the original evidence remains in private storage.

## Receiver workflow

1. Open **Product inventory → Receive by photo**.
2. Select the supplier, warehouse, ownership type, receipt date, and optional delivery/invoice references.
3. Capture or select up to eight JPEG, PNG, or WebP product-label photos.
4. Run local extraction. Optional grayscale/contrast enhancement is applied only to the temporary OCR copy; the original image is preserved.
5. Review the extracted candidates and correct the catalog product, serial number, unit cost, planned selling price, currency, and condition.
6. Resolve every invalid, duplicate, or unmatched candidate. A warning requires explicit acceptance.
7. Review the live grouping summary and commit all candidates. Candidates cannot be silently deleted or partially accepted.
8. Open the generated receipt and use **Confirm and enter stock**. Confirmation creates one serialized stock unit and one receipt movement per serial through the Phase 1 command.

Candidates with the same canonical product, unit cost, planned selling price, currency, and condition become one receipt group. A price or condition difference remains a separate group.

## Extraction and confidence

The local provider emits engine/version metadata, OCR text, OCR confidence, decoded barcode values, and OCR word bounding boxes. The deterministic parser recognizes English and Arabic product, SKU, model, serial, IMEI, and barcode label patterns.

Catalog matching order is exact SKU, exact barcode, normalized product name, approved alias, then a conservative fuzzy-name match. Model values narrow ambiguous catalog matches.

- Confidence of 90% or higher is eligible for a clean result.
- Confidence from 70% to 89% requires receiver review and explicit warning acceptance.
- Lower confidence or a missing product/serial remains unresolved until corrected.
- Confirmed-stock duplicates are blocking; duplicates in another draft are warnings.
- Fuzzy matches always require review.

The server never trusts a client decision by itself. It reloads the stored extraction rows, requires the exact source/candidate set, validates the supplier catalog, normalizes serials, rechecks confirmed-stock duplicates, preserves warnings, and then calls the atomic database command.

## Alias learning

Managers may approve a corrected raw product label as a supplier-specific catalog alias during commit. Receivers can correct matches but cannot create aliases. Alias creation is explicit and never overwrites an existing alias automatically.

The next extraction may use an approved alias, while the original raw label and the manager who approved it remain auditable.

## Security and evidence

- Each request accepts one to eight images, at most 10 MB each and 40 MB total.
- File extension, declared MIME, actual signature, image type, size, and the configured malware-scanning gate are validated before storage.
- Originals are stored in the private `product-inventory-photos` bucket under organization/receipt/command-scoped paths.
- SHA-256, detected MIME, scan engine/status/time, original filename, size, retention metadata, OCR engine/version, raw text, barcodes, bounding boxes, and confidence are retained.
- Suggested values, final corrected values, correction flags, approving actor, and timestamps are stored in `product_inventory_photo_candidates`.
- Evidence is opened only through the existing authorized short-lived signed-URL endpoint.
- Browser roles have read-only RLS visibility and cannot write photo evidence or invoke the service-only preview/commit commands.

## Atomicity, replay, and accounting visibility

`execute_product_photo_preview` creates the draft receipt, all photo sources, managed-file evidence, parsed candidates, command result, business event, and outbox event in one transaction.

`execute_product_photo_commit` requires all stored candidates, validates warning acceptance and alias authority, creates deterministic price groups, and calls `execute_product_receipt_command` in the same transaction. It records correction metrics and source completion before emitting `product_inventory.photo_committed`.

Both commands are idempotent: an identical retry returns the original result, while reusing a command ID with a changed payload fails.

The committed receipt becomes `ready_to_confirm`; stock and accounting visibility are created only after explicit confirmation. Confirmation reuses the Phase 1 flow, so Finance receives unit count, physical cost, planned selling value, expected margin, ownership type, and pending accounting status without re-entering photo data.

## Application routes

| Route | Purpose |
|---|---|
| `/sales/inventory/receipts/photo` | Capture, extract, review, price, group, and commit photos |
| `POST /api/sales/inventory/receipts/[id]/photo-preview` | Inspect/store originals and atomically persist extraction evidence |
| `POST /api/sales/inventory/receipts/[id]/photo-commit` | Revalidate every candidate and atomically build receipt groups |
| `GET /api/sales/inventory/receipts/[id]/sources/[sourceId]` | Issue an authorized short-lived URL for workbook or photo evidence |
| `/sales/inventory/receipts/[id]` | Review groups and source photos, then confirm stock |

## Verification and client sample calibration

Automated coverage verifies labeled OCR parsing, multiple serials, barcode fallback, alias and fuzzy matching, confidence warnings, unresolved values, confirmed/draft duplicates, command replay, exact-candidate enforcement, warning acceptance, manager-only aliases, grouping, valuation, evidence linkage, outbox events, stock confirmation, and denial of direct browser writes.

Run:

```bash
npm run db:verify-migrations
npm run verify:outbox
npm run typecheck
npm run lint:strict
npm run test:unit
npm run test:db
npm run build
```

Accuracy against real Virgin labels is a UAT activity because no approved client sample set is stored in the repository. For each representative photo, record expected versus extracted product and serial, confidence, correction type, and final accepted values. Use the stored correction metrics to tune label patterns or add manager-approved aliases without losing the original evidence.
