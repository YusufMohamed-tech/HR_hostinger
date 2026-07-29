# HRMS Launch UAT Checklist

Release commit: __________
Staging URL/environment: __________
Test window: __________
UAT lead: __________

Attach screenshots, request IDs, test-data references, reconciliation outputs, defects, and retest evidence. Never attach real identity documents, bank data, secrets, or production personal data.

## 1. Environment and security

- [ ] Health and readiness return 200; required configuration, database, and migrations checks are `ok`, and `schemaHead` matches the release manifest.
- [ ] Tenant A users cannot read/write Tenant B records through UI or direct API attempts.
- [ ] Suspended organization/user and disabled feature/module fail closed.
- [ ] Privileged roles enroll MFA and privileged actions require the expected authentication assurance.
- [ ] Invitation, recovery email, reset policy, logout/revocation, and rate limiting work.
- [ ] CSP nonce, HSTS, frame, content-type, referrer, and permissions headers are present on deployed HTTPS responses.
- [ ] Clean upload succeeds; disallowed signature/MIME, oversized upload, infected result, scanner timeout, and scanner outage fail safely.
- [ ] Private file URLs expire and cannot be reused by another tenant/role.

## 2. Role journeys

- [ ] Platform superadmin provisions an organization admin, changes role atomically, suspends/activates access, and sends recovery email; platform audit is visible.
- [ ] Organization admin manages settings/features/users only within the organization.
- [ ] HR admin completes onboarding, identity link, employee update, promotion, location/department assignment, leave, personnel, asset, and offboarding journeys.
- [ ] HR recruiter manages only authorized postings/applications/interviews/offers and cannot hire without accepted offer/onboarding command.
- [ ] Manager sees only reporting scope and completes permitted leave/task actions.
- [ ] Employee sees only self-service data, records attendance, requests/cancels leave, acknowledges balances/assets, completes tasks/LMS, and accesses own files.
- [ ] Finance manager/accountant/viewer permissions match `ROLE_CAPABILITY_MATRIX.md`; prohibited posting/settings actions fail.
- [ ] Training manager/instructor/learner course, review, community, and assignment scopes are enforced.
- [ ] Sales manager/sales/promoter/field-agent/merchant scopes and company/location assignments are enforced.
- [ ] Inventory receiver can open only product inventory, notifications, and settings; another receiver's draft and non-inventory modules are denied.
- [ ] Inventory receiver cannot open product assignments or invoke handover, sale, void, price-approval, collection, or movement APIs.
- [ ] Manager can select a grouped product count, set minimum/maximum sale prices, issue a handover, and see each serialized unit become in transit or immediately accepted.
- [ ] Assigned field agent sees only their product custody, verifies all serials, and acknowledges a pending handover before selling.
- [ ] Sale outside the approved range is denied until the manager approves the same unit and exact price; another price still fails.
- [ ] Unsold agent return restores the same serial and original cost to the selected warehouse.
- [ ] Manager void with sellable disposition restores the sold serial to stock; damaged disposition keeps it unavailable.
- [ ] Product sale and collection appear automatically in Finance with cost, actual selling price, gross profit, VAT, and outstanding agent balance.

## 3. Cross-module integrity

- [ ] Employee onboarding creates one employee, balance seed, identity/membership, locations, and history; retry does not duplicate.
- [ ] Employee offboarding revokes organization access and closes active locations, shifts, sales assignments, and other lifecycle-linked access while preserving history.
- [ ] Attendance uses organization timezone/business date, assigned shift/location, geofence/evidence, and prevents invalid overlap/multiple open sessions.
- [ ] Approved/cancelled leave changes the leave ledger exactly once and notifies the correct review tier.
- [ ] Schedule create/update/delete rejects stale versions and overlapping assignments.
- [ ] Payroll calculation matches the signed formula specification; run/approve/pay/recalculate/adjust retry safely and reconcile to payslips/GOSI/accounting.
- [ ] Journal, invoice, expense, payment, budget, period close/reopen, asset capitalization/depreciation, advance disbursement, sales cash, commissions, and reversals remain balanced and linked.
- [ ] Sales log correction/void preserves revisions and produces correct accounting reversal/repost behavior.
- [ ] Manual product receipt groups require product, unit cost, planned sale price, and unique serials; retry is idempotent and confirmation creates exactly one stock unit and receipt movement per serial.
- [ ] Product inventory template downloads; valid XLSX and CSV files accept Arabic/English headers, preserve text serial leading zeros, preview all source rows, and group equal product/cost/sale-price/currency/condition rows.
- [ ] Macro-enabled, legacy, oversized, over-row-limit, wrong-signature, infected, formula-like, numeric-serial, duplicate, confirmed-serial, and unmatched-product imports fail with actionable row/file errors.
- [ ] Workbook commit cannot omit an original row; corrected rows, the clean private original, SHA-256/scan metadata, source row number, and signed evidence access remain linked to the receipt.
- [ ] Equivalent manual and workbook inputs create the same priced receipt groups, stock units, receipt movements, valuation totals, and finance visibility after confirmation.
- [ ] Receiver captures/selects multiple product-label photos on mobile; local OCR/barcode extraction finds English/Arabic product labels and serial/IMEI values without sending images to an external AI provider.
- [ ] Photo review shows confidence, raw evidence, unmatched/duplicate errors, prices, conditions, and a grouping summary; warnings require explicit acceptance and no original candidate can be omitted at commit.
- [ ] Photo originals remain private and signed; OCR engine/version/text/barcodes/bounding boxes, suggested/final values, corrections, actor, timestamps, and receipt candidates remain linked after confirmation.
- [ ] Only managers can explicitly approve a corrected raw label as an alias; an approved alias improves a later matching attempt without replacing existing catalog aliases.
- [ ] Representative Virgin sample photos are scored for exact product and serial accuracy, low-confidence review, glare/rotation/blur, multiple serials, barcode-only labels, and false-positive behavior; expected-versus-actual evidence is attached.
- [ ] Equivalent manual, workbook, and photo inputs create the same priced groups, stock units, movements, valuations, and Finance visibility after confirmation.
- [ ] A confirmed serial cannot be received again; cancelled/confirmed receipts cannot be edited; stale receipt versions are rejected.
- [ ] Finance roles automatically see confirmed unit count, cost, expected sale value, margin, ownership type, and accounting status without inventory mutation access.
- [ ] Recruitment transition/offer/interview/hire and public application submission are tenant-safe, state-safe, and replay-safe.
- [ ] LMS assignment creates all intended enrollments or none; rubric saves atomically; review/rubric/completion/certificate/outbox remain consistent.
- [ ] Chat pagination is bounded; unread/read state, recipients, realtime update, moderation, attachment cleanup, and retention behavior are correct.
- [ ] Task creation/update/transition/message/attachment actions are scoped, versioned, and retry-safe.
- [ ] Personnel/asset/task/chat/LMS/candidate files remain private and managed-file metadata matches storage.

## 4. Operations and failure recovery

- [ ] Outbox processing delivers once per source event/user; retry and dead-letter alerts are demonstrated.
- [ ] Compliance job creates expected deadline alerts without duplicates.
- [ ] File-retention job demonstrates success, retry, dead letter, and legal-hold exclusion.
- [ ] Malware scanner, email provider, database, and worker outage behavior is observed and documented.
- [ ] Backup restore succeeds in isolation and reconciliations pass.
- [ ] Application rollback compatibility or corrective forward migration is rehearsed.
- [ ] Monitoring alerts reach the on-call owner and include a usable request/event identifier.

## 5. Accessibility and usability

- [ ] Keyboard-only navigation reaches all launch-critical actions with visible focus.
- [ ] Dialogs trap/restore focus and have labels/descriptions; errors are announced and associated with fields.
- [ ] RTL Arabic and English layouts do not clip controls/data at supported viewport sizes.
- [ ] Color contrast, zoom to 200%, responsive tables/forms, and screen-reader names pass the agreed accessibility standard.
- [ ] Empty, loading, validation, conflict, expired-session, permission-denied, dependency-outage, and retry states are understandable.

## 6. Reconciliation and sign-off

| Area | Expected vs actual evidence | Defects/retest | Approver/date |
|---|---|---|---|
| HR / employee lifecycle |  |  |  |
| Attendance / scheduling |  |  |  |
| Leave |  |  |  |
| Payroll / social insurance |  |  |  |
| Accounting / assets / advances |  |  |  |
| Sales / cash / commissions |  |  |  |
| Recruitment |  |  |  |
| LMS |  |  |  |
| Chat / tasks / files |  |  |  |
| Security / privacy / accessibility |  |  |  |
| Operations / backup / incident |  |  |  |

Final decision: [ ] GO  [ ] CONDITIONAL GO  [ ] NO-GO
Open conditions and owners: ________________________________________________

## 7. Product inventory Phase 6 release evidence

- [ ] `npm run verify:product-inventory`, unit tests, database integration
  tests, strict lint, typecheck, and production build pass on the release
  commit.
- [ ] Concurrent receipt confirmation has exactly one winner and creates one
  stock unit for the duplicated serial.
- [ ] Injected receipt, sale, and accounting-event failures roll back all
  partial state.
- [ ] Large stock, receipt, movement, agent-balance, and Finance totals remain
  exact while detail feeds are paginated.
- [ ] The authenticated product inventory monitoring endpoint alerts on stale
  commands/outbox events and failed or delayed accounting postings.
- [ ] All scenarios and named approvals in
  `PRODUCT_INVENTORY_PHASE_6_UAT_RUNBOOK.md` are complete.
