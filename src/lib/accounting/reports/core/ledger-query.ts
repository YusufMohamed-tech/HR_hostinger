import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export interface LedgerQueryOptions {
  orgId: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  accountIds?: string[];
  accountTypes?: string[];
  costCenterIds?: string[];
  departmentIds?: string[];
  employeeIds?: string[];
  sourceModules?: string[];
}

export interface LedgerLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  cost_center_id: string | null;
  employee_id: string | null;
  department_id: string | null;
  account: {
    id: string;
    code: string;
    name_ar: string;
    name_en: string | null;
    type: string;
    subtype: string | null;
    normal_balance: string;
    cash_flow_category: string | null;
  };
  entry: {
    id: string;
    entry_no: string;
    entry_date: string;
    description: string;
    status: string;
    source_module: string;
    source_id: string | null;
  };
}

export async function queryLedger(admin: AdminClient, options: LedgerQueryOptions): Promise<LedgerLine[]> {
  const { data, error } = await db(admin)
    .from("accounting_journal_lines")
    .select("*, account:account_id(id, code, name_ar, name_en, type, subtype, normal_balance, cash_flow_category), entry:journal_entry_id(id, entry_no, entry_date, description, status, source_module, source_id, legal_entity_id)")
    .eq("organization_id", options.orgId);

  if (error) throw new Error(error.message);

  return ((data || []) as Record<string, unknown>[]).filter((line) => {
    const entry = line.entry as Record<string, unknown> | null;
    if (!entry) return false;
    if (!["posted", "reversed"].includes(String(entry.status))) return false;
    if (options.entityId && String(entry.legal_entity_id || "") !== options.entityId) return false;

    const entryDate = String(entry.entry_date);
    if (options.dateFrom && entryDate < options.dateFrom) return false;
    if (options.dateTo && entryDate > options.dateTo) return false;

    if (options.accountIds?.length && !options.accountIds.includes(String(line.account_id))) return false;
    if (options.costCenterIds?.length && !options.costCenterIds.includes(String(line.cost_center_id || ""))) return false;
    if (options.departmentIds?.length && !options.departmentIds.includes(String(line.department_id || ""))) return false;
    if (options.employeeIds?.length && !options.employeeIds.includes(String(line.employee_id || ""))) return false;
    if (options.sourceModules?.length && !options.sourceModules.includes(String(entry.source_module))) return false;

    const account = line.account as Record<string, unknown> | null;
    if (options.accountTypes?.length && account && !options.accountTypes.includes(String(account.type))) return false;

    return true;
  }) as unknown as LedgerLine[];
}

export interface AccountBalance {
  account_id: string;
  account_code: string;
  account_name_ar: string;
  account_name_en: string | null;
  account_type: string;
  account_subtype: string | null;
  normal_balance: string;
  cash_flow_category: string | null;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export function aggregateByAccount(lines: LedgerLine[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();

  for (const line of lines) {
    const account = line.account;
    const existing = map.get(account.id) || {
      account_id: account.id,
      account_code: account.code,
      account_name_ar: account.name_ar,
      account_name_en: account.name_en,
      account_type: account.type,
      account_subtype: account.subtype,
      normal_balance: account.normal_balance,
      cash_flow_category: account.cash_flow_category,
      total_debit: 0,
      total_credit: 0,
      balance: 0,
    };

    existing.total_debit = roundMoney(existing.total_debit + Number(line.debit || 0));
    existing.total_credit = roundMoney(existing.total_credit + Number(line.credit || 0));
    existing.balance = existing.normal_balance === "credit"
      ? roundMoney(existing.total_credit - existing.total_debit)
      : roundMoney(existing.total_debit - existing.total_credit);

    map.set(account.id, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export interface MonthlyMovement {
  period: string;
  total_debit: number;
  total_credit: number;
  net_movement: number;
}

export function aggregateByMonth(lines: LedgerLine[]): MonthlyMovement[] {
  const map = new Map<string, MonthlyMovement>();

  for (const line of lines) {
    const period = String(line.entry.entry_date).slice(0, 7);
    const existing = map.get(period) || { period, total_debit: 0, total_credit: 0, net_movement: 0 };
    existing.total_debit = roundMoney(existing.total_debit + Number(line.debit || 0));
    existing.total_credit = roundMoney(existing.total_credit + Number(line.credit || 0));
    existing.net_movement = roundMoney(existing.total_debit - existing.total_credit);
    map.set(period, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export interface CostCenterBalance {
  cost_center_id: string;
  total_debit: number;
  total_credit: number;
  net: number;
}

export function aggregateByCostCenter(lines: LedgerLine[]): CostCenterBalance[] {
  const map = new Map<string, CostCenterBalance>();

  for (const line of lines) {
    const ccId = line.cost_center_id || "unassigned";
    const existing = map.get(ccId) || { cost_center_id: ccId, total_debit: 0, total_credit: 0, net: 0 };
    existing.total_debit = roundMoney(existing.total_debit + Number(line.debit || 0));
    existing.total_credit = roundMoney(existing.total_credit + Number(line.credit || 0));
    existing.net = roundMoney(existing.total_debit - existing.total_credit);
    map.set(ccId, existing);
  }

  return Array.from(map.values());
}
