# Virgin Product Inventory — Phase 5 Accounting Implementation

Phase 5 connects confirmed product operations to the general ledger without Finance re-entering receipt, sale, collection, commission, or loss data.

## Posting contract

| Source | Journal |
|---|---|
| Purchased receipt with supplier invoice | Dr Product Inventory / Cr Accounts Payable |
| Purchased receipt without supplier invoice | Dr Product Inventory / Cr GRNI |
| Consignment receipt | No company-owned inventory journal; memo valuation only |
| Agent handover, acceptance, or return | No journal; custody movement only |
| Product sale | Dr Product Agent Receivable / Cr Revenue / Cr Output VAT / Dr COGS / Cr Inventory |
| Enabled product-agent commission | Dr Commission Expense / Cr Commission Payable |
| Agent collection | Dr Cash or Bank / Cr Product Agent Receivable |
| Sale void | Exact journal reversal, or cancellation when the source journal still awaits approval |
| Purchased inventory damage/loss | Dr Inventory Shrinkage / Cr Product Inventory |
| Consignment damage/loss | No company-owned inventory journal |
| Commission settlement | Dr Commission Payable / Cr Cash or Bank through a linked posted accounting payment |

Receipt `unit_cost` remains the acquisition-cost snapshot. Supplier input VAT is not inferred from the product selling-tax flag. Recoverable input VAT must come from a captured supplier invoice/tax document; this prevents fabricating VAT from incomplete operational data.

## Automation and controls

- Receipt journals default to `pending_approval`; Finance can enable direct posting.
- Product sales and agent collections post automatically by default.
- Because collections are currently agent-level rather than sale-allocated, collection posting fails closed when that agent has an active consignment sale. Finance sees the exception until the signed consignment arrangement and allocation rule are configured.
- Commission accrual is optional and requires both commission expense and payable accounts.
- Account mappings are snapshotted on receipt and sale lines. Later catalog changes do not rewrite historical journal intent.
- Every source has one accounting posting record with its journal, reversal, attempt count, last error, timestamps, and amount summary.
- Deterministic journal command IDs make worker replay and manual retry idempotent.
- Posting failures emit `product_inventory.accounting_failed`, notify Finance, and remain in the outbox retry/dead-letter workflow.
- A posted journal that began in approval state promotes its operational source to `posted` through the journal event handler.

## Finance workflow

The `/accounting/inventory` screen provides:

- Company-owned stock cost and expected retail value.
- Separate consignment memo quantity/value.
- Actual revenue, COGS, gross profit, VAT, collections, and agent outstanding balances.
- Operational stock-to-inventory-GL and agent-receivable-to-GL reconciliation, with company-owned and consignment sales disclosed separately.
- Failed, pending, and pending-approval posting queues with idempotent retry.
- Finance Manager account mapping and auto-post settings.
- Product commission accruals and linked cash/bank settlement.
- Serialized loss/damage accounting history.

Inventory managers record a loss or damage from `/sales/inventory/assignments`. The command locks the unit, snapshots its serial/product/cost/ownership, closes open custody, writes the movement and audit event, and then lets the outbox worker recognize company-owned shrinkage.

## APIs

- `GET /api/accounting/inventory`
- `GET/PATCH /api/accounting/inventory/settings`
- `POST /api/accounting/inventory/[sourceType]/[sourceId]/retry-posting`
- `POST /api/accounting/inventory/commissions/[commissionId]/settle`
- `GET/POST /api/sales/inventory/losses`

Settings changes and commission settlements require `finance_manager`. Posting retry allows `finance_manager` and `accountant`. Loss/damage recording requires an inventory manager.

## Database

Migration `schema_v127_product_inventory_accounting` adds:

- Inventory account settings and seeded system accounts.
- Source journal/reversal/error/attempt links.
- Immutable source accounting reconciliation records.
- Product sale account snapshots.
- Serialized loss/damage records and an atomic loss command.
- Product-agent commission accrual and settlement records.
- Service-only marker, accrual, reversal, settlement, and settings functions.
- RLS read boundaries for Finance and inventory managers.

## Verification

Phase 5 is covered by:

- Balanced receipt, sale/VAT/COGS/commission, collection, and loss builder tests.
- Loss command input validation.
- Full disposable PostgreSQL migration/RLS smoke tests.
- Outbox producer/handler contract verification.
- Strict TypeScript and ESLint checks.
