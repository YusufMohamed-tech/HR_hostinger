# HRMS Data Governance and Retention Policy

Status: launch policy template pending Legal/HR/Finance approval  
Technical owner: Engineering  
Business owners: HR, Finance, Sales Operations, Learning, Security  
Last reviewed: 2026-07-19

The application enforces tenant scope, private managed storage, legal holds, auditable lifecycle commands, and retryable deletion. The retention periods below are policy proposals, not legal advice. The named business owners must replace proposed periods with approved jurisdiction-specific values before production go-live.

## 1. Data principles

- Collect only data needed for an approved HR, payroll, accounting, sales, learning, security, or compliance purpose.
- Keep organization data tenant-scoped; service-role access is server-only and limited to trusted commands/jobs.
- Use soft lifecycle states and immutable ledgers for employment, leave, payroll, accounting, sales, and audit history.
- Store private attachments in non-public buckets and issue short-lived signed access only after authorization.
- Block deletion while a legal hold is active. Legal hold release requires the Legal owner and a recorded audit trail.
- Do not place secrets, identity documents, bank data, health data, or malware-scan payloads in logs.

## 2. Classification

| Class | Examples | Minimum handling |
|---|---|---|
| Restricted | national ID, bank/IBAN, payroll, medical/leave evidence, contracts, personnel files, candidate documents | Need-to-know roles, private storage, encryption in transit/at rest, audit trail |
| Confidential | employee profiles, attendance/location evidence, performance/task data, chat, LMS submissions, sales assignments | Tenant scope, role scope, authenticated access, retention control |
| Internal | organization settings, course catalog drafts, operational aggregates | Authenticated tenant access |
| Public | published job posting and approved application form | Explicit publication decision; no internal fields |

## 3. Retention decision register

| Record family | System behavior | Proposed policy decision before launch | Owner |
|---|---|---|---|
| Employee master/career/lifecycle | Historical record; normal hard-delete blocked | Retain employment plus approved statutory/claims period | HR + Legal |
| Contracts, IDs, personnel files | Managed private files; per-file `retention_until` and legal hold | Define by document category and jurisdiction | HR + Legal |
| Payroll, payslips, GOSI configuration | Immutable/versioned payroll evidence | Define statutory payroll/tax/social-insurance period | Payroll + Legal |
| Journals, payments, invoices, expenses, assets | Posted records are preserved/reversed, not overwritten | Define accounting/tax/audit period | Finance + Legal |
| Attendance/location evidence | Authoritative attendance events | Define labor-claim and security-evidence period | HR + Legal |
| Leave balances/transactions/requests | Ledger and workflow history | Align to employment and labor-claim policy | HR + Legal |
| Recruitment candidates/applications/files | Candidate-scoped private data | Define unsuccessful-candidate and hired-candidate transfer periods | Recruitment + Legal |
| Chat messages/attachments | Organization setting defaults to 730 days; supported range 30–3650 | Confirm tenant default and legal-hold/export process | HR + Security |
| LMS enrollments/attempts/submissions/certificates | Learning and certification history | Define required training/certification period | Learning + Legal |
| Tasks/comments/attachments | Operational work records | Define by task category; prohibit sensitive data where unnecessary | Product owners |
| Sales logs, cash, commissions, SIM lifecycle | Immutable event/reconciliation records | Align to finance, fraud, and contract requirements | Sales Ops + Finance |
| Security/audit/business events/command ledgers | Evidence and replay protection | Define security investigation and audit period; restrict access | Security + Legal |

No production file may receive an arbitrary `retention_until` without an approved category rule. Until approval, legal-sensitive records must remain held rather than automatically deleted.

## 4. Data-subject requests

Every access, correction, restriction, export, or erasure request requires identity verification, tenant confirmation, ticket/reference ID, approver, scope, due date, and completion evidence.

- Access/export: export only the requester’s authorized tenant data; exclude third-party data and secrets.
- Correction: use normal versioned workflows. Do not rewrite posted financial/payroll ledgers; use an adjustment/reversal with reason and approval.
- Restriction: suspend access or place a legal hold without destroying evidence.
- Erasure: normal application flows do not hard-delete employee/financial history. Legal and Security must determine whether erasure, anonymization, or statutory retention applies; any DBA procedure is separately approved and rehearsed.

## 5. Legal hold

Legal identifies owner type/id, tenant, reason, scope, start date, custodian, and review date. Engineering sets the supported legal-hold flag for managed files and suspends relevant scheduled deletion. Release requires Legal approval, evidence preservation confirmation, and an auditable change. Retention workers must never delete rows with `legal_hold=true`.

## 6. Secure disposal

The managed-file retention worker claims eligible records, removes storage objects, records completion, retries failures, and emits a dead-letter event after repeated failure. Operations investigates every dead letter. Database records governed by immutable ledgers are disposed only through an approved, separately tested DBA process after Legal and business-owner approval.

## 7. Governance evidence required for launch

- approved retention periods by record family and jurisdiction;
- approved privacy notice, employee/candidate notices, and consent/lawful-basis wording where applicable;
- named data owners and request-response procedure;
- legal-hold creation/release test;
- access/export/correction/erasure tabletop exercise;
- file-retention success, retry, dead-letter, and restore evidence;
- quarterly review date and exception register.

