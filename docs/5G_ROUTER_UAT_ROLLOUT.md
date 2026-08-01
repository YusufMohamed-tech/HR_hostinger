# 5G Router Finance Custody — UAT and Rollout Runbook

## Release scope

This runbook covers the Finance-owned 5G router lifecycle implemented through
`schema_v147_product_inventory_return_hardening`:

- Finance receipt, import, commercial price, and commission control;
- OGPM/OGSV1 project-and-city assignments;
- serialized employee handover and recipient signature;
- private photo-backed return requests;
- OGPM and Finance approval;
- Finance physical receipt by serial scan;
- sellable, quarantine, and damaged dispositions;
- custody, notification, reporting, monitoring, and damage-accounting links.

Repository tests prove the code and fresh migration chain. They do not replace
staging UAT, production backup/restore evidence, named business approval, or a
controlled pilot.

## Automated release gate

Run from the repository root against the release commit:

```bash
npm run db:verify-migrations
npm run verify:outbox
npm run verify:product-inventory
npm run typecheck
npm run lint:strict
npm run test:unit
npm run test:db
npm run verify:accounting
npm run build
```

Do not proceed if any command fails. Record the commit, migration-head ID,
checksum, Node version, PostgreSQL version, test timestamp, and CI link.

## Staging prerequisites

- Restore a recent sanitized backup into an isolated staging environment.
- Apply migrations through `schema_v147_product_inventory_return_hardening`.
- Configure `OUTBOX_WORKER_SECRET`, the outbox scheduler, private storage, and
  the malware-scanning policy.
- Confirm `product-return-evidence` is private and cannot be listed directly by
  authenticated browser clients.
- Create separate Finance Manager, OGPM, OGSV1, employee, accounting, support,
  and unauthorized test accounts.
- Link OGPM/OGSV1 accounts to active employee records and exact project/city
  assignments.
- Configure the return warehouse, approval mode, photo limits, accounting
  mappings, and `employee_custody_returns_enabled` rollout switch.
- Prepare ten non-production serials and expected cost, price, commission,
  project, city, and recipient values.
- Name the Finance, project, operations, accounting, support, security, and
  product approvers before execution.

## Required UAT matrix

| ID | Actor | Action | Required result |
|---|---|---|---|
| R-01 | Finance | Create/import a router receipt | Every valid unique serial is staged once; legacy Inventory Receiver cannot write |
| R-02 | Finance | Set sale price and commission | Approved terms are versioned and copied to confirmed units |
| R-03 | Finance | Confirm receipt | Units become available in the selected warehouse with retained cost and terms |
| R-04 | Finance | Assign six units to OGSV1/City A and four to OGPM/City B | Each handover contains only selected serials and correct project/city snapshots |
| R-05 | Recipient | Open custody on mobile and sign | Only the intended account can accept; signature and exact serial count persist |
| R-06 | Unauthorized user | Open another recipient's custody | Access is denied without leaking names, serials, or photos |
| R-07 | OGSV1 | Request two returns with separate notes/photos | Files pass MIME/size/scan gates; units become `return_pending` and cannot be sold |
| R-08 | Finance and OGPM | Observe notifications | Each required approver receives one durable notification linking to the request |
| R-09 | OGPM | Approve one request | Request remains pending when Finance approval is also required; custody remains |
| R-10 | Finance | Approve the same request | Request becomes awaiting delivery; unit remains in the recipient's physical custody |
| R-11 | Finance | Reject a separate request | Unit returns to `with_custodian`; requester receives the decision |
| R-12 | Requester | Cancel a pending request | Cancellation is allowed only before approval; unit returns to normal custody |
| R-13 | Finance | Scan the wrong serial at receipt | Entire command fails; no custody, stock, movement, receipt, or accounting partial write occurs |
| R-14 | Finance | Receive one approved serial as sellable | Exact serial becomes `in_stock`, warehouse is set, and custody is cleared |
| R-15 | Finance | Receive one approved serial as damaged | Exact serial becomes `damaged`, custody clears, and linked damage accounting is queued once |
| R-16 | Finance | Receive part of a multi-line request | Only received serials leave custody; request becomes partially received |
| R-17 | Finance | Retry the same receipt command | Original result returns; no duplicate receipt, movement, event, loss, or journal appears |
| R-18 | Finance | Open return report | Request/unit/disposition totals reconcile by project and city |
| R-19 | Support | Query authenticated inventory monitoring | Overdue approvals/deliveries, stale commands, event failures, and damage-posting failures are reported |
| R-20 | Arabic/mobile user | Repeat request, approval, and receipt at 360px width | RTL labels, actions, images, tables, focus, validation, and status text remain usable |

For every row attach a screenshot, request ID, command ID, serial set, expected
result, actual result, tester, timestamp, defect link, and retest evidence. Do
not copy production personal or financial data into unrestricted tickets.

## Reconciliation gate

Run the service-only database function for every pilot organization:

```sql
select public.get_product_inventory_return_reconciliation('<organization-id>');
```

The release gate requires:

- `balanced = true`;
- zero open-line/unit mismatches;
- zero closed-line/unit mismatches;
- zero orphan active-return links;
- zero damaged returns without a loss record;
- zero loss-to-return link mismatches;
- zero difference between custody report units and physical custody units.

Separately reconcile:

1. receipt serials to confirmed serialized units;
2. handover lines to project/city recipient custody;
3. open returns to `return_pending` or `return_approved` units;
4. sellable receipts to warehouse stock;
5. quarantine/damaged receipts to unavailable stock;
6. damaged return lines to one loss record and one accounting source;
7. accounting sources to balanced journals or documented pending exceptions;
8. business events to outbox delivery and user notifications.

Any unexplained difference is a stop-the-line condition.

## Failure and concurrency drills

Use staging only.

1. Submit two approvals concurrently with the same request version. Exactly one
   succeeds; the loser receives a conflict and can safely reload.
2. Submit two physical receipt commands for the same return line. Exactly one
   receipt line and one custody release may exist.
3. Stop the outbox worker, perform a return action, and confirm monitoring
   degrades after the threshold. Restart it and confirm exactly-once delivery.
4. Remove a required accounting mapping, receive a damaged unit, confirm the
   posting failure is visible, restore the mapping, and retry the supported
   accounting action.
5. Upload wrong MIME, active content, an oversized image, and a missing photo.
   Every request must fail without registered evidence or an orphan business
   record.
6. Attempt a cross-tenant request, approval, attachment download, and receipt.
   Every operation must fail closed.

## Monitoring and support

Monitor:

```text
GET /api/internal/product-inventory
Authorization: Bearer <OUTBOX_WORKER_SECRET>
```

Alert immediately on dead letters, failed damage accounting, reconciliation
differences, cross-tenant access, duplicate/missing serials, or receipt without
matching approval. Alert on commands/events older than 15 minutes, approvals
older than 24 hours, and approved deliveries older than 48 hours.

Support triage order:

1. request/command ID and actor;
2. return request, lines, approvals, and attachment metadata;
3. serialized unit and custody snapshots;
4. receipt and movement timeline;
5. business event and outbox state;
6. loss record, posting, and journal link;
7. reconciliation output.

Never repair incidents with direct status updates or deletes. Use supported
commands, worker retries, accounting reversals, or a reviewed forward migration.

## Controlled rollout

1. Deploy additive migrations and the compatible application build.
2. Keep `employee_custody_returns_enabled = false` while validating read paths,
   assignments, warehouse configuration, storage, worker, and monitoring.
3. Freeze legacy Inventory Receiver writes and communicate Finance ownership.
4. Enable the switch for one organization, one warehouse, one OGPM, one OGSV1,
   and ten serials.
5. Execute the complete receive → price → handover → accept → return → approve
   → physical receipt → accounting journey.
6. Reconcile every serial daily for at least one complete business cycle.
7. Observe notifications, queue age, upload failures, API errors, posting
   latency, and support response.
8. Expand project/city volume only after all critical/high defects are closed
   and every named approver signs.

Turning the switch off blocks new return submissions but intentionally permits
in-flight approvals and physical receipts to complete.

## Rollback and forward-fix

- Database migrations are forward-only; never delete or edit an applied file.
- Disable new submissions with `employee_custody_returns_enabled = false`.
- Pause Finance handovers/receipts and the accounting worker if continued writes
  can increase inconsistency.
- Preserve requests, approvals, photos, movements, events, receipts, losses,
  postings, and journals.
- Roll the application back only to a build compatible with the applied schema.
- Correct data/schema defects with a reviewed forward migration or supported
  reversal command.
- Resume only after migration status, monitoring, private-file access, worker
  backlog, accounting balance, and return reconciliation all pass.

## Sign-off

| Area | Named approver | Evidence link | Decision/date |
|---|---|---|---|
| Finance receiving, price, and commission |  |  |  |
| OGPM/OGSV1 assignment and custody |  |  |  |
| Return evidence and approvals |  |  |  |
| Physical receipt and serial reconciliation |  |  |  |
| Damage accounting and Finance reports |  |  |  |
| Permissions, tenant isolation, and private files |  |  |  |
| Arabic RTL, mobile, and accessibility |  |  |  |
| Monitoring, support, backup/restore, and rollback |  |  |  |

Final decision: `[ ] GO` `[ ] CONDITIONAL GO` `[ ] NO-GO`

Open conditions, owners, and due dates: ____________________________________
