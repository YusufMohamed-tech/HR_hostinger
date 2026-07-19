export const PAYROLL_FORMULA_VERSION = "sa-payroll-v1" as const;

export type PayrollMoneyLine = {
  code: string;
  label: string;
  amountHalalas: number;
  prorate: boolean;
};

export type PayrollManualAdjustment = {
  id: string;
  type: "bonus" | "deduction";
  amountHalalas: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type PayrollInsuranceInput =
  | { registered: false }
  | {
      registered: true;
      verified: boolean;
      schemeCode: string;
      contributoryWageHalalas: number;
      maximumContributoryWageHalalas: number;
      employeeRateBasisPoints: number;
      employerRateBasisPoints: number;
    };

export type PayrollFormulaInput = {
  month: string;
  calendarDays: number;
  payableDays: number;
  monthlyBaseSalaryHalalas: number;
  allowances: PayrollMoneyLine[];
  recurringDeductions: PayrollMoneyLine[];
  lateDeductionHalalas: number;
  absenceDeductionHalalas: number;
  advanceDeductionHalalas: number;
  otherDeductionHalalas: number;
  manualAdjustments: PayrollManualAdjustment[];
  insurance: PayrollInsuranceInput;
};

export type CalculatedPayrollLine = PayrollMoneyLine & {
  calculatedAmountHalalas: number;
};

export type PayrollFormulaResult = {
  formulaVersion: typeof PAYROLL_FORMULA_VERSION;
  earnedBaseSalaryHalalas: number;
  allowanceLines: CalculatedPayrollLine[];
  recurringDeductionLines: CalculatedPayrollLine[];
  manualBonusHalalas: number;
  manualDeductionHalalas: number;
  totalAllowancesHalalas: number;
  employeeInsuranceHalalas: number;
  employerInsuranceHalalas: number;
  totalDeductionsHalalas: number;
  grossEarningsHalalas: number;
  netPayHalalas: number;
  totalEmployerCostHalalas: number;
};

function assertSafeInteger(value: number, field: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function requiredText(value: string, field: string) {
  if (!value.trim()) throw new TypeError(`${field} is required.`);
}

function assertUniqueCodes(lines: PayrollMoneyLine[], field: string) {
  const codes = new Set<string>();
  for (const line of lines) {
    requiredText(line.code, `${field}.code`);
    requiredText(line.label, `${field}.label`);
    assertSafeInteger(line.amountHalalas, `${field}.${line.code}.amountHalalas`);
    if (codes.has(line.code)) throw new TypeError(`${field} contains duplicate code ${line.code}.`);
    codes.add(line.code);
  }
}

export function roundDivideHalfUp(numerator: number, denominator: number) {
  assertSafeInteger(numerator, "numerator");
  assertSafeInteger(denominator, "denominator", 1);
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  return quotient + (remainder * 2 >= denominator ? 1 : 0);
}

export function prorateHalalas(amountHalalas: number, payableDays: number, calendarDays: number) {
  assertSafeInteger(amountHalalas, "amountHalalas");
  assertSafeInteger(payableDays, "payableDays");
  assertSafeInteger(calendarDays, "calendarDays", 1);
  if (payableDays > calendarDays) throw new RangeError("payableDays cannot exceed calendarDays.");
  const numerator = amountHalalas * payableDays;
  if (!Number.isSafeInteger(numerator)) throw new RangeError("Proration exceeds the supported money range.");
  return roundDivideHalfUp(numerator, calendarDays);
}

export function percentageOfHalalas(amountHalalas: number, rateBasisPoints: number) {
  assertSafeInteger(amountHalalas, "amountHalalas");
  assertSafeInteger(rateBasisPoints, "rateBasisPoints");
  if (rateBasisPoints > 10_000) throw new RangeError("rateBasisPoints cannot exceed 10000.");
  const numerator = amountHalalas * rateBasisPoints;
  if (!Number.isSafeInteger(numerator)) throw new RangeError("Percentage calculation exceeds the supported money range.");
  return roundDivideHalfUp(numerator, 10_000);
}

function sumSafe(values: number[], field: string) {
  let total = 0;
  for (const value of values) {
    assertSafeInteger(value, field);
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError(`${field} exceeds the supported money range.`);
  }
  return total;
}

function calculateLines(lines: PayrollMoneyLine[], payableDays: number, calendarDays: number) {
  return lines.map((line) => ({
    ...line,
    calculatedAmountHalalas: line.prorate
      ? prorateHalalas(line.amountHalalas, payableDays, calendarDays)
      : line.amountHalalas,
  }));
}

function validateInput(input: PayrollFormulaInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.month)) {
    throw new TypeError("month must be an ISO first-of-month date.");
  }
  assertSafeInteger(input.calendarDays, "calendarDays", 1);
  if (input.calendarDays > 31) throw new RangeError("calendarDays cannot exceed 31.");
  assertSafeInteger(input.payableDays, "payableDays");
  if (input.payableDays > input.calendarDays) throw new RangeError("payableDays cannot exceed calendarDays.");
  assertSafeInteger(input.monthlyBaseSalaryHalalas, "monthlyBaseSalaryHalalas");
  assertSafeInteger(input.lateDeductionHalalas, "lateDeductionHalalas");
  assertSafeInteger(input.absenceDeductionHalalas, "absenceDeductionHalalas");
  assertSafeInteger(input.advanceDeductionHalalas, "advanceDeductionHalalas");
  assertSafeInteger(input.otherDeductionHalalas, "otherDeductionHalalas");
  assertUniqueCodes(input.allowances, "allowances");
  assertUniqueCodes(input.recurringDeductions, "recurringDeductions");

  const adjustmentIds = new Set<string>();
  for (const adjustment of input.manualAdjustments) {
    requiredText(adjustment.id, "manualAdjustments.id");
    requiredText(adjustment.reason, "manualAdjustments.reason");
    requiredText(adjustment.createdBy, "manualAdjustments.createdBy");
    requiredText(adjustment.createdAt, "manualAdjustments.createdAt");
    assertSafeInteger(adjustment.amountHalalas, `manualAdjustments.${adjustment.id}.amountHalalas`, 1);
    if (adjustmentIds.has(adjustment.id)) throw new TypeError(`Duplicate manual adjustment ${adjustment.id}.`);
    adjustmentIds.add(adjustment.id);
  }

  if (input.insurance.registered) {
    if (!input.insurance.verified) throw new TypeError("Registered social insurance must be verified.");
    requiredText(input.insurance.schemeCode, "insurance.schemeCode");
    assertSafeInteger(input.insurance.contributoryWageHalalas, "insurance.contributoryWageHalalas");
    assertSafeInteger(input.insurance.maximumContributoryWageHalalas, "insurance.maximumContributoryWageHalalas", 1);
    assertSafeInteger(input.insurance.employeeRateBasisPoints, "insurance.employeeRateBasisPoints");
    assertSafeInteger(input.insurance.employerRateBasisPoints, "insurance.employerRateBasisPoints");
    if (input.insurance.employeeRateBasisPoints > 10_000 || input.insurance.employerRateBasisPoints > 10_000) {
      throw new RangeError("Insurance rates cannot exceed 10000 basis points.");
    }
  }
}

export function calculatePayroll(input: PayrollFormulaInput): PayrollFormulaResult {
  validateInput(input);

  const earnedBaseSalaryHalalas = prorateHalalas(
    input.monthlyBaseSalaryHalalas,
    input.payableDays,
    input.calendarDays
  );
  const allowanceLines = calculateLines(input.allowances, input.payableDays, input.calendarDays);
  const recurringDeductionLines = calculateLines(input.recurringDeductions, input.payableDays, input.calendarDays);
  const manualBonusHalalas = sumSafe(
    input.manualAdjustments.filter((item) => item.type === "bonus").map((item) => item.amountHalalas),
    "manualBonusHalalas"
  );
  const manualDeductionHalalas = sumSafe(
    input.manualAdjustments.filter((item) => item.type === "deduction").map((item) => item.amountHalalas),
    "manualDeductionHalalas"
  );
  const totalAllowancesHalalas = sumSafe(
    [...allowanceLines.map((line) => line.calculatedAmountHalalas), manualBonusHalalas],
    "totalAllowancesHalalas"
  );

  let employeeInsuranceHalalas = 0;
  let employerInsuranceHalalas = 0;
  if (input.insurance.registered) {
    const insuredBase = Math.min(
      input.insurance.contributoryWageHalalas,
      input.insurance.maximumContributoryWageHalalas
    );
    employeeInsuranceHalalas = percentageOfHalalas(insuredBase, input.insurance.employeeRateBasisPoints);
    employerInsuranceHalalas = percentageOfHalalas(insuredBase, input.insurance.employerRateBasisPoints);
  }

  const totalDeductionsHalalas = sumSafe(
    [
      ...recurringDeductionLines.map((line) => line.calculatedAmountHalalas),
      input.lateDeductionHalalas,
      input.absenceDeductionHalalas,
      input.advanceDeductionHalalas,
      input.otherDeductionHalalas,
      manualDeductionHalalas,
      employeeInsuranceHalalas,
    ],
    "totalDeductionsHalalas"
  );
  const grossEarningsHalalas = sumSafe(
    [earnedBaseSalaryHalalas, totalAllowancesHalalas],
    "grossEarningsHalalas"
  );
  const netPayHalalas = grossEarningsHalalas - totalDeductionsHalalas;
  if (netPayHalalas < 0) throw new RangeError("Payroll deductions exceed gross earnings.");
  const totalEmployerCostHalalas = sumSafe(
    [grossEarningsHalalas, employerInsuranceHalalas],
    "totalEmployerCostHalalas"
  );

  return {
    formulaVersion: PAYROLL_FORMULA_VERSION,
    earnedBaseSalaryHalalas,
    allowanceLines,
    recurringDeductionLines,
    manualBonusHalalas,
    manualDeductionHalalas,
    totalAllowancesHalalas,
    employeeInsuranceHalalas,
    employerInsuranceHalalas,
    totalDeductionsHalalas,
    grossEarningsHalalas,
    netPayHalalas,
    totalEmployerCostHalalas,
  };
}

export function moneyToHalalas(value: number | string | null | undefined, field = "money") {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${field} must be a non-negative finite amount.`);
    const result = Math.round(value * 100);
    assertSafeInteger(result, field);
    return result;
  }
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new TypeError(`${field} must be a non-negative decimal amount.`);
  const [whole, fraction = ""] = normalized.split(".");
  const significantRemainder = fraction.slice(2).replace(/0/g, "");
  if (significantRemainder) throw new RangeError(`${field} has precision smaller than one halala.`);
  const result = Number(whole) * 100 + Number((fraction.slice(0, 2) + "00").slice(0, 2));
  assertSafeInteger(result, field);
  return result;
}

export function halalasToMoney(value: number) {
  assertSafeInteger(value, "halalas");
  return value / 100;
}
