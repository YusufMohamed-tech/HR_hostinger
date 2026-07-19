# Payroll Formula Specification

Status: launch baseline  
Formula version: `sa-payroll-v1`  
Money precision: one halala (SAR 0.01)

## Purpose and control boundary

This document is the authoritative calculation contract for payroll. It defines what the engine calculates, which inputs must be configured, how rounding works, and which state transitions are allowed. It is an engineering control document, not legal or payroll advice. The organization remains responsible for validating employee classifications, statutory coverage, registered contributory wages, rates, and effective dates with its payroll/legal adviser.

The browser must never calculate or write payroll. A trusted server process loads tenant-scoped inputs, calls the pure formula engine, hashes the complete input/output snapshot, and invokes an atomic database command. Approved and paid payroll snapshots are immutable.

## Period and eligibility

- A payroll month is stored as its first ISO date, for example `2026-07-01`.
- Calendar-day proration is used for base salary and any earning or recurring deduction explicitly marked as prorated.
- `payable days` is the inclusive overlap between the payroll month and the employee's active employment interval. It must be between zero and the number of calendar days in the month.
- Only employees whose employment interval overlaps the month can receive a payslip.
- Attendance and leave inputs are limited to the same tenant, employee, and payroll month.
- A payroll run is unique per organization and month.

## Exact arithmetic and rounding

All money enters the formula as integer halalas. Rates enter as integer basis points, where 100 basis points equals 1%. Multiplication and division use round-half-up to the nearest halala at each independently payable component. Floating-point accumulation is prohibited.

For a prorated component:

```text
prorated amount = round_half_up(monthly amount × payable days ÷ calendar days)
```

For a percentage component:

```text
percentage amount = round_half_up(rate base × rate basis points ÷ 10,000)
```

## Earnings

```text
earned base salary = prorate(monthly base salary)
total allowances = sum(prorated/non-prorated allowance lines) + manual bonus lines
gross earnings = earned base salary + total allowances
```

Every allowance line has a stable code, label, configured amount, and an explicit `prorate` flag. The legacy employee `bonus` value is treated as a fixed allowance and is prorated.

## Deductions

```text
recurring deductions = sum(prorated/non-prorated recurring deduction lines)
attendance deductions = late deduction + absence deduction
other deductions = advance deductions + other approved deductions + manual deduction lines
employee deductions = recurring deductions
                    + attendance deductions
                    + other deductions
                    + employee social-insurance contribution
```

Attendance deduction amounts are produced from the employee's versioned deduction-rule snapshot. The payroll engine receives the resulting exact amounts and records the underlying days, minutes, rates, and rule values in its input snapshot.

An advance may be deducted only through a unique, approved advance installment allocated to this employee and payroll month. The installment identifier is recorded in the payroll snapshot. The same installment cannot be consumed by two payslips or two payroll runs.

## Social insurance

Social insurance is never inferred from nationality, GOSI number, hire date, or a global hardcoded percentage.

For an employee marked as registered, payroll requires an active, verified configuration with:

- scheme code and effective dates;
- registered contributory wage for the period;
- maximum contributory wage, when applicable;
- employee rate in basis points;
- employer rate in basis points;
- whether the configured wage is prorated for a partial employment month;
- verifier and verification timestamp.

```text
insured base = min(configured contributory wage for the period, configured cap)
employee contribution = round_half_up(insured base × employee rate ÷ 10,000)
employer contribution = round_half_up(insured base × employer rate ÷ 10,000)
```

An unregistered employee has zero employee and employer contribution. A registered employee with missing, unverified, expired, or ambiguous configuration blocks the calculation.

This configuration requirement is necessary because Saudi coverage and contribution rates vary by applicable system and coverage. Official reference points include the [GOSI employer FAQ](https://www.gosi.gov.sa/GOSIOnline/FAQ_Employer), [GOSI SANED FAQ](https://www.gosi.gov.sa/GOSIOnline/%28en_US%29__FAQ_Unemployment_Insurance_%28SANED%29?locale=en_US), and [GOSI awareness material for the new Social Insurance Law](https://awareness.gosi.gov.sa/businessJourney.html). These links are references for configuration review; they are not embedded formula constants.

## Net pay and failure rules

```text
net pay = gross earnings - employee deductions
total employer payroll cost = gross earnings + employer social-insurance contribution
```

The engine fails closed when:

- any monetary input is negative or not an integer number of halalas;
- a rate is outside 0–100%;
- a stable line identifier is duplicated;
- payable days are invalid;
- registered social insurance is incomplete or unverified;
- net pay would be negative;
- a referenced attendance, leave, adjustment, or advance input is outside the tenant/month/employee scope.

The engine does not silently clamp negative net pay to zero.

## Manual adjustments

Each adjustment contains a UUID, type (`bonus` or `deduction`), amount, reason, actor, and timestamp. Adjustments are append/remove commands with idempotency keys and optimistic run version checks. They may only modify a draft run. Recalculation preserves the current adjustment list and reruns the complete formula.

## State machine and immutability

```text
draft -> approved -> paid
  |          |
  +-> void <-+
```

- Draft: calculation and adjustments are allowed.
- Approved: all payslip inputs/results are frozen; accounting accrual may be posted.
- Paid: requires approved payroll and a successfully posted, balanced payment workflow.
- Void: terminal for the run version; correction requires a new version/reversal workflow.
- Backward status edits and browser table mutations are prohibited.

Each successful command records the actor, request/idempotency key, formula version, input snapshot, output snapshot, hashes, timestamps, and run version. Approval emits a durable business event/outbox record. Accounting consumes the immutable approved snapshot and uses the payroll run UUID as its source identifier.

## Required golden tests

- full-month salary without insurance;
- partial-month proration including a rounding boundary;
- verified insurance below and above the configured cap;
- allowances, recurring deductions, attendance deductions, manual adjustments, and advance installments;
- zero values;
- invalid payable days;
- incomplete registered-insurance configuration;
- negative net pay;
- idempotent command replay and conflicting key reuse;
- concurrent adjustment/version conflict;
- approved and paid immutability;
- cross-tenant and direct-browser mutation denial;
- payroll totals reconcile exactly to the posted accounting journal.
