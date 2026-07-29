# Product Inventory Production Manual Testing Guide

## Purpose

Use this guide to validate the complete Virgin product flow in the real
production environment after migrations and application deployment:

1. receiver setup and permissions;
2. manual, Excel/CSV, and photo-based receiving;
3. product matching, grouping, costs, and planned selling prices;
4. serialized stock confirmation;
5. manager-to-agent handover;
6. agent acceptance, sale, price exception, return, and collection;
7. automatic Finance visibility, posting, and reconciliation;
8. monitoring, evidence, cleanup, and business sign-off.

This is a controlled production smoke test. Use a small real Virgin delivery,
named test actors, and reversible business actions. Do not install failure-
injection triggers or run destructive database tests in production.

## 1. Release prerequisites

Record the following before testing:

| Item | Value/evidence |
|---|---|
| Application commit |  |
| Deployment URL |  |
| Supabase project |  |
| Migration head | `schema_v128_product_inventory_hardening` |
| Receiver | `receiver@tatwir.sa` |
| Sales manager |  |
| Field agent |  |
| Finance approver |  |
| Warehouse |  |
| Virgin supplier |  |
| Test delivery/reference |  |
| Test date/time |  |

Required conditions:

- The release build is deployed and `/api/ready` reports ready.
- The migration ledger contains 130 rows and its head is v128.
- Sales and Accounting modules are enabled for the Tatwir organization.
- The organization subscription is active.
- The receiver is an active employee with the `inventory_receiver` role.
- A Sales Manager or On-ground Agent Manager and an active field agent exist.
- Finance has an active Finance Manager plus an Accountant or Finance Viewer.
- A private evidence-storage policy is active.
- The outbox/accounting workers and monitoring secret are configured.

Never put passwords, service-role keys, access tokens, database URLs, customer
phone numbers, or raw OCR evidence into screenshots or this document.

## 2. Prepare a controlled Virgin sample

Use 6–12 real, unsold products that may be safely handled in production.
Prepare three non-overlapping subsets:

- manual subset: at least two units of the same product;
- workbook subset: at least two products and one leading-zero serial;
- photo subset: at least two readable labels, including one Arabic or
  mixed-language label if available.

Create a private expected-results sheet containing:

- supplier delivery reference;
- canonical product and SKU;
- exact serial/IMEI;
- acquisition unit cost;
- planned selling price;
- currency and VAT treatment;
- ownership type (`purchased` or `consignment`);
- condition;
- expected group count.

Photograph or scan the source delivery document and labels. Redact unrelated
customer or personal information.

## 3. Verify receiver access

1. Open the production login page in a private browser window.
2. Sign in as `receiver@tatwir.sa` using the separately delivered initial
   password.
3. Confirm the user is routed to Product Inventory.
4. Confirm the receiver can open:
   - product inventory;
   - receipt creation;
   - receipt import/photo capture;
   - notifications and permitted settings.
5. Attempt to open employee management, payroll, accounting posting, product
   assignment, sale, collection, and price-approval pages.
6. Expected: every out-of-role page is hidden or returns `403`, with no data
   from another module.
7. Change the initial password immediately after first access.

Evidence: landing page, visible navigation, and one permission-denied result.

## 4. Confirm setup data

As an Admin or Sales Manager:

1. Open Product Inventory setup.
2. Confirm the Virgin supplier exists and is active.
3. Confirm each sample product exists with the correct name, SKU/model,
   currency, VAT behavior, ownership default, and accounting mappings.
4. Add approved Arabic/English aliases only when they are genuine label names.
5. Confirm the target warehouse is active and marked as the default where
   appropriate.
6. Confirm default Inventory, GRNI/AP, COGS, Sales Revenue, VAT Payable, Agent
   Receivable, Cash/Bank, Shrinkage, and optional Commission accounts exist.
7. Record setup screenshots without exposing secrets.

## 5. Manual receiving test

As the receiver:

1. Select **New Receipt** and choose manual entry.
2. Select Virgin, the warehouse, receipt date, currency, and ownership type.
3. Add the manual subset.
4. Enter canonical product, acquisition unit cost, planned selling price,
   condition, and each exact serial.
5. Add two units with the same product/cost/selling price.
6. Expected: the UI groups them together and shows a count of two while
   preserving two serialized candidates.
7. Change one planned price temporarily.
8. Expected: the different price creates a separate group.
9. Restore the expected price and save the draft.
10. Reload the draft and compare every field with the expected-results sheet.

Do not confirm yet.

## 6. Excel/CSV receiving test

1. Download a fresh template from production.
2. Enter the workbook subset using both supported English/Arabic headers where
   practical.
3. Keep serial cells formatted as text and include one leading-zero serial.
4. Upload the workbook.
5. Expected:
   - preview row count equals the source row count;
   - leading zeros remain unchanged;
   - products match the catalog;
   - equal commercial rows group together;
   - every source row remains linked to a preview candidate;
   - no stock is created during preview.
6. Correct any intentionally unresolved row in review.
7. Commit the workbook candidates to the receipt.
8. Download the error export if errors exist and confirm formula-like values
   are neutralized.

Negative check:

1. Use a copy containing one duplicate serial, one numeric serial cell, one
   formula-like cell, and one missing price.
2. Expected: commit is blocked with specific row errors and no partial stock.
3. Discard the invalid copy; do not confirm it.

## 7. Photo extraction test

Use a supported mobile browser:

1. Select **Photo Extraction**.
2. Capture or select the prepared Virgin label photos.
3. Verify each preview shows upload/OCR progress.
4. Compare suggested product and serial/IMEI with the physical label.
5. Review confidence, OCR evidence, and barcode evidence.
6. Correct low-confidence or wrong values manually.
7. Confirm duplicate or unresolved candidates remain blocked.
8. Confirm an alias is not approved automatically; a manager must explicitly
   approve a genuine corrected label alias.
9. Commit the reviewed photo candidates.
10. Expected: original images remain private and linked to extraction metadata
    and the final candidate values.

Record exact product-match and serial-match accuracy for the sample.

## 8. Receipt grouping, pricing, and confirmation

1. Open the combined receipt review.
2. Reconcile manual, workbook, and photo candidate counts.
3. Confirm every valid unique serial appears exactly once.
4. Confirm group boundaries change when product, unit cost, planned price,
   currency, VAT, ownership, or condition changes.
5. Verify total cost, expected sales, and expected margin against an independent
   calculator.
6. Remove any deliberately invalid candidate and confirm group count/totals
   update.
7. Attempt confirmation with a missing cost or planned price.
8. Expected: confirmation is blocked.
9. Restore the required value and confirm using the final receipt command.
10. Reload and verify:
    - receipt status is confirmed;
    - one stock unit exists per valid serial;
    - one receipt movement exists per unit;
    - cost and planned-price snapshots match the confirmed group;
    - the receipt can no longer be edited.
11. Retry/reload the confirmation result.
12. Expected: no duplicate units, movements, or events are created.

## 9. Duplicate-serial production-safe check

1. Start a separate draft using one serial that was just confirmed.
2. Attempt preview/save/confirmation without changing the original receipt.
3. Expected: the duplicate is identified and confirmation is blocked.
4. Cancel the duplicate draft.
5. Do not run concurrent SQL or failure-injection scripts in production.

## 10. Stock and pagination check

1. Open Product Inventory stock.
2. Search each test serial and verify product, warehouse, status, condition,
   ownership, cost, planned price, and currency.
3. Compare header totals to Finance:
   - unit count;
   - owned inventory cost;
   - expected sales;
   - expected margin;
   - consignment memo count/value.
4. Navigate receipt, stock, and movement pages.
5. Expected: page changes do not change the exact overall totals.
6. Search an assignment serial from the manager page.
7. Expected: the serial is found without loading the complete stock register.

## 11. Manager handover

As Sales Manager or On-ground Agent Manager:

1. Open Product Assignments.
2. Search and select exact test serials.
3. Choose the active field agent and warehouse.
4. Review planned, minimum, and maximum selling prices.
5. Keep acknowledgment required.
6. Issue the handover.
7. Expected:
   - handover number is created;
   - selected units move to `in_transit`;
   - current agent/handover are linked;
   - movement history shows warehouse-to-agent custody;
   - no revenue, COGS, receivable, or sale journal is created.
8. Confirm an inventory receiver cannot perform the same handover.

Keep each handover at or below the configured 200-unit maximum.

## 12. Agent acceptance and private-data check

As the assigned field agent:

1. Open **Products > Receive** on mobile.
2. Confirm only the agent's pending handover and exact serials appear.
3. Confirm internal acquisition cost and gross profit are not displayed or
   returned to the agent.
4. Physically compare every serial and acknowledge the handover.
5. Expected:
   - handover becomes accepted;
   - units become `with_agent`;
   - agent custody count/planned retail update;
   - another agent cannot see or accept it.

## 13. Sale and price-exception test

1. Select one accepted unit.
2. Record an in-range sale with test customer/reference data and the actual
   payment method.
3. Expected:
   - exact serial becomes sold once;
   - sale snapshots product, serial, cost, planned price, actual price, VAT,
     commission rules, and agent;
   - agent balance increases;
   - sale/accounting event is queued.
4. Select another unit and enter a price outside the permitted range.
5. Expected: sale is blocked and a price-exception request is offered.
6. Submit a reason of at least five characters.
7. As manager, approve that unit and exact requested price.
8. Retry at a different price.
9. Expected: still blocked.
10. Retry at the approved price.
11. Expected: sale succeeds and the approval becomes used.
12. Attempt to sell the already sold unit again.
13. Expected: blocked with no duplicate sale.

## 14. Return, collection, void, and loss checks

Use separate sample units:

1. Return one unsold agent unit to the warehouse.
2. Expected: the same serial and original cost return to stock with a linked
   movement.
3. Record a collection against the selling agent.
4. Expected: collected value increases and outstanding agent receivable
   decreases exactly once.
5. As manager, void one sale using a sellable disposition.
6. Expected: reversal is linked and the unit returns to stock.
7. If an actually damaged test unit exists and business approval is recorded,
   use the damaged/loss flow.
8. Expected: the unit remains unavailable and the shrinkage/accounting
   treatment is linked.

Never manufacture a loss against good stock solely for testing.

## 15. Finance and automatic-accounting validation

As Accountant/Finance Viewer:

1. Open **Accounting > Inventory**.
2. Confirm the operational receipt, inventory, handover/sale, collection,
   return/void, and any approved loss appear automatically.
3. Compare:
   - stock units and owned cost;
   - expected sales and margin;
   - actual revenue, VAT, COGS, and gross profit;
   - collections and agent outstanding;
   - consignment memo values;
   - commissions;
   - pending/failed postings.
4. Drill from each posting to its source receipt/sale/collection/loss and
   journal.
5. Confirm every posted journal balances debit and credit.

Expected mappings:

| Event | Expected posting |
|---|---|
| Purchased receipt with invoice | Dr Inventory / Cr Accounts Payable |
| Purchased receipt without invoice | Dr Inventory / Cr GRNI |
| Assignment/acceptance | No journal |
| Purchased product sale | Dr Agent Receivable; Cr Revenue/VAT; Dr COGS; Cr Inventory |
| Collection | Dr Cash/Bank / Cr Agent Receivable |
| Sellable void | Linked reversal of sale/COGS |
| Recorded loss | Dr Shrinkage / Cr Inventory |
| Consignment receipt | Memo inventory only, not owned asset |

Confirm Inventory GL minus owned stock cost and Agent Receivable GL minus the
operational outstanding balance are both within the approved tolerance.

## 16. Worker and monitoring check

From an authorized operations terminal:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${OUTBOX_WORKER_SECRET}" \
  "https://YOUR_PRODUCTION_DOMAIN/api/internal/product-inventory"
```

Expected:

- HTTP `200`;
- `status: "ok"`;
- zero dead letters, overdue events, failed accounting postings, overdue
  accounting postings, and stale commands;
- queue/pending counts may be temporarily nonzero while fresh work processes;
- response includes `checked_at`, thresholds, and `requestId`;
- response contains no serial, cost, customer, password, or OCR evidence.

If the endpoint returns `503`, stop the pilot and follow
`PRODUCT_INVENTORY_PHASE_6_UAT_RUNBOOK.md`.

## 17. Permission and tenant-isolation check

Using normal UI/API navigation only:

| Actor | Allowed | Must be denied |
|---|---|---|
| Receiver | Own receipts, photo/workbook/manual receiving, stock view | Handover, sale, collection, posting, Finance settings |
| Manager | Setup, stock, handover, override, return/void/loss | Finance posting/settings without Finance role |
| Field agent | Own handovers, custody, sales, returns, balance | Other agents, internal cost/profit, warehouse receiving |
| Accountant/viewer | Inventory Finance and reconciliation | Operational stock mutation |
| Finance manager | Finance settings/posting/retry/settlement | Cross-tenant data |

Expected: hidden navigation plus server-side `403`/not-found behavior. A copied
ID from another actor or tenant must not reveal a record.

## 18. Production cleanup and reversal

1. Do not delete confirmed receipts, units, movements, sales, journals, or
   evidence.
2. Cancel only unconfirmed invalid drafts.
3. Return unsold pilot stock using the normal return flow.
4. Void/reverse pilot sales using the supported disposition and Finance
   reversal flow.
5. Mark the production test reference consistently so Finance can identify it.
6. Reconcile all sample serials to exactly one final state.
7. Confirm outbox/posting queues are clear and monitoring is healthy.
8. Store screenshots and calculations in the approved restricted evidence
   location.

## 19. Defect stop conditions

Stop production testing immediately for:

- cross-tenant or unauthorized data exposure;
- a duplicate or missing serialized unit;
- partial stock after a failed confirmation;
- an agent selling an unassigned/already sold unit;
- cost or gross-profit exposure to an agent;
- an unbalanced or duplicate journal;
- an unexplained stock/GL or receivable/GL difference;
- missing private source evidence;
- dead-letter or stale-command growth.

Record organization, source type/ID, command ID, request ID, actor, timestamp,
expected/actual result, screenshot, and owner. Do not paste secrets or personal
data into the defect.

## 20. Sign-off

| Area | Evidence | Result | Approver/date |
|---|---|---|---|
| Receiver permissions |  |  |  |
| Manual receiving |  |  |  |
| Excel/CSV receiving |  |  |  |
| Photo extraction accuracy |  |  |  |
| Grouping/pricing/confirmation |  |  |  |
| Stock and movements |  |  |  |
| Handover and agent custody |  |  |  |
| Sale/override/return/collection |  |  |  |
| Finance posting/reconciliation |  |  |  |
| Mobile/RTL/accessibility |  |  |  |
| Permissions/privacy |  |  |  |
| Monitoring/support readiness |  |  |  |

Final decision: `[ ] GO` `[ ] CONDITIONAL GO` `[ ] NO-GO`

Open conditions, owners, and dates: ________________________________________
