type ApiResult<T> = { data: T | null; error: string | null };

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      cache: options?.method ? undefined : "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: String(payload?.message || "تعذر تنفيذ العملية.") };
    return { data: (payload?.data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

export interface BankAccount {
  id: string;
  name_ar: string;
  name_en: string | null;
  bank_name: string;
  account_number: string;
  iban: string | null;
  swift_code: string | null;
  currency: string;
  linked_account_id: string | null;
  linked_account?: { id: string; code: string; name_ar: string } | null;
  opening_balance: number;
  opening_balance_date: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BankStatement {
  id: string;
  bank_account_id: string;
  bank_account?: { id: string; name_ar: string; bank_name: string; account_number?: string } | null;
  statement_date: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
  file_name: string | null;
  import_format: string;
  status: "imported" | "in_progress" | "reconciled" | "cancelled";
  transaction_count: number;
  matched_count: number;
  imported_at: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
  recalled_at: string | null;
  recalled_by: string | null;
  recall_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  has_line_activity: boolean;
}

export type BankStatementEditValues = Pick<BankStatement,
  "bank_account_id" | "statement_date" | "period_start" | "period_end" |
  "opening_balance" | "closing_balance" | "file_name"
>;

export interface StatementLine {
  id: string;
  statement_id: string;
  transaction_date: string;
  value_date: string | null;
  description: string;
  reference: string | null;
  amount: number;
  running_balance: number | null;
  transaction_type: string | null;
  payee: string | null;
  match_status: "unmatched" | "matched" | "manually_matched" | "excluded";
  matched_journal_line_id: string | null;
  match_confidence: number | null;
  notes: string | null;
}

export interface BankReconciliation {
  id: string;
  bank_account_id: string;
  bank_account?: { id: string; name_ar: string; bank_name: string } | null;
  statement_id: string | null;
  reconciliation_date: string;
  statement_balance: number;
  ledger_balance: number;
  difference: number;
  status: "draft" | "completed" | "approved";
  completed_at: string | null;
  approved_at: string | null;
  notes: string | null;
}

// Bank Accounts
export function getBankAccounts() {
  return apiFetch<BankAccount[]>("/api/banking/accounts");
}

export function getBankAccount(id: string) {
  return apiFetch<BankAccount>(`/api/banking/accounts/${id}`);
}

export function saveBankAccount(values: Record<string, unknown>, id?: string) {
  return apiFetch<BankAccount>(`/api/banking/accounts${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function deactivateBankAccount(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/accounts/${id}/deactivate`, { method: "POST", body: "{}" });
}

// Statements
export function getBankStatements(bankAccountId?: string) {
  const params = bankAccountId ? `?bank_account_id=${bankAccountId}` : "";
  return apiFetch<BankStatement[]>(`/api/banking/statements${params}`);
}

export function getBankStatement(id: string) {
  return apiFetch<BankStatement>(`/api/banking/statements/${id}`);
}

export function getStatementLines(statementId: string) {
  return apiFetch<StatementLine[]>(`/api/banking/statements/${statementId}/lines`);
}

export function importStatement(values: { bank_account_id: string; statement_date: string; period_start: string; period_end: string; opening_balance: number; closing_balance: number; lines: Array<Record<string, unknown>>; file_name?: string; import_format?: string }) {
  return apiFetch<BankStatement>("/api/banking/statements/import", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function updateBankStatement(
  id: string,
  expectedVersion: number,
  values: BankStatementEditValues,
  commandId = crypto.randomUUID(),
) {
  return apiFetch<BankStatement>(`/api/banking/statements/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...values, expected_version: expectedVersion, command_id: commandId }),
  });
}

export function recallBankStatement(
  id: string,
  expectedVersion: number,
  reason: string,
  commandId = crypto.randomUUID(),
) {
  return apiFetch<BankStatement>(`/api/banking/statements/${id}/recall`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, reason, command_id: commandId }),
  });
}

export function cancelBankStatement(
  id: string,
  expectedVersion: number,
  reason: string,
  commandId = crypto.randomUUID(),
) {
  return apiFetch<BankStatement>(`/api/banking/statements/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ expected_version: expectedVersion, reason, command_id: commandId }),
  });
}

export function autoMatchStatement(statementId: string) {
  return apiFetch<{ matched: number; unmatched: number }>(`/api/banking/statements/${statementId}/auto-match`, {
    method: "POST",
    body: "{}",
  });
}

export function matchLine(statementId: string, lineId: string, journalLineId: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/statements/${statementId}/match`, {
    method: "POST",
    body: JSON.stringify({ line_id: lineId, journal_line_id: journalLineId }),
  });
}

export function unmatchLine(statementId: string, lineId: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/statements/${statementId}/unmatch`, {
    method: "POST",
    body: JSON.stringify({ line_id: lineId }),
  });
}

export function excludeLine(statementId: string, lineId: string, notes?: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/statements/${statementId}/exclude`, {
    method: "POST",
    body: JSON.stringify({ line_id: lineId, notes }),
  });
}

export function getMatchSuggestions(lineId: string) {
  return apiFetch<Array<Record<string, unknown>>>(`/api/banking/match-suggestions?line_id=${lineId}`);
}

// Reconciliations
export function getReconciliations() {
  return apiFetch<BankReconciliation[]>("/api/banking/reconciliations");
}

export function getReconciliation(id: string) {
  return apiFetch<BankReconciliation>(`/api/banking/reconciliations/${id}`);
}

export function saveReconciliation(values: Record<string, unknown>, id?: string) {
  return apiFetch<BankReconciliation>(`/api/banking/reconciliations${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function completeReconciliation(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/reconciliations/${id}/complete`, { method: "POST", body: "{}" });
}

export function approveReconciliation(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/banking/reconciliations/${id}/approve`, { method: "POST", body: "{}" });
}
