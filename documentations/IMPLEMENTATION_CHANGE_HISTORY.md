# Implementation Change History

**Project:** Tatwir Talent HRMS
**Scope:** Serialized product inventory, Finance custody, returns, Excel recognition, and navigation
**Documentation date:** 2026-08-01
**Baseline:** `91a3a72` — documented the 5G router inventory implementation decisions

This document records the delivered implementation process and the code/database changes that followed the product-inventory blueprint. It complements the detailed phase documents in `docs/` and is intended to be the quickest way to understand what changed, where it changed, and how it was verified.

## Current status

- Commits through `1efe1d2` are on `main` and `origin/main`.
- The employee-custody navigation change is delivered and pushed.
- The Excel-profile confirmation UI and database smoke-test coverage were released in `1efe1d2`.
- Existing untracked chat-blueprint files are unrelated to the inventory work and are intentionally not included in this history.

## Delivery timeline

| Commit / state | Change | Main code and database areas | Result |
|---|---|---|---|
| `91a3a72` | Inventory implementation decisions | `docs/5G_ROUTER_FINANCE_CUSTODY_IMPLEMENTATION_BLUEPRINT.md` | Established serialized units, custody ownership, evidence, idempotent commands, and Finance boundaries. |
| `67b44b4` | Commercial terms and import profiles | Migration v143; import-profile and pricing screens/APIs | Added versioned workbook profiles, unit cost/sale-price terms, commission snapshots, and Finance-controlled profile activation. |
| `4b4527e` | Project-scoped employee custody | Migration v144; `ProductEmployeeCustodyScreens.tsx`; custody services/API/RBAC | Added OGPM/OGSV1 operational assignments, project/city scope, employee handovers, acknowledgment, custody reporting, and movement evidence. |
| `f3f7524` | Evidence-backed returns | Migration v145; `ProductReturnWorkflowScreen.tsx`; return services/API | Added serialized return requests, return lines, photos, approval, cancellation, physical receipt, and private evidence URLs. |
| `5cee71c` | Return events and damage posting | Migration v146; outbox worker; reconciliation/reporting | Added durable return events, return reconciliation, damage/loss handling, and notifications for return lifecycle events. |
| `2ca9c8b` | Return hardening for rollout | Migration v147; return guards and verification | Added feature/authorization guards, reconciliation checks, and rollout safety rules for return submission. |
| `8fbd356` | Automatic workbook recognition plan | `docs/5G_ROUTER_AUTOMATIC_EXCEL_RECOGNITION_PLAN.md` | Defined safe workbook upload, sheet/header detection, Arabic/English mapping, confidence, evidence, review, and profile activation. |
| `c07fbf8` | Automatic workbook recognition engine | Migration v148; `src/lib/product-inventory/workbook-recognition.ts`; workbook server/types/tests | Implemented deterministic workbook analysis, layout fingerprints, field proposals, confidence/status, catalog evidence, and persisted analysis evidence. |
| `d208930` | Navigation label correction | `src/components/layout/Sidebar.tsx` | Renamed `تسليم المندوبين القديم` to `تسليم المندوبين`. |
| `14cc654` | Nested employee-custody tabs | `Sidebar.tsx`; `ProductEmployeeCustodyScreens.tsx` | Added nested links for إصدار تسليم, التكليفات التشغيلية, تقرير العهد, and سجل التسليمات, synchronized through `?tab=` URLs. |
| `1efe1d2` | Replace JSON mappings with Excel analysis | Migration v149; analysis routes; import-profile screen/service | Released the Excel sample upload, recognition review, Finance confirmation, immutable profile creation, idempotency, and database smoke coverage. |
| Current delivery | Sidebar-only inventory navigation | `Sidebar.tsx`; `ProductEmployeeCustodyScreens.tsx` | Removes the duplicate page tab bar and groups inventory links under `المخزون`, separate from `المالية والمحاسبة`. |

## End-to-end implementation process

### 1. Establish the serialized inventory foundation

The implementation started with a single canonical serialized-unit model. Receipts, receipt lines, serials, movements, commands, costs, and planned selling values are recorded as tenant-scoped data. All mutations use server-side command functions with organization, role, state, version, and idempotency checks. This keeps manual receiving, workbook receiving, photo receiving, custody, returns, sales, and Finance reporting on the same unit history.

### 2. Add controlled receiving channels

Three receiving channels now converge on the same confirmation command:

1. Manual grouped receipt entry at `/sales/inventory/receipts/new`.
2. XLSX/CSV upload and row correction at `/sales/inventory/receipts/import`.
3. Photo/OCR extraction and review at `/sales/inventory/receipts/photo`.

Each channel keeps source evidence, validates serial uniqueness, requires prices and condition, prevents silent row deletion, and creates stock only after explicit confirmation. The confirmed result is visible to Finance at `/accounting/inventory`.

### 3. Add commercial terms and reusable workbook profiles

Migration v143 introduced versioned import profiles and commercial terms. Product/receipt/unit/handover/sale snapshots preserve the values used at the time of each transaction. Later catalog or commission changes do not rewrite historical evidence. Profile activation is Finance-controlled and supports supplier-specific mappings and defaults.

### 4. Add employee custody and operational assignment

Migration v144 added active OGPM/OGSV1 assignments with employee, project, location, city, responsibility, and capability flags. Finance can issue exact serialized units to an eligible assignment. Acknowledgment is accepted only by the intended recipient or an authorized manager, and reports expose received, ready, returned, awaiting-delivery, and physically-held counts.

The manager screen is implemented in `src/components/product-inventory/ProductEmployeeCustodyScreens.tsx`. Its four views are:

- `handover` — إصدار تسليم
- `assignments` — التكليفات التشغيلية
- `report` — تقرير العهد
- `history` — سجل التسليمات

The sidebar links use `/sales/inventory/employee-custody?tab=<value>`. The page reads the same query parameter and renders only the selected view; the visible tab controls live exclusively in the sidebar.

### 5. Add evidence-backed returns

Returns were implemented as a separate lifecycle rather than a destructive status update. The requester selects exact serials, adds notes and required photos, and submits a return request. Finance or an authorized project manager reviews it, and Finance physically receives each serial with scanned-serial verification and a disposition such as sellable, quarantine, or damaged.

The original handover, return request, approval, attachment, receipt, movement, audit, and outbox records remain durable. A return reservation blocks a unit from being sold or handed over again until the request is rejected, received, or otherwise completed.

### 6. Add automatic Excel recognition

The recognition engine in `src/lib/product-inventory/workbook-recognition.ts` analyzes all bounded workbook sheets and proposes:

- the relevant sheet and header row;
- Arabic, English, or mixed column mappings;
- serial, barcode, SKU, product, model, cost, sale price, commission, currency, tax, condition, and notes fields;
- product matches using catalog values and approved aliases;
- workbook shape, layout fingerprint, warnings, and confidence;
- sample-row issues such as missing, duplicate, malformed, ambiguous, or previously imported serials.

Recognition is deterministic and explainable. Header aliases, normalized text, data-shape evidence, catalog matches, and approved mapping history are combined into one-to-one field proposals. Required fields remain blocking even when a confidence score is high. The original upload is stored privately with hash, MIME, scan, retention, and analysis metadata.

### 7. Improve navigation without changing business behavior

The navigation changes were intentionally limited to labels, hierarchy, and tab deep links:

- `تسليم المندوبين القديم` became `تسليم المندوبين`.
- `تسليم وعهد الموظفين` became the parent item for four indented Finance navigation links.
- Existing routes and role restrictions were preserved.
- The nested links are visible in the Finance Manager accounting section and do not alter the underlying custody commands.

## Released route map

| Area | Routes |
|---|---|
| Inventory dashboard | `/sales/inventory`, `/accounting/inventory` |
| Manual receipt | `/sales/inventory/receipts/new`, `/sales/inventory/receipts/[id]` |
| Excel/CSV receipt | `/sales/inventory/receipts/import`, `/api/sales/inventory/receipts/[receiptId]/excel-preview`, `/api/sales/inventory/receipts/[receiptId]/excel-commit` |
| Photo receipt | `/sales/inventory/receipts/photo`, `/api/sales/inventory/receipts/[receiptId]/photo-preview`, `/api/sales/inventory/receipts/[receiptId]/photo-commit` |
| Import profiles | `/sales/inventory/import-profiles`, `/api/sales/inventory/import-profiles`, `/api/sales/inventory/import-profiles/[profileId]/activate` |
| Employee custody | `/sales/inventory/employee-custody`, `/sales/inventory/custody`, `/api/sales/inventory/employee-handovers`, `/api/sales/inventory/custody` |
| Operational assignments | `/api/sales/inventory/operational-assignments` |
| Returns | `/sales/inventory/returns`, `/api/sales/inventory/return-requests`, `/api/sales/inventory/return-requests/[requestId]/review`, `/api/sales/inventory/return-requests/[requestId]/receive`, `/api/sales/inventory/return-requests/[requestId]/cancel` |
| Legacy agent handover | `/sales/inventory/assignments`, `/api/sales/inventory/handovers` |

## Database and security model

The recent inventory migrations are additive and ordered through the migration manifest:

| Migration | Purpose |
|---|---|
| v122–v124 | Serialized inventory foundation and workbook receiving |
| v125 | Photo extraction evidence |
| v126–v128 | Agent commerce, accounting visibility, and hardening |
| v142 | Finance-managed inventory command consolidation |
| v143 | Commercial terms and import profiles |
| v144 | Employee custody and operational assignments |
| v145 | Evidence-backed return workflow |
| v146 | Return events and damage/reconciliation reporting |
| v147 | Return rollout hardening |
| v148 | Automatic workbook recognition analysis |
| v149 | Profile confirmation from recognized workbook evidence and Finance review — released in `1efe1d2` |

Security invariants applied throughout the implementation:

- every query and command is organization-scoped;
- browser clients cannot call service-only mutation functions directly;
- role checks distinguish Finance, inventory receiver, manager, recipient, project manager, supervisor, and field-agent capabilities;
- private files are accessed through authorized short-lived URLs;
- command IDs and payload hashes make retries safe and changed replays fail;
- serialized units are locked in deterministic order for conflicting operations;
- append-only movements and durable events preserve auditability.

## Verification and release process

The implementation process used the following sequence:

1. Inspect current navigation, routes, services, migrations, and worktree status.
2. Make the smallest scoped code change for the requested behavior.
3. Run `git diff --check` to catch whitespace/errors in the patch.
4. Run targeted ESLint for edited TypeScript/TSX files.
5. Run `npm run typecheck` for type safety.
6. Stage only the intended files when unrelated work exists in the worktree.
7. Commit with a focused message.
8. Push the requested commit to `main`.

For the nested-tab delivery specifically, targeted ESLint and the full TypeScript typecheck passed before commit `14cc654`. The label rename was delivered in commit `d208930` and pushed separately. Full CI remains available through:

```bash
npm run verify:ci
```

The database and feature-specific verification commands are documented in the phase files:

- [Product Inventory Phase 1](../docs/PRODUCT_INVENTORY_PHASE_1.md)
- [Product Inventory Phase 2](../docs/PRODUCT_INVENTORY_PHASE_2.md)
- [Product Inventory Phase 3](../docs/PRODUCT_INVENTORY_PHASE_3.md)
- [Product Inventory Phase 4](../docs/PRODUCT_INVENTORY_PHASE_4.md)
- [Automatic Excel Recognition Plan](../docs/5G_ROUTER_AUTOMATIC_EXCEL_RECOGNITION_PLAN.md)

## Pending work at documentation time

The current working tree contains an unrelated untracked workbook-normalization experiment. The file `src/lib/product-inventory/workbook-normalization.ts` is not part of the released history or this navigation change and remains intentionally untouched.
