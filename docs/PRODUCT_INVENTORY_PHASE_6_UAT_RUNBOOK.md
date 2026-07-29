# Product Inventory — Phase 6 UAT and Operations Runbook

## Scope and release status

Phase 6 hardens the Virgin receiving, serialized stock, field-agent commerce,
and automatic accounting flow for production-sized data and operational
failures. The repository implementation is complete when every automated gate
below passes.

Real Virgin delivery samples, named business approvers, and the controlled
pilot are external release gates. They must be completed in the target
environment before production rollout.

For the exact production click-through, expected results, evidence, cleanup,
and sign-off sequence, use
`PRODUCT_INVENTORY_PRODUCTION_MANUAL_TESTING_GUIDE.md`.

## Automated release gates

Run these commands from the repository root:

```bash
npm run db:verify-migrations
npm run verify:product-inventory
npm run typecheck
npm run lint:strict
npm run test:unit
npm run test:db
npm run verify:outbox
npm run verify:accounting
npm run build
```

The database suite provides evidence for:

- tenant and role isolation;
- duplicate-serial and concurrent receipt confirmation protection;
- concurrent sale protection;
- full receipt rollback when the outbox write fails;
- full sale rollback when the accounting event write fails;
- accounting-status rollback when an accounting-failure event cannot be
  written;
- service-only access to exact operational and finance summaries.

The product inventory verifier checks pagination, indexed large feeds,
upload bounds, private agent DTOs, monitoring authentication, and the required
operational procedures in this runbook.

## UAT prerequisites

- Apply all migrations through `schema_v128_product_inventory_hardening`.
- Configure `OUTBOX_WORKER_SECRET` for the worker and monitoring endpoint.
- Configure one inventory receiver, one sales manager, one finance approver,
  one warehouse, and a small group of field agents.
- Create the Virgin supplier and the real product catalog, including approved
  Arabic and English aliases.
- Prepare a redacted delivery sample with known expected product names,
  serials, costs, planned selling prices, currency, ownership, and condition.
- Use non-production customer data and test payment references during UAT.
- Record the build commit, migration checksum, browser/device, actor, and
  evidence link for every scenario.

## UAT scenario matrix

| ID | Actor | Scenario | Expected result |
|---|---|---|---|
| UAT-01 | Receiver | Enter a delivery manually | Every valid unique serial becomes one candidate; count equals serial count |
| UAT-02 | Receiver | Import the approved XLSX/CSV template | Arabic/English headers and leading-zero serials survive preview and commit |
| UAT-03 | Receiver | Capture/select real label photos on mobile | Product and serial suggestions include confidence and retained evidence |
| UAT-04 | Receiver | Correct a low-confidence match | Correction is audited; only a manager can approve a reusable alias |
| UAT-05 | Receiver | Submit duplicate, numeric, formula-like, or missing-price input | Confirmation is blocked with an actionable row or candidate error |
| UAT-06 | Receiver | Confirm equal product/price candidates | They appear as one priced group while preserving individual serialized units |
| UAT-07 | Receiver | Retry the same confirmation command | The original result returns without duplicate stock or movements |
| UAT-08 | Sales manager | Search paged available stock and issue a handover | Only selected available serials move to the selected agent |
| UAT-09 | Field agent | Review and acknowledge custody on mobile | The agent sees only their serials and no internal unit cost or gross profit |
| UAT-10 | Field agent | Sell inside the approved range | The exact unit is sold once and the actual selling price is retained |
| UAT-11 | Field agent | Sell outside the approved range | Sale is rejected until the manager approves that unit and exact price |
| UAT-12 | Sales manager | Return an unsold unit | The same serial and cost return to the selected warehouse |
| UAT-13 | Sales manager | Void a sale as sellable/damaged | Sellable restores stock; damaged remains unavailable; reversal is linked |
| UAT-14 | Sales manager | Record a collection | The collection reduces the exact agent outstanding balance |
| UAT-15 | Finance | Open Inventory Accounting | Exact uncapped units, valuation, revenue, margin, VAT, collection, commission, and posting totals appear |
| UAT-16 | Finance | Drill from an exception to source evidence | Receipt, sale, unit, journal, request, and failure context remain linked |
| UAT-17 | Finance worker | Retry a failed posting | One balanced journal is produced and the same source is not posted twice |
| UAT-18 | Arabic user | Repeat receiving and agent flows in RTL at mobile width | Labels, forms, tables, dialogs, focus, and actions remain readable and usable |
| UAT-19 | Unauthorized/suspended user | Open or mutate another role/tenant's data | The request is denied without revealing the target record |
| UAT-20 | Support | Inspect a deliberately delayed/failed event | Monitoring reports a degraded component and a traceable source/request ID |

Attach screenshots or exported evidence to each executed row in
`docs/UAT_CHECKLIST.md`. Record defects, owner, fix commit, and retest outcome.

## Failure drills

Use an isolated staging database. Never install the injection triggers from the
automated test suite in production.

1. Stop the outbox worker, create a receipt/sale, and confirm that pending age
   crosses the alert threshold.
2. Restore the worker and confirm the same source is processed once.
3. Use an invalid accounting mapping in staging, confirm that the posting
   becomes failed with a useful error, correct the mapping, and retry.
4. Run the database integration suite to prove transaction rollback for
   injected receipt, sale, and accounting-event failures.
5. Confirm dead-letter alerts reach the named support owner with organization,
   source type, source ID, retry count, and request ID.

## Production monitoring

The authenticated health endpoint is:

```text
GET /api/internal/product-inventory
Authorization: Bearer <OUTBOX_WORKER_SECRET>
```

It returns `200` when healthy and `503` when it detects overdue/failed product
outbox events, failed or pending accounting postings, or stale receipt/import/
photo commands. The endpoint contains counts, oldest exception timestamps, the
configured age threshold, and a request ID. It contains no product costs,
serials, customer details, or OCR evidence.

Recommended alerts:

- page immediately for dead letters or failed accounting postings;
- page when a processing command or outbox event is older than 15 minutes;
- warn on sustained pending growth even before the oldest item reaches the
  threshold;
- monitor API error rate, database latency, outbox throughput, posting latency,
  private-storage failures, and reconciliation differences.

## Support triage

1. Capture organization, source type/ID, command ID, request ID, actor, time,
   status, and displayed error. Do not copy customer details or raw OCR text
   into an unrestricted ticket.
2. Check the monitoring endpoint, outbox event, accounting posting, source
   record, movements, and journal link in that order.
3. Classify the issue as validation, authorization, upload/scan, concurrency,
   outbox, accounting mapping, or provider outage.
4. Retry only through the supported idempotent command/worker action. Do not
   directly edit stock status, agent custody, accounting status, or journals.
5. Escalate any tenant leak, duplicate serial, unbalanced journal, lost private
   evidence, or unexplained reconciliation difference immediately.

## Rollback and forward-fix

Database migrations are forward-only. Do not delete a migration or issue a
destructive schema rollback after it has been applied.

- Application rollback is allowed only to a build compatible with migration
  v128 and its API response contracts.
- Prefer a corrective forward migration for schema or data defects.
- Pause receiver confirmation, handovers, sales, and the accounting worker if
  continued writes could increase inconsistency.
- Preserve outbox, command, posting, journal, movement, and evidence records.
- Reverse business events through the supported sale-void, return, loss, and
  accounting reversal flows; never delete them.
- Before resuming, rerun stock-to-movement, agent-custody, posting-to-journal,
  inventory-GL, and agent-receivable reconciliations.
- Document the incident timeline, affected source IDs, corrective migration or
  commit, reconciliation result, and release decision.

## Controlled pilot

Run the pilot with one trained receiver, one warehouse, one sales manager, one
finance approver, and a small agent group:

1. Import a small real Virgin delivery through each agreed input channel.
2. Compare expected and extracted product/serial accuracy before confirmation.
3. Confirm stock, issue a small handover, acknowledge it, sell and return
   selected units, record a collection, and verify automatic accounting.
4. Reconcile every pilot unit, movement, balance, posting, and journal daily.
5. Observe monitoring and support response for at least one complete business
   cycle.
6. Stop the pilot on any tenant leak, duplicate/lost serial, unexplained
   balance, unbalanced/duplicate journal, or inaccessible evidence.

Expand only after all critical/high defects are closed and the receiver, sales,
finance, support, and product owners sign off.

## UAT sign-off

| Area | Named approver | Evidence | Decision/date |
|---|---|---|---|
| Virgin receiving and extraction accuracy |  |  |  |
| Warehouse stock and serialized movements |  |  |  |
| Field-agent custody, sales, returns, and collections |  |  |  |
| Finance valuation, postings, and reconciliation |  |  |  |
| Arabic/RTL, mobile, accessibility, and permissions |  |  |  |
| Support, monitoring, rollback, and incident readiness |  |  |  |

Final decision: `[ ] GO` `[ ] CONDITIONAL GO` `[ ] NO-GO`

Open conditions, owners, and dates: ________________________________________
