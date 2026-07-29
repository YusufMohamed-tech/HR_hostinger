# Product Inventory — Phase 4 Implementation

Phase 4 moves confirmed serialized products from the warehouse into field-agent custody and records their commercial outcome. It delivers manager handovers, optional agent acknowledgment, unsold returns, controlled sale prices, manager-approved exceptions, sale void/customer-return handling, agent collections, operational balances, movement history, and automatic finance visibility.

The phase does not create general-ledger entries. Receipts, product sales, sale voids, and collections retain an accounting status and produce durable business/outbox events; Phase 5 will consume those records for inventory, cost-of-goods, revenue, VAT, commission, cash, receivable, reversal, and consignment posting.

## Roles and authority

| Role | Phase 4 authority |
|---|---|
| Admin / Sales Manager / Onground Agent Manager | Issue handovers, choose acknowledgment policy, set unit price limits, review price exceptions, inspect custody/movements/sales/balances, void sales, and record collections |
| Field Agent | See only their own handovers, units, sales, collections, and price requests; acknowledge receipt, sell assigned units, request an exact price exception, and return unsold units |
| Inventory Receiver | Continues Phase 1–3 receiving and stock work; cannot assign agents, approve prices, void sales, or collect balances |
| Finance Manager / Accountant / Finance Viewer | Automatically sees current warehouse/agent inventory, cost, planned value, sales, gross profit, VAT, collections, and outstanding balances |

Every write is service-command owned. Browser roles cannot update commerce tables or call the database command function directly.

## Custody lifecycle

1. A manager selects an active warehouse and agent.
2. Available serialized units are grouped by product, cost, planned price, currency, and condition. Selecting a group includes its individual serials.
3. The manager sets the minimum and maximum permitted selling price for that group. The default is the planned price plus/minus the configured tolerance.
4. The handover is issued atomically:
   - acknowledgment required: units become `in_transit`;
   - acknowledgment waived by a manager: units become `with_agent` immediately.
5. When required, only the assigned agent (or an authorized manager) can accept the current handover version. All matching units become `with_agent`.
6. An unsold unit may return to an active warehouse. The unit becomes `in_stock`, keeps its original cost/planned-price snapshots, and records an `agent_return` movement.
7. A completed handover remains immutable evidence even after its units are sold, returned, or voided.

The invariant is one current custody owner per unit. A unit cannot be in a warehouse and assigned to an agent at the same time.

## Price controls and selling

An agent may sell only an unsold `with_agent` unit from an accepted handover line. The sale command locks the serialized unit and snapshots:

- product and serial;
- original unit cost and planned sale price;
- handover minimum and maximum;
- actual sale price;
- tax-included policy, VAT rate, net amount, VAT, and total;
- gross profit;
- agent commission rule and calculated commission.

A price below the minimum, above the maximum, or below cost is rejected unless the agent supplies an approved, unused exception for the same unit, handover, agent, and exact requested price. The exception becomes `used` in the same sale transaction.

The agent records the sale date, payment method, optional customer name/phone/reference, and actual price. The serialized unit becomes `sold`, leaves active custody, and retains its sale and handover references.

## Sale voids and customer returns

Only an inventory manager can void the current active sale version. A reason and disposition are mandatory:

- `sellable`: the exact unit returns to its original warehouse as `in_stock`;
- `damaged`: the unit becomes `damaged` and is not available for another handover.

The original sale and sale line are never deleted. Their cost, price, tax, profit, commission, customer, and serial snapshots remain available to Finance and audit. The void creates its own movement and event.

## Collections and balances

Managers record a dated collection against an active field agent. A collection cannot exceed the agent's outstanding product balance:

`active product sales − posted product collections`

The manager workspace and field-agent kiosk show active sales, collected value, and remaining balance. Assignment itself has no accounting effect; it is custody only.

## Finance visibility

`/accounting/inventory` now receives the following automatically:

- current `in_stock`, `in_transit`, `with_agent`, and returned units;
- unit cost and planned selling value by serial and location/agent;
- active and voided field-agent product sales;
- sale cost, actual value, gross profit, VAT, agent, and customer evidence;
- posted agent collections;
- total sales, total cost of sold units, gross profit, collected amount, and outstanding amount;
- pending/reversed/not-required accounting states.

This view is operational subledger evidence. Phase 5 owns GL mapping and posting.

## Application routes

| Route | Purpose |
|---|---|
| `/sales/inventory/assignments` | Manager handovers, grouped price policy, exceptions, sales, voids, collections, balances, and movement audit |
| `/agent/products` | Agent serialized custody dashboard |
| `/agent/products/receive` | Review serials and acknowledge a pending handover |
| `/agent/products/sell` | Record a controlled product sale or request an exact price exception |
| `/agent/products/returns` | Return selected unsold units to a warehouse |
| `/agent/product-balance` | Agent sales, collections, and outstanding balance |
| `/accounting/inventory` | Finance stock, cost, sales, profit, VAT, collection, and balance view |
| `GET/POST /api/sales/inventory/handovers` | Load manager workspace / issue an atomic handover |
| `POST /api/sales/inventory/handovers/[id]/accept` | Accept the current handover version |
| `POST /api/sales/inventory/returns` | Atomically return selected units |
| `POST /api/sales/inventory/price-overrides` | Request an exact sale-price exception |
| `POST /api/sales/inventory/price-overrides/[id]/review` | Manager approve/reject |
| `POST /api/sales/inventory/agent-sales` | Record one serialized product sale |
| `POST /api/sales/inventory/agent-sales/[id]/void` | Void a current sale and disposition its unit |
| `POST /api/sales/inventory/agent-collections` | Record a bounded agent collection |
| `GET /api/sales/inventory/me/dashboard` | Load the authenticated agent's product subledger |
| `GET /api/sales/inventory/movements` | Manager serialized movement audit |

## Atomicity, replay, and concurrency

`execute_product_commerce_command` owns all Phase 4 transitions. It:

- authenticates the organization role and active agent identity;
- records a command ID and canonical payload hash;
- returns the original result for an identical retry;
- rejects a reused command ID with a changed action, payload, or actor;
- locks all selected units in deterministic UUID order;
- enforces the current unit, handover, exception, and sale version/state;
- writes state, movement, business event, outbox event, and operational audit in one transaction.

The database test launches two simultaneous sale commands for the same serialized unit. Exactly one succeeds; the other observes the locked unit as already sold and rolls back without a second sale or event.

## Durable topics

- `product_inventory.handover_issued`
- `product_inventory.handover_accepted`
- `product_inventory.agent_returned`
- `product_inventory.price_override_requested`
- `product_inventory.price_override_reviewed`
- `product_inventory.sale_recorded`
- `product_inventory.sale_voided`
- `product_inventory.collection_posted`

The outbox worker notifies the assigned agent, inventory managers, or finance users as appropriate. It deliberately does not auto-post Phase 4 records to the general ledger.

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
npm run build
```

Database coverage proves acknowledgment, exact replay, manager/agent authority, price-policy rejection, exact approved exceptions, cost preservation, sale, collection limits, return, sellable void, movement counts, durable events, direct-browser denial, and one-winner concurrent selling.
