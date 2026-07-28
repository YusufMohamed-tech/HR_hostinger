# Product Inventory — Phase 1 Implementation

Phase 1 delivers the manual, serialized product-receiving foundation from the Virgin product inventory blueprint. Excel/CSV receiving is delivered in Phase 2; photo extraction, agent handover, field sales, returns, and automatic journal posting remain later phases.

## Delivered workflow

1. An administrator creates an employee account with the `inventory_receiver` role.
2. A sales manager marks a supplier product as inventory-enabled and optionally records SKU, barcode, model, and default unit cost.
3. The receiver opens **Sales → Product inventory → New manual receipt**, selects the supplier and warehouse, and creates one or more product groups.
4. Every group requires a product, positive unit cost, positive planned selling price, condition, and at least one serial number. Quantity, total cost, expected sales value, and expected margin are derived from the serial list.
5. Saving creates or updates a versioned receipt draft. Confirming atomically creates one serialized stock unit and one append-only receipt movement per accepted serial.
6. Finance users automatically see confirmed receipts, their cost, planned sales value, expected margin, ownership type, and accounting status at **Accounting → Product inventory**.

Purchased receipts remain `accounting_status = pending`; consignment receipts use `not_required`. Phase 1 intentionally gives finance operational visibility without creating a journal entry. Actual inventory/GRNI or consignment accounting is Phase 5.

## Authorization

- `inventory_receiver`: inventory pages/APIs only; may change, confirm, or cancel only receipts they created.
- `admin`, `sales_manager`, `onground_agent_manager`: receive and manage receipts.
- `finance_manager`, `accountant`, `finance_viewer`: read-only confirmed valuation through the accounting endpoint.
- Browser clients have select-only RLS. All mutations go through the service-only atomic command after tenant, role, feature, product, supplier, warehouse, version, and idempotency validation.

## Data model

- `sales_products`: SKU/barcode/model, serialized tracking, inventory flag, default cost, accounting links, commission defaults, inventory version.
- `inventory_warehouses`: tenant/entity/branch-scoped warehouse master with one default warehouse seeded per organization.
- `product_receipts`, `product_receipt_lines`, `product_receipt_candidates`, `product_receipt_sources`: receipt header, priced groups, serial staging, and future import evidence.
- `product_inventory_units`: canonical serialized stock and cost/sale-price snapshots.
- `product_inventory_movements`: append-only custody/movement history.
- `product_inventory_commands`: replay protection for save, confirm, and cancel.

The global tenant serial index uses `normalize_product_serial()` so formatting variants such as `VG-001` and `vg001` cannot be confirmed twice.

## Application routes

| Route | Purpose |
|---|---|
| `/sales/inventory` | Receipt and serialized-stock dashboard |
| `/sales/inventory/receipts/new` | Manual grouped receipt entry |
| `/sales/inventory/receipts/[id]` | Receipt totals, groups, serials, confirmation/cancellation |
| `/accounting/inventory` | Finance-only confirmed valuation |
| `GET /api/sales/inventory/setup` | Active suppliers, warehouses, inventory products |
| `GET/POST /api/sales/inventory/receipts` | List receipts / atomically save a draft |
| `GET /api/sales/inventory/receipts/[id]` | Tenant-scoped receipt details |
| `POST /api/sales/inventory/receipts/[id]/confirm` | Atomically create stock and movements |
| `POST /api/sales/inventory/receipts/[id]/cancel` | Cancel an unconfirmed receipt with reason |
| `GET /api/sales/inventory/stock` | Serialized stock and valuation totals |
| `GET /api/accounting/inventory` | Confirmed finance valuation |

## Operational verification

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

The disposable database test proves fresh migration application, command replay, exact unit/movement counts, valuation totals, confirmed-serial uniqueness, outbox events, and denial of direct authenticated mutations/RPC execution.
