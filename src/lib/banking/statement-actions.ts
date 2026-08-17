export type BankStatementLifecycleStatus = "imported" | "in_progress" | "approved" | "archived" | "reconciled" | "cancelled";

export type BankStatementEditInput = {
  bank_account_id: string;
  statement_date: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
  file_name: string | null;
};

type StatementActionSummary = {
  status: BankStatementLifecycleStatus;
  matched_count: number;
  has_line_activity?: boolean;
  recalled_at?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeBankStatementEditInput(input: unknown):
  | { ok: true; value: BankStatementEditInput }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "بيانات كشف الحساب غير صالحة." };
  }
  const source = input as Record<string, unknown>;
  const bankAccountId = typeof source.bank_account_id === "string" ? source.bank_account_id.trim() : "";
  const statementDate = typeof source.statement_date === "string" ? source.statement_date.trim() : "";
  const periodStart = typeof source.period_start === "string" ? source.period_start.trim() : "";
  const periodEnd = typeof source.period_end === "string" ? source.period_end.trim() : "";
  const openingBalance = finiteNumber(source.opening_balance);
  const closingBalance = finiteNumber(source.closing_balance);
  const fileName = typeof source.file_name === "string" ? source.file_name.trim() : "";

  if (!UUID_PATTERN.test(bankAccountId)) {
    return { ok: false, error: "اختر حسابًا بنكيًا صالحًا." };
  }
  if (![statementDate, periodStart, periodEnd].every(isCalendarDate)) {
    return { ok: false, error: "أدخل تاريخ الكشف وبداية ونهاية الفترة بشكل صحيح." };
  }
  if (periodStart > periodEnd || statementDate < periodStart || statementDate > periodEnd) {
    return { ok: false, error: "يجب أن يقع تاريخ الكشف داخل فترة صحيحة." };
  }
  if (openingBalance === null || closingBalance === null) {
    return { ok: false, error: "أدخل أرصدة افتتاحية وختامية رقمية صحيحة." };
  }
  if (fileName.length > 255) {
    return { ok: false, error: "اسم الملف أطول من الحد المسموح." };
  }

  return {
    ok: true,
    value: {
      bank_account_id: bankAccountId,
      statement_date: statementDate,
      period_start: periodStart,
      period_end: periodEnd,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      file_name: fileName || null,
    },
  };
}

export function normalizeBankStatementReason(value: unknown, required: boolean):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  const reason = typeof value === "string" ? value.trim() : "";
  if (required && !reason) return { ok: false, error: "سبب الاسترجاع مطلوب." };
  if (reason.length > 1000) return { ok: false, error: "السبب أطول من الحد المسموح." };
  return { ok: true, value: reason || null };
}

export function getBankStatementActionCapabilities(statement: StatementActionSummary, role: string | null | undefined) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const canManage = normalizedRole === "finance_manager" || normalizedRole === "accountant";
  const canRecall = normalizedRole === "finance_manager";
  const hasActivity = statement.has_line_activity === true || Number(statement.matched_count) > 0;
  return {
    canEdit: canManage && statement.status === "imported" && !hasActivity,
    canSubmit: canManage && statement.status === "imported",
    canRecall: canRecall && statement.status === "in_progress",
    canCancel: canManage && statement.status === "imported" && !hasActivity,
  };
}
