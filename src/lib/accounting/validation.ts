export type JournalLineInput = {
  account_id: string;
  debit?: number | string | null;
  credit?: number | string | null;
  description?: string | null;
  cost_center_id?: string | null;
  employee_id?: string | null;
  department_id?: string | null;
  location_id?: string | null;
};

export function roundMoney(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function calculateLineAmount(line: JournalLineInput) {
  return {
    debit: roundMoney(line.debit),
    credit: roundMoney(line.credit),
  };
}

export function validateJournalLines(lines: JournalLineInput[]) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { valid: false as const, message: "يجب إضافة سطرين على الأقل للقيد المحاسبي." };
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const accountId = String(line.account_id || "").trim();
    const { debit, credit } = calculateLineAmount(line);
    if (!accountId) return { valid: false as const, message: "كل سطر يجب أن يحتوي على حساب." };
    if (debit < 0 || credit < 0) return { valid: false as const, message: "لا يمكن إدخال مبالغ سالبة." };
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      return { valid: false as const, message: "كل سطر يجب أن يحتوي على مدين أو دائن فقط." };
    }
    totalDebit += debit;
    totalCredit += credit;
  }

  totalDebit = roundMoney(totalDebit);
  totalCredit = roundMoney(totalCredit);
  if (totalDebit !== totalCredit) {
    return { valid: false as const, message: "إجمالي المدين يجب أن يساوي إجمالي الدائن.", totalDebit, totalCredit };
  }

  return { valid: true as const, totalDebit, totalCredit };
}

export function parseDate(value: unknown, fallback = new Date()) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return fallback.toISOString().slice(0, 10);
}

export function requireText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}
