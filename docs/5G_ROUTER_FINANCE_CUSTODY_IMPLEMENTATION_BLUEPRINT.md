# 5G Router Inventory: Finance-Led Receiving, Custody, and Returns Blueprint

Status: Implementation blueprint  
Target system: Tatwir HRMS product inventory  
Prepared from: Client requirements supplied on 1 August 2026 and the current repository through migration v140  
Primary product: Serialized 5G routers  

## 1. Executive decision

The requested workflow should extend the existing generic serialized product inventory. It should not create a second, router-only stock system.

The target operating model is:

1. A Finance Manager receives router deliveries and owns price and commission setup.
2. The supplied Excel/CSV form is uploaded, previewed, validated, and committed as a receipt.
3. Each confirmed serial becomes exactly one inventory unit.
4. Finance hands selected serials to eligible Project Managers and Supervisors in a specific project and city.
5. The recipient accepts the handover and the routers become part of that person's physical custody.
6. The system can answer: who holds how many routers, for which project, and in which city?
7. A custodian requests a return by serial and provides a note and at least one photo.
8. Finance and the responsible Project Manager receive actionable notifications.
9. Approval blocks the router from sale, but does not remove physical custody.
10. Finance scans and physically receives the router. Only then is it removed from the custodian's custody.
11. A sellable returned router goes back to warehouse stock; a questionable or damaged router goes to quarantine or damaged stock.

The existing Inventory Receiver role must be retired from this workflow. It should not be automatically converted to Finance Manager because Finance Manager has broad accounting posting authority. Named users must be reassigned deliberately.

## 2. Interpretation of the client message

| Client statement | Normalized system requirement |
|---|---|
| Finance will receive the devices | Finance Manager owns receipt creation, import, review, confirmation, pricing, and commission setup |
| Finance gives devices to Project Managers and Supervisors | Handover recipients must support employees/custodians, not only field agents |
| OGSV1 and OGPM | Treat these provisionally as operational position codes, not application authorization roles |
| They will send the sheet form | Support a versioned import profile; finalize its header mapping only after the real sample is received |
| A supervisor took X devices in any city | Every custody handover must snapshot recipient, position code, project, city, serials, and quantity |
| Returns by serial, note, and photo | Create an evidence-backed return request for one or more serialized units |
| Notify Finance and Project Manager | Publish durable events and exactly-once actionable notifications to scoped approvers |
| Confirmation from the notified person | Add explicit approval records; reading a notification is never an approval |
| After confirmation, reduce ready-for-sale devices | Reserve the serial from sale once the return reaches the approved state; recommended safety behavior reserves it as soon as the request is submitted |
| After physical delivery, remove it from custody | Clear the current custodian only in the Finance physical-receipt command |
| Finance sets sale price and commission while receiving | Store effective, auditable commercial terms per receipt group/unit and snapshot them into handover and sale records |

## 3. Important terminology

- Receipt: the inbound supplier delivery document.
- Unit: one physical router identified by one normalized serial number.
- Central ready stock: a sellable unit physically held in an active warehouse.
- Custodian: an eligible employee holding physical responsibility for routers.
- Custodian ready stock: a sellable unit accepted into a custodian's custody and not reserved for return.
- Handover: a transfer of serialized custody from Finance/warehouse to a custodian.
- Return request: a request to send an unsold custody unit back to Finance.
- Return approval: authorization to deliver the unit back. This changes sale availability, not physical ownership.
- Physical return receipt: Finance's serial scan and condition decision. This changes custody.
- Customer return or sale void: reversal of a completed sale. This is already a separate workflow and must remain separate from an unsold custody return.

## 4. Current repository assessment

The repository already contains a strong foundation:

- Generic serialized products, receipts, warehouses, units, and movement history.
- Manual, photo, XLSX, and CSV receiving.
- Duplicate-serial validation and normalized serial uniqueness.
- Idempotent database commands with row locking.
- Field-agent handovers, acknowledgment, controlled pricing, sales, and immediate returns.
- Product inventory accounting, commission accruals, durable events, notifications, and reconciliation.
- Private file storage and managed-file records.

The main reusable implementation is in:

- db/schema_v122_product_inventory_foundation.sql
- db/schema_v123_atomic_product_receiving.sql
- db/schema_v124_product_inventory_workbook_imports.sql
- db/schema_v125_product_inventory_photo_extraction.sql
- db/schema_v126_product_inventory_agent_commerce.sql
- db/schema_v127_product_inventory_accounting.sql
- db/schema_v128_product_inventory_hardening.sql
- src/lib/server/product-inventory-auth.ts
- src/lib/server/product-inventory-api.ts
- src/lib/server/product-inventory-commerce.ts
- src/lib/product-inventory/workbook.ts
- src/lib/product-inventory/schemas.ts
- src/lib/services/product-inventory.ts
- src/components/product-inventory/
- src/lib/server/outbox-worker.ts

### 4.1 Gap analysis

| Capability | Current behavior | Required change |
|---|---|---|
| Operational receiver | Inventory Receiver, Admin, Sales Manager, or Onground Agent Manager | Finance Manager becomes the only normal finance-led receiver; Admin remains break-glass/configuration authority |
| Finance inventory access | Finance sees valuation/accounting only | Finance Manager receives, prices, hands over, reviews, and physically receives returns |
| Handover recipient | Active field_agents row only | Eligible Project Manager or Supervisor employee, scoped to project and city |
| Recipient classification | Field-agent region only | Explicit operational assignment with position code, project, city, and capabilities |
| Handover reporting | Agent and warehouse | Recipient, OG code, project, city, accepted quantity, current quantity, sold, return pending, and returned |
| Return | Immediate agent-to-warehouse mutation | Request, evidence, scoped approvals, sale block, physical scan, disposition, and partial receipt |
| Return photo | Not supported | Private managed files linked to each return line |
| Notification | Informational only | Link to a source-of-truth approval/receipt action screen |
| Sale price | Receipt line and unit planned-price snapshot | Finance-controlled terms with history and versioning |
| Commission | Live default on sales_products; read again at sale time | Finance-set batch/unit term, snapshotted at handover and sale |
| City/project evidence | Not on handover snapshot | Immutable project/city/position snapshots |
| Inventory Receiver handover | Migration v134 tries to enable it | The database command's top actor allow-list still excludes inventory_receiver; replace this patching approach with a clean command |

### 4.2 Do not build these parts again

- Do not create router_serials, router_stock, or router_movements tables.
- Do not store a quantity as the source of truth. Quantity must always be derived from serialized units.
- Do not store return images as base64 in PostgreSQL.
- Do not approve a return by marking a notification as read.
- Do not clear custody at return approval time.
- Do not calculate a historical sale commission from the current product master.
- Do not identify OGPM or OGSV1 by fuzzy job-title text during a transaction.

## 5. Scope

### 5.1 Included

- Finance Manager replacement of the operational Inventory Receiver.
- Finance receiving by manual entry, photo, and client workbook.
- Versioned client workbook mapping.
- Finance-controlled sale price and commission.
- Handover to configured Project Managers and Supervisors.
- Project/city/position custody reporting.
- Recipient acknowledgment and retained signature/evidence.
- Serialized return request with note and photo.
- Finance and Project Manager approval policy.
- Physical Finance receipt and condition disposition.
- Notifications, audit, outbox, monitoring, permissions, tests, migration, and rollout.

### 5.2 Not automatically included

- Router procurement or supplier payment approval.
- Replacing the product catalog.
- Customer return/refund rules beyond the existing sale-void flow.
- Repair-center workflow after a unit enters quarantine.
- Commission payment settlement policy; the existing Finance settlement flow remains.
- Supervisor-to-subagent transfers unless the client confirms that Supervisors distribute further.
- External carrier API integration.

## 6. Actor and capability model

Application roles and operational position codes solve different problems.

- finance_manager is an authenticated workspace role.
- supervisor is an authenticated workspace role.
- OGPM and OGSV1 are provisionally operational position codes.
- Project Manager and Supervisor eligibility is an explicit inventory assignment, not a string comparison against employee.job_title.

Recommended operational mapping:

| Actor | Required authority |
|---|---|
| Finance Manager | Receive, import, set commercial terms, confirm receipt, issue custody, view all custody, approve/hold returns, physically receive returns, decide condition |
| Project Manager / OGPM | View only assigned project/city custody, approve or reject scoped return requests, receive own custody when eligible |
| Supervisor / OGSV1 | View and accept own custody, see own ready/return counts, request a return with evidence; sell only if a configured capability allows it |
| Accountant | Read financial inventory and postings; no physical stock mutation |
| Finance Viewer | Read-only finance view; no operational action |
| Admin | Configure assignments and use audited break-glass actions; not the normal operational receiver |
| Inventory Receiver | Retired; no new assignments and no operational writes after cutover |

### 6.1 Why the old receiver must not be auto-promoted

Finance Manager can approve or post accounting activity elsewhere in the system. Converting every inventory_receiver membership to finance_manager would silently grant much more authority than receiving devices. The migration must:

1. list current Inventory Receiver users;
2. require an administrator to select the real Finance Manager account;
3. move only explicitly approved users;
4. suspend or reassign remaining legacy accounts;
5. retain historical actor_role values in audit records.

The PostgreSQL enum value inventory_receiver can remain for historical compatibility. Removing an enum value is not required for the business cutover and would add unnecessary migration risk.

## 7. Core invariants

The database commands must enforce all of the following:

1. A normalized router serial is unique within an organization.
2. One unit has one physical holder: warehouse, employee custodian, legacy field agent, sold customer state, quarantine, damaged, or lost.
3. An unaccepted handover cannot be sold.
4. A unit with an open return request cannot be sold or handed over again.
5. Return approval never clears current custody.
6. Only Finance physical receipt clears custody.
7. Finance receipt must scan the same normalized serial as the requested line.
8. A return request may contain units from only one custodian and one project/city scope.
9. A cross-tenant product, employee, project, city, warehouse, handover, or file ID is rejected.
10. Commercial terms used by a sale are immutable snapshots.
11. A retry with the same command ID and payload returns the original result.
12. Reusing a command ID with a different actor, action, or payload fails.
13. All state, movement, business event, outbox event, and audit evidence commits in one transaction.
14. Counts are derived from unit states; no manually decremented dashboard counter is authoritative.
15. Historical project, city, recipient name, and position code remain visible even if HR data changes later.

## 8. Target workflows

### 8.1 Inbound receipt and commercial terms

~~~mermaid
flowchart LR
    A["Client workbook / manual / photos"] --> B["Finance preview"]
    B --> C{"Serial and product validation"}
    C -->|Errors| D["Correct rows; no stock created"]
    C -->|Valid| E["Finance sets price and commission"]
    E --> F["Finance confirms receipt"]
    F --> G["One inventory unit per serial"]
    G --> H["Central ready stock"]
~~~

Rules:

- Workbook upload creates a preview, not stock.
- A unit is created only on Finance confirmation.
- Price and commission values from the workbook, if present, are proposals. Finance must confirm them.
- Missing price or commission may be completed in the Finance screen.
- Receipt confirmation is blocked if any accepted line lacks a valid sale price or commission rule required by policy.
- Purchased stock keeps the current accounting posting behavior. Consignment stock keeps its current memorandum behavior.

### 8.2 Finance-to-custodian handover

~~~mermaid
flowchart LR
    A["Central ready stock"] --> B["Finance selects project and city"]
    B --> C["Select OGPM / OGSV1 recipient"]
    C --> D["Select exact serials or a counted group"]
    D --> E["Issue handover"]
    E --> F["In transit"]
    F --> G["Recipient checks serials and signs"]
    G --> H["With custodian / ready for sale"]
~~~

Rules:

- The handover stores exact serials even when the UI offers quantity selection.
- The recipient must have an active inventory operational assignment for the selected project/city.
- Project, city, position code, recipient name, and user ID are snapshotted.
- A recipient can accept only their own current handover.
- Finance can see pending and accepted handovers across all permitted scopes.
- The recommended default requires acknowledgment and signature.

### 8.3 Return request and physical return

~~~mermaid
stateDiagram-v2
    [*] --> WithCustodian
    WithCustodian --> ReturnPending: Submit serial + note + photo
    ReturnPending --> WithCustodian: Reject or cancel
    ReturnPending --> AwaitingDelivery: Required approvals complete
    AwaitingDelivery --> PartiallyReceived: Finance receives some serials
    AwaitingDelivery --> Received: Finance receives all serials
    PartiallyReceived --> Received: Finance receives remaining serials
    Received --> CentralReady: Sellable
    Received --> Quarantine: Inspection required
    Received --> Damaged: Confirmed damaged
~~~

Operational meaning:

| State | Ready to sell? | Still in custodian's physical custody? |
|---|---:|---:|
| with_custodian | Yes | Yes |
| return_pending | No, reserved to avoid sale/return races | Yes |
| awaiting_delivery | No | Yes |
| partially_received | Only unreceived lines remain in custody; none of the request lines are sellable | Partly |
| received/sellable | Central stock rules apply | No |
| received/quarantine | No | No |
| received/damaged | No | No |

This distinction implements the client's two requested count changes:

- Ready-for-sale custody count falls when the return is submitted/approved.
- Physical custody count falls only when Finance receives the exact serial.

For exact wording compliance, the UI can show the reduction at approval, but the sale command should block the unit from the moment a return request is submitted. If the request is rejected, it returns to ready-for-sale custody.

### 8.4 Approval policy

Return approval must be configurable per organization:

- both: one Finance Manager and the scoped Project Manager must approve;
- project_manager: Project Manager approves; Finance still performs mandatory physical receipt;
- finance_manager: Finance approves and later physically receives;
- either: either authorized approver releases the request for delivery.

Recommended initial value: both.

Regardless of the approval mode, finance_receipt_required is always true and is not configurable.

## 9. Proposed data model

Use additive forward migrations. Preserve existing field-agent commerce while introducing employee custodians.

### 9.1 product_inventory_operational_assignments

Purpose: explicit eligibility and scope for OGPM/OGSV1 custodians and approvers.

Suggested columns:

| Column | Notes |
|---|---|
| id | UUID primary key |
| organization_id | Tenant FK |
| employee_id | FK to employees |
| project_id | FK to sales_companies, matching the current HR project model |
| location_id | Optional FK to locations |
| city | Normalized display value; required if location is absent |
| position_code | OGPM, OGSV1, or a future configured code |
| responsibility | project_manager or supervisor |
| can_receive_custody | Boolean |
| can_sell | Boolean; default false until the client confirms selling behavior |
| can_request_return | Boolean |
| can_approve_return | Boolean |
| status | active or inactive |
| effective_from / effective_to | Assignment validity |
| version | Optimistic concurrency |
| created_by / updated_by / timestamps | Audit metadata |

Constraints:

- Employee, project, location, and organization must match.
- An active assignment requires an employee user account.
- A unique partial index prevents duplicate active responsibility for the same employee/project/location/position.
- At least one active Project Manager return approver must exist for each project/city before return approval mode both or project_manager can be enabled.

### 9.2 Generalized handover fields

Extend product_handovers:

- handover_type: legacy_agent or employee_custody;
- recipient_assignment_id;
- recipient_employee_id;
- recipient_user_id_snapshot;
- recipient_name_snapshot;
- recipient_responsibility_snapshot;
- position_code_snapshot;
- project_id;
- project_name_snapshot;
- location_id;
- city_snapshot;
- agent_id becomes nullable for new employee custody rows;
- add a check requiring exactly one recipient model.

Extend product_handover_lines:

- commercial_terms_id;
- commission_type_snapshot;
- commission_value_snapshot;
- commission_base_snapshot;
- preserve the existing planned/minimum/maximum sale-price snapshots.

Extend product_inventory_units:

- current_custodian_assignment_id;
- current_custodian_employee_id;
- current_project_id;
- current_location_id;
- current_city_snapshot;
- active_return_request_line_id;
- current_commercial_terms_id;
- new operational states: with_custodian, return_pending, return_approved, and quarantine;
- check constraints preventing simultaneous warehouse, field-agent, and employee custody.

Extend product_inventory_movements:

- from_custodian_employee_id;
- to_custodian_employee_id;
- return_request_id;
- return_request_line_id;
- movement types for employee handover, return reservation/rejection, physical return, and quarantine.

Keep agent_id/current_agent_id for the legacy field-agent commerce path during the transition. Do not perform a risky all-at-once rewrite.

### 9.3 Commercial terms

Create product_inventory_commercial_terms.

Suggested columns:

| Column | Notes |
|---|---|
| id | UUID primary key |
| organization_id | Tenant FK |
| receipt_line_id | Batch-level target, nullable |
| unit_id | Unit override target, nullable |
| planned_sale_price | Positive amount |
| minimum_sale_price / maximum_sale_price | Optional Finance policy |
| commission_type | flat, percentage, or none |
| commission_value | Non-negative; percentage capped at 100 |
| commission_base | net_amount by default |
| currency | Three-letter currency |
| effective_at / superseded_at | Immutable history |
| supersedes_id | Prior terms row |
| reason | Required for post-confirmation changes |
| set_by | Finance actor |
| version / timestamps | Concurrency and audit |

Constraints and behavior:

- Exactly one of receipt_line_id or unit_id is present.
- Only one active term row exists per target.
- Unit override wins over receipt-line terms.
- Receipt confirmation copies the active terms reference to each created unit.
- Handover snapshots the active terms.
- Sale calculates commission from the handover snapshot, not sales_products current values.
- Terms may be changed freely while a receipt is editable.
- After confirmation, changes create a new immutable terms version.
- By default, a terms change applies only to central in-stock units and future handovers.
- A unit already in accepted custody keeps its accepted terms unless a future separately approved terms-change workflow is added.

The existing sales_products.agent_commission_type/value may remain the catalog default, but no longer serves as historical truth for these router sales.

### 9.4 Return tables

Create product_return_requests:

- id, organization_id, return_no;
- requester_user_id and requester_employee_id;
- custodian_assignment_id and custodian_employee_id;
- project_id, location_id, city_snapshot, position_code_snapshot;
- warehouse_id proposed for return;
- approval_mode_snapshot;
- status: draft, pending_approval, approved_awaiting_delivery, rejected, partially_received, received, cancelled;
- reason_summary;
- version;
- submitted_at, approved_at, rejected_at, completed_at;
- created_at and updated_at.

Create product_return_request_lines:

- id, organization_id, return_request_id;
- unit_id and handover_id;
- serial_snapshot and product_name_snapshot;
- requester_note, claimed_condition;
- status: pending, approved, rejected, awaiting_delivery, received_sellable, received_quarantine, received_damaged, discrepancy, cancelled;
- requested_at, received_at;
- received_by;
- inspection_note;
- version.

Create product_return_attachments:

- id, organization_id, return_request_id, return_line_id;
- managed_file_id;
- original_name, MIME type, file size, SHA-256;
- captured_at and uploaded_by;
- evidence_type: requester_photo or finance_inspection_photo.

Create product_return_approvals:

- id, organization_id, return_request_id;
- approver_type: finance_manager or project_manager;
- assigned_approver_user_id;
- decision: pending, approved, rejected;
- decision_note;
- decided_by and decided_at;
- version;
- unique return_request_id plus approver_type/assigned approver.

Create product_return_receipts:

- id, organization_id, return_request_id, warehouse_id;
- received_by, received_at, notes;
- command_id/request_id evidence;
- status: completed or discrepancy.

Create product_return_receipt_lines:

- receipt_id, request_line_id, unit_id;
- scanned_serial;
- disposition: sellable, quarantine, damaged;
- condition_received and inspection_note;
- unique request_line_id so a serial cannot be physically received twice.

### 9.5 Settings

Extend product_inventory_commerce_settings or create product_inventory_workflow_settings:

- finance_managed_receiving_enabled;
- return_approval_mode;
- finance_receipt_required, fixed true;
- require_return_photo;
- minimum_return_photos, default 1;
- maximum_return_photos, default 3;
- require_handover_acknowledgment;
- allow_supervisor_sales;
- default position-code mapping;
- designated Finance return approver IDs;
- default warehouse;
- version and updated_by.

## 10. Derived counts and reports

Never mutate numeric stock counters directly. Use server-side aggregate functions over unit and open-return states.

Required metrics:

- central_ready_units: in_stock, sellable condition, active commercial terms, no open return;
- custody_ready_units: with_custodian, accepted handover, no open return;
- return_pending_units: linked to pending approval;
- awaiting_return_delivery_units: approved but not physically received;
- physical_custody_units: with_custodian plus return_pending plus return_approved;
- in_transit_units;
- quarantine_units;
- damaged_units;
- sold_units.

Required grouping dimensions:

- project;
- city/location;
- recipient;
- responsibility;
- position code;
- product/model;
- receipt/batch;
- handover;
- state.

The primary client report should show:

| Project | City | Recipient | Code | Received | Ready to sell | Return pending | Awaiting delivery | Physically held | Sold | Returned |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|

Each number must drill down to the exact serial list and movement timeline.

## 11. API and command design

### 11.1 Reuse and refactor

Keep the existing generic receipt APIs and components, but change their guard to an explicit Finance receiving capability. Do not grant Finance unrestricted sales-module access.

Recommended canonical Finance UI:

- /accounting/inventory remains valuation and reconciliation.
- /accounting/inventory/operations becomes the operational landing page.
- /accounting/inventory/operations/receipts
- /accounting/inventory/operations/handovers
- /accounting/inventory/operations/custody
- /accounting/inventory/operations/returns
- /accounting/inventory/operations/pricing

The current /sales/inventory pages may remain for legacy managers during a controlled transition, then redirect when the feature flag is enabled.

### 11.2 Proposed endpoints

| Method and route | Purpose |
|---|---|
| GET /api/sales/inventory/operational-assignments | List eligible scoped recipients |
| POST/PATCH /api/sales/inventory/operational-assignments | Admin configuration |
| POST /api/sales/inventory/receipts | Finance draft save |
| POST /api/sales/inventory/receipts/{id}/confirm | Finance confirmation |
| POST /api/sales/inventory/commercial-terms | Set or supersede terms |
| GET/POST /api/sales/inventory/handovers | Load workspace / issue employee custody |
| POST /api/sales/inventory/handovers/{id}/accept | Recipient acknowledgment |
| GET /api/sales/inventory/custody | Scoped custody report |
| GET /api/sales/inventory/me/custody | Authenticated recipient view |
| GET/POST /api/sales/inventory/return-requests | List / submit |
| GET /api/sales/inventory/return-requests/{id} | Detail, photos, approvals, timeline |
| POST /api/sales/inventory/return-requests/{id}/review | Finance/PM decision |
| POST /api/sales/inventory/return-requests/{id}/receive | Finance scan and physical receipt |
| POST /api/sales/inventory/return-requests/{id}/cancel | Requester cancellation when allowed |
| GET /api/sales/inventory/return-requests/{id}/attachments/{attachmentId} | Authorized private evidence |

Keep the current immediate POST /api/sales/inventory/returns only for the legacy field-agent workflow until migrated. Do not silently change its request or response contract.

### 11.3 New database command

Create execute_product_custody_command rather than applying more text replacements to execute_product_commerce_command.

Actions:

- operational_assignment_save;
- commercial_terms_set;
- employee_handover_issue;
- employee_handover_accept;
- return_request_submit;
- return_request_review;
- return_request_cancel;
- return_physical_receive.

Each action must:

1. authorize the current organization and actor;
2. canonicalize and hash the payload;
3. claim an idempotency key;
4. lock affected units in UUID order;
5. validate current version and state;
6. validate every reference against the organization;
7. make all table/state changes;
8. append movement and audit evidence;
9. write one business event and outbox event;
10. complete the command and return the stable result.

### 11.4 Concurrency cases that must be resolved in the command

- Sale versus return submission for the same serial: one wins; the other receives a conflict.
- Two return submissions for the same serial: exactly one open request.
- Approval versus cancellation: exactly one current version wins.
- Two Finance users physically receiving the same serial: exactly one receipt line.
- Handover versus pricing change: lock the unit and active terms row.
- Partial receipt retry: already received lines replay safely; changed scanned serials fail.

## 12. Workbook integration plan

The current importer already supports:

- XLSX and CSV;
- Arabic and English header aliases;
- SKU/name/barcode product matching;
- serial normalization;
- leading-zero protection;
- duplicate detection;
- preview and correction;
- private storage and SHA-256 evidence.

The real client workbook is still a release dependency.

### 12.1 Recommended import-profile model

Add a versioned product_inventory_import_profiles record:

- organization_id;
- name and version;
- supplier/project;
- sheet name or first-sheet rule;
- header-row number;
- JSON mapping from client headers to canonical fields;
- required fields;
- default currency, condition, and ownership;
- active flag;
- sample file hash and approval metadata.

Canonical fields:

- supplier/reference;
- product SKU/name/model/barcode;
- serial number;
- unit cost;
- proposed sale price;
- commission type/value if supplied;
- currency;
- condition;
- project;
- city/location;
- notes.

At minimum, serial plus a stable product identifier is required. Cost, price, or commission may be completed by Finance in the preview if the client form omits them.

### 12.2 Sample acceptance process

When the client sends the form:

1. save a redacted copy as a non-production test fixture;
2. record the original sheet name, header row, merged cells, formulas, hidden columns, numeric serial behavior, and maximum expected rows;
3. map headers without changing the original evidence;
4. test leading zeros and long serials;
5. verify duplicate behavior within the file, another draft, and confirmed stock;
6. agree whether price/commission columns are trusted proposals or ignored;
7. obtain written sign-off for the import profile version;
8. keep the prior profile available for historical reprocessing, but allow only the active profile for new receipts.

## 13. UI blueprint

### 13.1 Finance operations dashboard

Header: إدارة أجهزة الراوتر 5G

KPI cards:

- جاهز بالمخزن;
- جاهز للبيع في العهد;
- بانتظار تأكيد الاستلام;
- مرتجعات قيد الموافقة;
- معتمد وبانتظار التسليم;
- حجر/تالف.

Filters:

- project;
- city;
- recipient type/code;
- recipient;
- product/model;
- state;
- receipt date;
- serial search.

Tabs:

1. الاستلام
2. التسعير والعمولة
3. التسليم والعهد
4. المرتجعات
5. حركة السريال
6. التقارير

### 13.2 Receipt screen

- Upload the approved form, use camera/photos, or enter manually.
- Preview errors and warnings before commit.
- Group identical product/cost/price/commission units while retaining serial rows.
- Finance inputs:
  - sale price;
  - minimum/maximum if used;
  - commission type;
  - commission value;
  - currency;
  - optional reason.
- Show cost, expected revenue, expected commission, and expected margin.
- Confirmation modal summarizes unit count and value and warns that serials will become stock.

### 13.3 Handover wizard

Step 1: project and city.  
Step 2: recipient responsibility and OG code.  
Step 3: eligible recipient.  
Step 4: warehouse and product.  
Step 5: quantity selection with exact serial preview.  
Step 6: commercial-terms summary and acknowledgment requirement.  
Step 7: issue and show handover number.

The UI may let Finance select a quantity from a homogeneous group, but must deterministically show and submit the exact serial IDs before confirmation.

### 13.4 Project Manager/Supervisor custody screen

- Pending handovers with serial review and signature.
- Current physical custody.
- Ready for sale.
- Return pending and awaiting delivery.
- Serial detail timeline.
- Return action only for eligible unsold units.
- Sale action only when can_sell is true.
- No unit cost, gross margin, or other Finance-only values.

### 13.5 Return request screen

Requester:

- select or scan serial;
- verify that it belongs to current custody;
- enter note/reason;
- capture at least one photo;
- repeat for more serials from the same custody scope;
- review the count and submit.

Approver:

- request number and status;
- requester, project, city, code;
- exact serials and product;
- photo viewer;
- note;
- approve/reject with required decision note on rejection;
- timeline showing every actor and timestamp.

Finance physical receipt:

- scan serial;
- highlight mismatch immediately;
- choose sellable, quarantine, or damaged;
- add inspection note/photo when not sellable;
- select receiving warehouse for sellable units;
- support partial receipt;
- final summary showing which serials left custody.

### 13.6 Count labels

Avoid one ambiguous label called ready devices. Show:

- جاهز للبيع بعهدة الموظف;
- عهدة فعلية لدى الموظف;
- مرتجع محجوز وغير قابل للبيع;
- مخزون مركزي جاهز.

This prevents users from interpreting the same return as both a decrease and an increase in one counter.

## 14. Notification blueprint

Durable topics:

- product_inventory.employee_handover_issued;
- product_inventory.employee_handover_accepted;
- product_inventory.return_requested;
- product_inventory.return_approved;
- product_inventory.return_rejected;
- product_inventory.return_partially_received;
- product_inventory.return_received;
- product_inventory.return_discrepancy;
- product_inventory.commercial_terms_changed.

Recipient rules:

| Event | Recipients | Link |
|---|---|---|
| Handover issued | Exact recipient | Own handover acceptance |
| Handover accepted | Issuing Finance Manager | Handover detail |
| Return requested | Designated Finance approver(s) and scoped Project Manager approver(s) | Return review detail |
| Return approved/rejected | Requester and other approver | Return detail |
| Awaiting physical delivery | Requester and Finance receiving group | Return receive detail |
| Partial/full receipt | Requester and scoped Project Manager | Return timeline |
| Discrepancy | Finance Manager and Admin support owner | Discrepancy detail |

Rules:

- Use business_event_id plus user_id for exactly-once delivery.
- Notification read state is independent from approval state.
- The action API rechecks the approver's current assignment and request version.
- If a project has no active Project Manager approver, submission fails with an actionable configuration error when policy requires that approver.
- A reminder/escalation job may notify after an agreed SLA, but should be a later configurable enhancement.

## 15. Authorization changes

### 15.1 Server guards

Refactor src/lib/server/product-inventory-auth.ts into explicit capabilities:

- productInventoryReceivingRoles: finance_manager plus audited admin break-glass;
- productInventoryPricingRoles: finance_manager;
- productInventoryHandoverRoles: finance_manager;
- productInventoryReturnReceivingRoles: finance_manager;
- productInventoryFinanceReadRoles: finance_manager, accountant, finance_viewer;
- operational recipient access: validated by active assignment and employee ID, not only workspace role.

Do not use the current requireEmployee rule blindly for Finance Manager. Finance may not have an employee row in all tenants. The actor user ID is enough for Finance operations, while a recipient must have an employee row.

### 15.2 Middleware and navigation

Update src/lib/rbac.ts with exact route access:

- Finance Manager may access Finance inventory operations and the required inventory APIs.
- Accountant and Finance Viewer remain read-only.
- Supervisor may access only their custody/return endpoints and scoped UI.
- No Finance role receives general sales-module access.
- Inventory Receiver loses mutation routes at cutover.

Update:

- src/components/layout/Sidebar.tsx;
- src/components/layout/Header.tsx;
- employee/account role forms;
- superadmin role labels and role lists;
- docs/ROLE_CAPABILITY_MATRIX.md;
- seeded demo/UAT users.

### 15.3 Database authorization

Replace role lists consistently in:

- can_receive_product_inventory;
- can_manage_product_inventory or new narrower helpers;
- receipt/import/photo command actor checks;
- new custody command checks;
- RLS select policies;
- finance report functions.

Do not repeat the v134 function-text replacement technique. Define the full corrected function in a forward migration and verify its body/behavior in database tests.

## 16. Accounting behavior

| Event | Accounting effect |
|---|---|
| Set price/commission | None; commercial policy only |
| Confirm purchased receipt | Existing inventory receipt posting |
| Confirm consignment receipt | Existing no-GL/memorandum behavior |
| Handover to custodian | No GL; custody movement only |
| Return request/approval | No GL; operational reservation only |
| Physical return as sellable | No GL when it is an unsold internal custody transfer |
| Physical return to quarantine | No immediate loss until Finance classifies it |
| Physical return as damaged | Use existing loss/damage posting policy with a linked return source |
| Product sale | Existing revenue/VAT/COGS and commission accrual, but use immutable term snapshots |
| Commission settlement | Existing Finance settlement flow |

Reconciliation must add:

- central stock plus physical custody plus in-transit plus quarantine plus sold/lost states equals confirmed units by serial;
- every current employee-custody unit has one active accepted handover line;
- every open return line points to the same current custodian;
- every received return line has no current custodian;
- commission accrual matches the sale's snapshotted rule.

## 17. File and evidence security

- Store return photos in private managed storage using the existing file-storage abstraction.
- Use a dedicated bucket/container such as product-return-evidence.
- Object path must include organization, return request, line, and a random/hashed component.
- Register every object in managed_files and add product_return_evidence to the allowed owner types.
- Allow camera-produced JPEG/PNG/WebP; normalize mobile capture to JPEG where practical.
- Inspect MIME by content, not extension.
- Apply size limits, aggregate request limits, hash validation, and malware/scan status.
- Recommended default: up to 3 images per serial, 8 MB each, configurable lower at deployment.
- Download through an authenticated server endpoint that verifies tenant and return scope.
- Do not expose public object URLs.
- Define retention with the client and applicable finance/audit policy; do not delete evidence while the return or related accounting event is legally retained.

## 18. Implementation phases

### Phase 0: Business decisions and fixture acquisition

Deliverables:

- Confirm what OGPM and OGSV1 mean.
- Receive and redact the real workbook.
- Confirm whether Supervisors/Project Managers sell or only hold/distribute.
- Confirm return approval mode.
- Confirm commission formula and base.
- Confirm return dispositions and photo retention.
- Name the Finance and Project Manager UAT approvers.

Exit criteria:

- Signed mapping sheet and actor matrix.
- Approved workbook fixture and expected parsed output.

### Phase 1: Finance authority and safe role retirement

Deliverables:

- New Finance operational feature flag.
- Explicit receiving/pricing/handover/return guards.
- Finance navigation to inventory operations.
- Inventory Receiver removed from new assignments and operational writes.
- Admin migration report for existing receiver accounts.
- Updated role capability documentation and tests.

Exit criteria:

- Finance Manager can use receipt flows.
- Accountant/Viewer cannot mutate.
- Legacy receiver cannot gain Finance rights automatically.

### Phase 2: Import profile and commercial terms

Deliverables:

- Versioned client workbook mapping.
- Price and commission fields in preview/manual/photo flows.
- Commercial terms table and atomic terms command.
- Receipt confirmation requires valid terms.
- Handover/sale snapshots use those terms.

Exit criteria:

- Every sample serial imports exactly once.
- Finance totals and commission previews match the signed expected file.
- Later product-master edits do not change historical sale commission.

### Phase 3: Employee custodian and city/project handovers

Deliverables:

- Operational assignment configuration.
- Generalized employee handover fields.
- Finance handover wizard.
- Recipient acknowledgment and scoped custody screen.
- Project/city/OG-code custody report.

Exit criteria:

- Finance can assign exact serials to an eligible OGPM/OGSV1 recipient.
- Recipient sees only own/scoped data.
- The report answers the client's X devices in Y city question from serial data.

### Phase 4: Evidence-backed returns

Deliverables:

- Return request, lines, attachments, approvals, and physical receipt tables.
- Submit/review/cancel/receive database commands.
- Requester, approver, and Finance receipt screens.
- Partial receipt and discrepancy handling.
- Sellable/quarantine/damaged disposition.

Exit criteria:

- Approval blocks sale but keeps custody.
- Only physical Finance receipt removes custody.
- Every transition retains serial, note, image, actor, timestamp, and request ID.

### Phase 5: Notifications, reporting, and accounting integration

Deliverables:

- Durable return/handover topics and handlers.
- Exactly-once actionable notifications.
- Derived KPI/report functions.
- Damage posting linkage and expanded reconciliation.
- Monitoring for stuck return commands/events.

Exit criteria:

- Correct Finance/PM recipients are notified once.
- Counts reconcile at organization, project, city, recipient, and serial level.

### Phase 6: Hardening, UAT, and rollout

Deliverables:

- Unit, route, database, concurrency, upload, and authorization tests.
- Arabic RTL/mobile QA.
- Client UAT guide and sign-off matrix.
- Controlled pilot, monitoring, forward-fix, and rollback procedure.

Exit criteria:

- Automated gates pass.
- Pilot reconciles every serial.
- Named Finance, Project Manager, operations, accounting, and support approvers sign off.

## 19. Proposed migration sequence

The next available migration number is v141.

1. schema_v141_finance_managed_product_inventory.sql
   - capabilities, settings, feature flag, role transition support.
2. schema_v142_product_inventory_commercial_terms.sql
   - effective terms and receipt/unit references.
3. schema_v143_product_inventory_employee_custody.sql
   - operational assignments and generalized handover/unit/movement fields.
4. schema_v144_product_inventory_return_workflow.sql
   - return headers, lines, approvals, attachments, receipts, indexes, RLS.
5. schema_v145_atomic_product_custody_commands.sql
   - clean idempotent commands, events, outbox, audit, and state transitions.
6. schema_v146_product_inventory_reporting_hardening.sql
   - aggregate functions, reconciliation, monitoring, and constraints.

For every migration:

- add it to db/migrations.manifest.json;
- update src/lib/schema-version.json;
- keep it forward-only and idempotent;
- add migration verification checks;
- update generated/manual database types;
- avoid destructive rewrites of historical rows.

## 20. File-level implementation map

### Database and verification

- db/schema_v141... through db/schema_v146...
- db/migrations.manifest.json
- src/lib/schema-version.json
- scripts/test-database-migrations.mjs
- scripts/verify-product-inventory-hardening.mjs
- scripts/verify-outbox-topics.mjs

### Authorization and navigation

- src/lib/server/product-inventory-auth.ts
- src/lib/server/tenant-context.ts if a new capability resolver is needed
- src/lib/rbac.ts
- src/components/layout/Sidebar.tsx
- src/components/layout/Header.tsx
- role option/label files currently containing inventory_receiver
- docs/ROLE_CAPABILITY_MATRIX.md

### Domain, API, and services

- src/lib/product-inventory/schemas.ts
- src/lib/product-inventory/workbook.ts
- src/lib/server/product-inventory-api.ts
- src/lib/server/product-inventory-commerce.ts
- new src/lib/server/product-inventory-custody.ts
- src/lib/services/product-inventory.ts
- src/types/product-inventory.ts
- src/lib/server/outbox-worker.ts
- new API routes described in section 11

### UI

- Refactor reusable receipt components under src/components/product-inventory/
- New Finance operations shell and tabs.
- New employee custody component.
- New return request/review/receive components.
- New pages under src/app/(app)/accounting/inventory/operations/
- Supervisor navigation/page integration.

### Documentation

- docs/PRODUCT_INVENTORY_PHASE_6_UAT_RUNBOOK.md
- docs/PRODUCT_INVENTORY_PRODUCTION_MANUAL_TESTING_GUIDE.md
- docs/UAT_CHECKLIST.md
- docs/ROLE_CAPABILITY_MATRIX.md
- a new client-specific import-profile document after receiving the workbook.

## 21. Test plan

### 21.1 Unit tests

- OG code and assignment validation.
- Workbook profile header mapping.
- Serial normalization and leading zeros.
- Price range and commission calculations.
- Ready/physical custody count derivation.
- Return state transition rules.
- Notification recipient selection.

### 21.2 API and authorization tests

- Finance Manager can receive, price, hand over, approve, and physically receive.
- Accountant and Finance Viewer can read but cannot mutate.
- Supervisor can access only own custody and return records.
- Project Manager can review only assigned project/city returns.
- Legacy Inventory Receiver cannot use new write endpoints.
- Tenant A cannot submit Tenant B employee, project, warehouse, unit, return, or attachment IDs.
- Suspended users/assignments fail closed.

### 21.3 Database command tests

- Duplicate serial rejected.
- Receipt confirmation replay creates no duplicate unit.
- Handover locks exact units.
- Recipient acknowledgment is versioned.
- Commercial terms are snapshotted.
- Sale versus return submission has exactly one winner.
- Duplicate return submission is rejected.
- Approval policy both/either works as configured.
- Approval does not clear custody.
- Physical receipt clears only scanned lines.
- Mismatched serial creates no stock movement.
- Partial return retains remaining custody.
- Sellable return enters the selected warehouse.
- Quarantine/damaged return is not ready for sale.
- Outbox failure rolls back the whole business command.

### 21.4 File tests

- Wrong MIME and oversized files rejected.
- Missing photo rejected when required.
- Cross-tenant attachment download denied.
- Failed command cleans unregistered uploaded objects.
- Retried upload/command does not duplicate evidence.

### 21.5 UI/UAT scenarios

1. Finance uploads the real client workbook.
2. Finance corrects one unmatched product.
3. Finance sets price and flat commission.
4. Finance confirms ten unique router serials.
5. Finance assigns six to OGSV1 in City A and four to OGPM in City B.
6. Each recipient checks serials and accepts.
7. Report totals show six/four by city and recipient.
8. Supervisor requests return of two serials with separate notes/photos.
9. Finance and Project Manager receive notifications.
10. Required approvers approve.
11. The two units leave ready-to-sell count but remain in physical custody.
12. Finance physically receives one as sellable and one as damaged.
13. Both leave the supervisor's custody.
14. Sellable stock increases by one; damaged stock increases by one.
15. Serial timelines, photos, audit, and movement history reconcile.

## 22. Release and rollback strategy

Use a feature flag so the new Finance workflow can be enabled per organization.

Recommended rollout:

1. deploy additive schema and read paths;
2. configure named Finance and operational assignments;
3. import the approved workbook profile;
4. run a small serial-level pilot;
5. freeze legacy receiver writes;
6. enable Finance-managed receiving;
7. observe one complete receive, handover, return, and sale/accounting cycle;
8. expand volume after reconciliation sign-off.

Rollback:

- Disable the feature flag to stop new Finance custody/return commands.
- Keep all schema, events, movements, approvals, and evidence.
- Revert the application only to a build compatible with the applied migrations.
- Resolve data defects with forward migrations or supported reversal commands.
- Never delete or manually rewrite unit state, custody, movement, sale, return, or accounting evidence.

Stop-the-line conditions:

- duplicate or missing serial;
- custody owner mismatch;
- cross-tenant exposure;
- unit sold after return reservation;
- physical receipt without a matching approved serial;
- unexplained inventory/GL difference;
- missing required evidence;
- duplicate accounting or commission posting.

## 23. Launch-blocking client decisions

These questions must be answered before final implementation sign-off:

1. Are OGPM and OGSV1 job/position codes, application roles, or project codes?
2. Does a Project Manager or Supervisor sell devices directly, or only hold and distribute them?
3. Must both Finance and Project Manager approve a return, or is either approval sufficient?
4. Can Finance reject/hold a return before physical delivery?
5. What exact columns, sheet name, and header row exist in the client workbook?
6. Is commission flat per router, percentage of net sale, percentage of gross sale, or model-specific?
7. Can Finance change price/commission after custody acceptance, and if so must the recipient re-accept?
8. Is one photo per serial mandatory, and how long must it be retained?
9. What dispositions are required: sellable, quarantine, damaged, repair, supplier return?
10. Which warehouse receives sellable returns in each city/project?

Safe defaults if the client does not decide:

- OGPM/OGSV1 are operational assignment codes.
- Custodians do not sell unless can_sell is enabled.
- Both Finance and Project Manager approve.
- Finance may reject or place on hold.
- Commission is a flat per-unit amount in SAR.
- Accepted custody terms are immutable.
- One requester photo is mandatory; one Finance inspection photo is mandatory for non-sellable disposition.
- Dispositions are sellable, quarantine, and damaged.
- The organization's default active warehouse receives sellable returns.

## 24. Definition of done

The feature is complete only when:

- Finance Manager has replaced Inventory Receiver in the normal workflow without accidental accounting-role escalation.
- The signed client workbook imports all expected serials and rejects invalid/duplicate values.
- Every confirmed router has valid commercial terms.
- Finance can hand exact serials to an eligible Project Manager or Supervisor in a project/city.
- Recipients can accept and see only their authorized custody.
- The project/city custody report reconciles to serials.
- Return submission requires serial, note, and photo.
- Required Finance/Project Manager approvals are explicit and audited.
- Return approval blocks sale but does not remove physical custody.
- Finance physical receipt removes only scanned serials from custody.
- Sellable, quarantine, and damaged counts update from unit states.
- Notifications are exactly once and link to authorized action pages.
- Historical price, commission, project, city, recipient, photo, movement, and accounting evidence remains immutable and accessible to authorized users.
- Concurrency, tenant isolation, file security, reconciliation, RTL/mobile UAT, monitoring, and pilot sign-off all pass.

## 25. Recommended first implementation action

Before writing schema v141, obtain the real workbook and a written definition of OGPM/OGSV1. In parallel, identify the named Finance Manager and Project Manager approvers. Those inputs determine the import profile, recipient authorization model, approval policy, and safe account migration.
