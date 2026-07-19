import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePayroll,
  moneyToHalalas,
  percentageOfHalalas,
  prorateHalalas,
  type PayrollFormulaInput,
} from "../src/lib/payroll/engine";

function baseInput(overrides: Partial<PayrollFormulaInput> = {}): PayrollFormulaInput {
  return {
    month: "2026-07-01",
    calendarDays: 31,
    payableDays: 31,
    monthlyBaseSalaryHalalas: 1_000_000,
    allowances: [],
    recurringDeductions: [],
    lateDeductionHalalas: 0,
    absenceDeductionHalalas: 0,
    advanceDeductionHalalas: 0,
    otherDeductionHalalas: 0,
    manualAdjustments: [],
    insurance: { registered: false },
    ...overrides,
  };
}

test("calculates a full-month salary without social insurance", () => {
  const result = calculatePayroll(baseInput());
  assert.equal(result.earnedBaseSalaryHalalas, 1_000_000);
  assert.equal(result.totalDeductionsHalalas, 0);
  assert.equal(result.netPayHalalas, 1_000_000);
  assert.equal(result.totalEmployerCostHalalas, 1_000_000);
});

test("proration and percentage calculations round half up", () => {
  assert.equal(prorateHalalas(101, 1, 2), 51);
  assert.equal(percentageOfHalalas(100, 50), 1);
  const result = calculatePayroll(baseInput({
    calendarDays: 31,
    payableDays: 15,
    monthlyBaseSalaryHalalas: 1_000_001,
    allowances: [{ code: "housing", label: "Housing", amountHalalas: 100_001, prorate: true }],
  }));
  assert.equal(result.earnedBaseSalaryHalalas, 483_871);
  assert.equal(result.allowanceLines[0]?.calculatedAmountHalalas, 48_388);
});

test("uses explicit verified insurance rates and applies the configured cap", () => {
  const result = calculatePayroll(baseInput({
    monthlyBaseSalaryHalalas: 5_000_000,
    insurance: {
      registered: true,
      verified: true,
      schemeCode: "configured-legacy-example",
      contributoryWageHalalas: 5_000_000,
      maximumContributoryWageHalalas: 4_500_000,
      employeeRateBasisPoints: 975,
      employerRateBasisPoints: 1_175,
    },
  }));
  assert.equal(result.employeeInsuranceHalalas, 438_750);
  assert.equal(result.employerInsuranceHalalas, 528_750);
  assert.equal(result.netPayHalalas, 4_561_250);
  assert.equal(result.totalEmployerCostHalalas, 5_528_750);
});

test("includes allowances, recurring, attendance, advance, and manual adjustments exactly once", () => {
  const result = calculatePayroll(baseInput({
    allowances: [{ code: "fixed", label: "Fixed", amountHalalas: 100_000, prorate: false }],
    recurringDeductions: [{ code: "recurring", label: "Recurring", amountHalalas: 25_000, prorate: false }],
    lateDeductionHalalas: 1_000,
    absenceDeductionHalalas: 2_000,
    advanceDeductionHalalas: 10_000,
    otherDeductionHalalas: 3_000,
    manualAdjustments: [
      { id: "bonus-1", type: "bonus", amountHalalas: 5_000, reason: "Approved bonus", createdBy: "user-1", createdAt: "2026-07-31T10:00:00Z" },
      { id: "deduction-1", type: "deduction", amountHalalas: 4_000, reason: "Approved deduction", createdBy: "user-1", createdAt: "2026-07-31T10:01:00Z" },
    ],
  }));
  assert.equal(result.totalAllowancesHalalas, 105_000);
  assert.equal(result.totalDeductionsHalalas, 45_000);
  assert.equal(result.netPayHalalas, 1_060_000);
});

test("fails closed for unverified registered insurance and negative net pay", () => {
  assert.throws(() => calculatePayroll(baseInput({
    insurance: {
      registered: true,
      verified: false,
      schemeCode: "unknown",
      contributoryWageHalalas: 1_000_000,
      maximumContributoryWageHalalas: 4_500_000,
      employeeRateBasisPoints: 975,
      employerRateBasisPoints: 1_175,
    },
  })), /must be verified/);
  assert.throws(() => calculatePayroll(baseInput({ otherDeductionHalalas: 1_000_001 })), /exceed gross earnings/);
});

test("parses database money without losing halala precision", () => {
  assert.equal(moneyToHalalas("1234.50"), 123_450);
  assert.equal(moneyToHalalas("1234.5000"), 123_450);
  assert.throws(() => moneyToHalalas("1.001"), /precision/);
});
