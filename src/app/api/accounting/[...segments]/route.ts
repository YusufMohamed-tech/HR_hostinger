import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAccountingAccess, type AccountingAction } from "@/lib/accounting/permissions";
import { createJournalEntry, getAccountingSettings, initializeAccountingDefaults, postJournalEntry, reverseJournalEntry, updateDraftJournalEntry } from "@/lib/accounting/posting";
import {
  getLegalEntities, getLegalEntity, saveLegalEntity, changeLegalEntityStatus,
  getBranches, saveBranch, deactivateBranch,
  getBooks, saveBook,
  getUserScopes, saveUserScope, revokeUserScope,
  getCurrencies, saveCurrency,
  getExchangeRates, saveExchangeRate, approveExchangeRate,
  getFiscalCalendars, saveFiscalCalendar,
} from "@/lib/server/accounting/entities";
import { getUserAllowedEntities, ensureDefaultEntity } from "@/lib/server/accounting/context";
import {
  getAccountingDashboard,
  getBalanceSheet,
  getEmployeeAdvancesReport,
  getGeneralLedger,
  getPayrollCostReport,
  getProfitLoss,
  getTrialBalance,
  getVatReport,
} from "@/lib/accounting/reports";
import {
  getCashFlowStatement,
  getComparativeProfitLoss,
  getComparativeBalanceSheet,
  getKPIDashboard,
  getCostCenterPnL,
  getBudgetVariance,
  getCashPosition,
  getRevenueAnalysis,
  getExpenseAnalysis,
  getPayrollSummary,
  getARAgingReport,
  getAPAgingReport,
} from "@/lib/accounting/reports/index";
import { reportToCSV } from "@/lib/accounting/reports/export/csv";
import { parseDate, requireText, roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

type RouteContext = { params: Promise<{ segments?: string[] }> };

function db(admin: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function message(error: unknown, status = 500) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const resolvedStatus = status !== 500 ? status
    : code === "42501" ? 403
      : code === "P0002" ? 404
        : ["23505", "40001", "55000"].includes(code) ? 409
          : ["22023", "23514"].includes(code) ? 400 : 500;
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "حدث خطأ غير متوقع.") },
    { status: resolvedStatus }
  );
}

async function segments(context: RouteContext) {
  return (await context.params).segments || [];
}

function getQueryDates(request: NextRequest) {
  return {
    dateFrom: request.nextUrl.searchParams.get("date_from") || undefined,
    dateTo: request.nextUrl.searchParams.get("date_to") || undefined,
    asOf: request.nextUrl.searchParams.get("as_of") || undefined,
  };
}

function uuidOrNull(value: unknown) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function accountingCommandContext(request: NextRequest, body: Record<string, unknown>) {
  return {
    commandId: uuidOrNull(body.command_id) || uuidOrNull(request.headers.get("idempotency-key")) || randomUUID(),
    requestId: uuidOrNull(body.request_id) || uuidOrNull(request.headers.get("x-request-id")) || randomUUID(),
  };
}

async function accountingRpcRecord(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await db(admin).rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error(`Accounting command ${name} returned no record.`);
  return row as Record<string, unknown>;
}

function budgetCommandPayload(body: Record<string, unknown>, current?: Record<string, unknown>) {
  const lines = Array.isArray(body.lines)
    ? (body.lines as Record<string, unknown>[]).map((line) => ({
        accountId: line.account_id,
        costCenterId: line.cost_center_id || null,
        month: Number(line.month || 0),
        amount: Number(line.amount || 0),
        notes: requireText(line.notes) || null,
      }))
    : Array.isArray(current?.lines)
      ? (current.lines as Record<string, unknown>[]).map((line) => ({
          accountId: line.account_id,
          costCenterId: line.cost_center_id || null,
          month: Number(line.month || 0),
          amount: Number(line.amount || 0),
          notes: requireText(line.notes) || null,
        }))
      : [];
  return {
    name: requireText(body.name, String(current?.name || "")),
    fiscalYear: Number(body.fiscal_year ?? current?.fiscal_year ?? 0),
    lines,
  };
}

function customerCommandPayload(body: Record<string, unknown>, current?: Record<string, unknown>) {
  return {
    name_ar: requireText(body.name_ar, String(current?.name_ar || "")),
    name_en: body.name_en === undefined ? current?.name_en ?? null : requireText(body.name_en) || null,
    vat_number: body.vat_number === undefined ? current?.vat_number ?? null : requireText(body.vat_number) || null,
    commercial_registration: body.commercial_registration === undefined
      ? current?.commercial_registration ?? null
      : requireText(body.commercial_registration) || null,
    phone: body.phone === undefined ? current?.phone ?? null : requireText(body.phone) || null,
    email: body.email === undefined ? current?.email ?? null : requireText(body.email) || null,
    address: body.address === undefined ? current?.address ?? null : requireText(body.address) || null,
    city: body.city === undefined ? current?.city ?? null : requireText(body.city) || null,
    country: body.country === undefined ? current?.country ?? "Saudi Arabia" : requireText(body.country, "Saudi Arabia"),
    payment_terms: body.payment_terms === undefined ? current?.payment_terms ?? null : requireText(body.payment_terms) || null,
    sales_company_id: body.sales_company_id === undefined ? current?.sales_company_id ?? null : body.sales_company_id || null,
    is_active: body.is_active === undefined ? current?.is_active ?? true : Boolean(body.is_active),
  };
}

function invoiceCommandPayload(body: Record<string, unknown>, current?: Record<string, unknown>) {
  return {
    customerId: body.customer_id ?? current?.customer_id ?? null,
    invoiceDate: parseDate(body.invoice_date ?? current?.invoice_date),
    dueDate: body.due_date === undefined ? current?.due_date ?? null : body.due_date || null,
    sourceModule: requireText(body.source_module, String(current?.source_module || "manual")),
    sourceId: body.source_id === undefined ? current?.source_id ?? null : body.source_id || null,
    notes: body.notes === undefined ? current?.notes ?? null : requireText(body.notes) || null,
    lines: Array.isArray(body.lines) ? body.lines : Array.isArray(current?.lines) ? current.lines : [],
  };
}

function expenseCommandPayload(body: Record<string, unknown>, current?: Record<string, unknown>) {
  return {
    vendorId: body.vendor_id ?? current?.vendor_id ?? null,
    employeeId: body.employee_id ?? current?.employee_id ?? null,
    expenseDate: parseDate(body.expense_date ?? current?.expense_date),
    categoryAccountId: body.category_account_id ?? current?.category_account_id ?? null,
    paymentAccountId: body.payment_account_id ?? current?.payment_account_id ?? null,
    costCenterId: body.cost_center_id ?? current?.cost_center_id ?? null,
    description: requireText(body.description, String(current?.description || "")),
    amountBeforeVat: body.amount_before_vat ?? current?.amount_before_vat ?? 0,
    vatAmount: body.vat_amount ?? current?.vat_amount ?? 0,
    status: body.status === "pending_approval" || current?.status === "pending_approval" ? "pending_approval" : "draft",
    paymentMethod: body.payment_method === undefined ? current?.payment_method ?? null : requireText(body.payment_method) || null,
    attachmentUrl: body.attachment_url === undefined ? current?.attachment_url ?? null : requireText(body.attachment_url) || null,
  };
}

function paymentCommandPayload(body: Record<string, unknown>, current?: Record<string, unknown>) {
  return {
    paymentDate: parseDate(body.payment_date ?? current?.payment_date),
    type: requireText(body.type, String(current?.type || "manual")),
    direction: requireText(body.direction, String(current?.direction || "outbound")),
    amount: body.amount ?? current?.amount ?? 0,
    accountId: body.account_id ?? current?.account_id ?? null,
    counterpartAccountId: body.counterpart_account_id ?? current?.counterpart_account_id ?? null,
    costCenterId: body.cost_center_id ?? current?.cost_center_id ?? null,
    customerId: body.customer_id ?? current?.customer_id ?? null,
    vendorId: body.vendor_id ?? current?.vendor_id ?? null,
    employeeId: body.employee_id ?? current?.employee_id ?? null,
    invoiceId: body.invoice_id ?? current?.invoice_id ?? null,
    expenseId: body.expense_id ?? current?.expense_id ?? null,
    advanceRequestId: body.advance_request_id ?? current?.advance_request_id ?? null,
    payrollId: body.payroll_id ?? current?.payroll_id ?? null,
    description: body.description === undefined ? current?.description ?? null : requireText(body.description) || null,
    referenceNo: body.reference_no === undefined ? current?.reference_no ?? null : requireText(body.reference_no) || null,
    method: body.method === undefined ? current?.method ?? null : requireText(body.method) || null,
    notes: body.notes === undefined ? current?.notes ?? null : requireText(body.notes) || null,
    attachmentUrl: body.attachment_url === undefined ? current?.attachment_url ?? null : requireText(body.attachment_url) || null,
  };
}

function normalizeMonth(value: unknown) {
  const text = requireText(value);
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return parseDate(text);
}

function actionFor(method: string, parts: string[]): AccountingAction {
  if (parts[0] === "payroll" && method === "GET") return "payroll";
  if (parts[0] === "sales" && method === "GET") return "sales";
  if (parts[0] === "reports" && method === "GET") return "reports";
  if (parts[0] === "payroll" && parts[1] === "record-payment") return "post";
  if (parts[0] === "payroll" && parts[1] === "auto-post") return "post";
  if (parts[0] === "assets" && (parts[1] === "capitalize" || parts[1] === "run-depreciation")) return "post";
  if (parts[0] === "eosb" && (parts[1] === "run-accrual" || parts[1] === "settle")) return "post";
  if (parts[0] === "gosi" && parts[1] === "record-payment") return "post";
  if (parts[0] === "commissions" && parts[1] === "settle") return "post";
  if (method === "GET") return "view";
  if (parts[0] === "settings" || parts[0] === "init-defaults") return "settings";
  const entitySetupSegments = ["entities", "branches", "books", "user-scopes", "currencies", "exchange-rates", "fiscal-calendars", "dimension-types", "dimension-values", "dimension-policies", "allocation-rules", "account-templates", "dimensions", "approval-policies", "approval-steps", "approval-requests", "recurring-templates", "recurring-schedules", "recognition-schedules", "opening-balances", "close-runs", "close-checklist-templates"];
  if (entitySetupSegments.includes(parts[0])) return "settings";
  if (["post", "reverse", "approve", "reject", "pay", "issue", "record-payment"].includes(parts[2] || "")) return "post";
  if (parts[0] === "payments" && parts[2] === "post") return "post";
  return "manage";
}

async function listTable(admin: ReturnType<typeof createAdminClient>, table: string, orgId: string, request: NextRequest, orderColumn = "created_at") {
  let query = db(admin).from(table).select("*").eq("organization_id", orgId).order(orderColumn, { ascending: false });
  const search = request.nextUrl.searchParams.get("q")?.trim();
  const status = request.nextUrl.searchParams.get("status")?.trim();
  const type = request.nextUrl.searchParams.get("type")?.trim();
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  if (search && ["accounting_vendors", "accounting_customers"].includes(table)) query = query.or(`name_ar.ilike.%${search}%,name_en.ilike.%${search}%,vat_number.ilike.%${search}%`);
  if (search && table === "accounting_accounts") query = query.or(`code.ilike.%${search}%,name_ar.ilike.%${search}%,name_en.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function getRecord(admin: ReturnType<typeof createAdminClient>, table: string, orgId: string, id: string, select = "*") {
  const { data, error } = await db(admin).from(table).select(select).eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("السجل غير موجود.");
  return data as Record<string, unknown>;
}

async function getPayrollAccountingStatus(admin: ReturnType<typeof createAdminClient>, orgId: string, monthInput: unknown) {
  const month = normalizeMonth(monthInput);
  const runResult = await db(admin)
    .from("payroll_runs")
    .select("id, status, formula_version, employee_count, total_net, version")
    .eq("org_id", orgId)
    .eq("month", month)
    .maybeSingle();
  if (runResult.error) throw new Error(runResult.error.message);
  const run = runResult.data as Record<string, unknown> | null;
  const sourceId = run?.id ? String(run.id) : null;
  const advanceResult = sourceId ? await db(admin)
    .from("payslips")
    .select("advance_deduction")
    .eq("org_id", orgId)
    .eq("payroll_run_id", sourceId) : { data: [], error: null };
  if (advanceResult.error) throw new Error(advanceResult.error.message);
  const advanceDeductions = roundMoney(((advanceResult.data || []) as Record<string, unknown>[])
    .reduce((sum, row) => sum + Number(row.advance_deduction || 0), 0));

  const sourcePosting = await db(admin)
    .from("accounting_source_postings")
    .select("journal_entry_id, status")
    .eq("organization_id", orgId)
    .eq("source_module", "payroll")
    .eq("source_id", sourceId || "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  if (sourcePosting.error) throw new Error(sourcePosting.error.message);

  let journal: Record<string, unknown> | null = null;
  if (sourcePosting.data?.journal_entry_id) {
    const journalResult = await db(admin)
      .from("accounting_journal_entries")
      .select("id, entry_no, status, total_debit, total_credit, posted_at")
      .eq("organization_id", orgId)
      .eq("id", sourcePosting.data.journal_entry_id)
      .maybeSingle();
    if (journalResult.error) throw new Error(journalResult.error.message);
    journal = journalResult.data as Record<string, unknown> | null;
  }

  const paymentResult = await db(admin)
    .from("accounting_payments")
    .select("id, payment_no, status, amount, journal_entry_id, posted_at")
    .eq("organization_id", orgId)
    .eq("type", "payroll_payment")
    .eq("payroll_id", sourceId || "00000000-0000-0000-0000-000000000000")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentResult.error) throw new Error(paymentResult.error.message);

  let paymentJournal: Record<string, unknown> | null = null;
  if (paymentResult.data?.journal_entry_id) {
    const paymentJournalResult = await db(admin)
      .from("accounting_journal_entries")
      .select("id, entry_no, status")
      .eq("organization_id", orgId)
      .eq("id", paymentResult.data.journal_entry_id)
      .maybeSingle();
    if (paymentJournalResult.error) throw new Error(paymentJournalResult.error.message);
    paymentJournal = paymentJournalResult.data as Record<string, unknown> | null;
  }

  const payment = paymentResult.data as Record<string, unknown> | null;
  const status = run?.status === "paid" || payment?.status === "posted"
    ? "paid"
    : journal?.status === "posted"
      ? "posted"
      : journal
        ? "draft_created"
        : "not_generated";

  return {
    month,
    payroll_id: sourceId,
    status,
    payroll_run_status: run?.status || null,
    formula_version: run?.formula_version || null,
    payroll_run_version: run?.version || null,
    payslip_count: Number(run?.employee_count || 0),
    total_net: roundMoney(run?.total_net || 0),
    advance_deductions: advanceDeductions,
    journal_entry_id: journal?.id || null,
    journal_entry_no: journal?.entry_no || null,
    journal_status: journal?.status || null,
    payment_id: payment?.id || null,
    payment_no: payment?.payment_no || null,
    payment_status: payment?.status || null,
    payment_journal_entry_id: payment?.journal_entry_id || null,
    payment_journal_entry_no: paymentJournal?.entry_no || null,
  };
}

function commissionPaymentMethod(value: unknown) {
  const method = requireText(value, "cash");
  if (["cash", "bank_transfer", "wallet", "other"].includes(method)) return method;
  throw new Error("طريقة السداد غير صحيحة.");
}

function commissionStatusFilter(value: string | null) {
  if (value === "paid" || value === "unpaid" || value === "all") return value;
  return "unpaid";
}

function isCurrentMonth(value: unknown) {
  const text = requireText(value);
  if (!text) return false;
  const now = new Date();
  const paidAt = new Date(text);
  return paidAt.getFullYear() === now.getFullYear() && paidAt.getMonth() === now.getMonth();
}

function nestedRow(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function mapCommissionRow(row: Record<string, unknown>, beneficiaryType: "agent" | "merchant"): Record<string, unknown> {
  const agent = nestedRow(row.agent);
  const merchant = nestedRow(row.merchant);
  const ownerAgent = nestedRow(row.owner_agent);
  const packageRow = nestedRow(row.package);
  const sim = nestedRow(row.sim);
  const sale = nestedRow(row.sale);
  const beneficiary = beneficiaryType === "agent" ? agent : merchant;

  return {
    ...row,
    beneficiary_type: beneficiaryType,
    beneficiary_name: String(
      beneficiary.full_name ||
      beneficiary.business_name ||
      beneficiary.owner_name ||
      ""
    ),
    agent_name: String(agent.full_name || ownerAgent.full_name || ""),
    owner_agent_name: String(ownerAgent.full_name || ""),
    package_name: String(packageRow.package_name || ""),
    package_provider: String(packageRow.provider || sim.provider || ""),
    sim_label: String(sim.kit_code || sim.iccid || ""),
    sim_iccid: String(sim.iccid || ""),
    sim_kit_code: String(sim.kit_code || ""),
    sale_date: String(sale.sold_at || row.created_at || ""),
    sale_customer_name: sale.customer_name ? String(sale.customer_name) : null,
  };
}

async function getSalesCommissionsFinance(admin: ReturnType<typeof createAdminClient>, orgId: string, request: NextRequest) {
  const status = commissionStatusFilter(request.nextUrl.searchParams.get("status"));
  const beneficiaryType = request.nextUrl.searchParams.get("beneficiary_type") || "all";
  const dateFrom = request.nextUrl.searchParams.get("date_from") || "";
  const dateTo = request.nextUrl.searchParams.get("date_to") || "";
  const agentId = request.nextUrl.searchParams.get("agent_id") || "";
  const merchantId = request.nextUrl.searchParams.get("merchant_id") || "";
  const packageId = request.nextUrl.searchParams.get("package_id") || "";
  const provider = (request.nextUrl.searchParams.get("provider") || "").toLowerCase();

  const loadAgentRows = async () => {
    let query = db(admin)
      .from("agent_commissions")
      .select("*, agent:agent_id(id, full_name, phone), package:sim_package_id(id, package_name, provider), sim:sim_unit_id(id, iccid, kit_code, provider, sim_type), sale:sale_id(id, sold_at, sale_price, customer_name)")
      .eq("organization_id", orgId);
    if (status === "paid") query = query.eq("is_paid", true);
    if (status === "unpaid") query = query.eq("is_paid", false);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (agentId) query = query.eq("agent_id", agentId);
    if (packageId) query = query.eq("sim_package_id", packageId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data || []) as Record<string, unknown>[])
      .filter((row) => !provider || String(nestedRow(row.package).provider || nestedRow(row.sim).provider || "").toLowerCase() === provider)
      .map((row) => mapCommissionRow(row, "agent"));
  };

  const loadMerchantRows = async () => {
    let query = db(admin)
      .from("merchant_commissions")
      .select("*, merchant:merchant_id(id, business_name, owner_name, phone), owner_agent:agent_id(id, full_name, phone), package:sim_package_id(id, package_name, provider), sim:sim_unit_id(id, iccid, kit_code, provider, sim_type), sale:sale_id(id, sold_at, sale_price, customer_name)")
      .eq("organization_id", orgId);
    if (status === "paid") query = query.eq("is_paid", true);
    if (status === "unpaid") query = query.eq("is_paid", false);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (agentId) query = query.eq("agent_id", agentId);
    if (merchantId) query = query.eq("merchant_id", merchantId);
    if (packageId) query = query.eq("sim_package_id", packageId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data || []) as Record<string, unknown>[])
      .filter((row) => !provider || String(nestedRow(row.package).provider || nestedRow(row.sim).provider || "").toLowerCase() === provider)
      .map((row) => mapCommissionRow(row, "merchant"));
  };

  const [agentCommissions, merchantCommissions] = await Promise.all([
    beneficiaryType === "merchant" ? Promise.resolve([]) : loadAgentRows(),
    beneficiaryType === "agent" ? Promise.resolve([]) : loadMerchantRows(),
  ]);
  const allRows = [...agentCommissions, ...merchantCommissions];

  return {
    summary: {
      unpaid_agent_total: roundMoney(agentCommissions.filter((row) => !row.is_paid).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0)),
      unpaid_merchant_total: roundMoney(merchantCommissions.filter((row) => !row.is_paid).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0)),
      paid_total: roundMoney(allRows.filter((row) => row.is_paid && isCurrentMonth(row.paid_at)).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0)),
      total_commission_expense: roundMoney(allRows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0)),
    },
    agent_commissions: agentCommissions,
    merchant_commissions: merchantCommissions,
  };
}

async function settleSalesCommissionsFinance(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
  body: Record<string, unknown>
) {
  const beneficiaryType = requireText(body.beneficiary_type);
  if (beneficiaryType !== "agent" && beneficiaryType !== "merchant") {
    throw new Error("نوع المستفيد مطلوب.");
  }

  const commissionIds = Array.from(new Set(
    (Array.isArray(body.commission_ids) ? body.commission_ids : [])
      .map((id) => requireText(id))
      .filter(Boolean)
  ));
  if (commissionIds.length === 0) throw new Error("اختر عمولة واحدة على الأقل للسداد.");

  const { data, error } = await db(admin).rpc("settle_sim_commissions", {
    p_org_id: orgId,
    p_actor_user_id: userId,
    p_command_id: uuidOrNull(body.command_id) || randomUUID(),
    p_request_id: uuidOrNull(body.request_id) || randomUUID(),
    p_beneficiary_type: beneficiaryType,
    p_commission_ids: commissionIds,
    p_payment_date: body.payment_date ? parseDate(body.payment_date) : null,
    p_account_id: uuidOrNull(body.account_id),
    p_payment_method: commissionPaymentMethod(body.payment_method),
    p_payment_reference: requireText(body.payment_reference) || null,
    p_finance_notes: requireText(body.finance_notes) || null,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const batch = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!batch) throw new Error("تعذر إنشاء دفعة تسوية العمولات.");
  return {
    settlement_batch_id: batch.id,
    settled_count: Number(batch.commission_count || 0),
    total_amount: Number(batch.total_amount || 0),
    accounting_payment_id: batch.accounting_payment_id,
    accounting_journal_entry_id: batch.accounting_journal_entry_id,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess(actionFor("GET", parts), request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();

  try {
    const { dateFrom, dateTo, asOf } = getQueryDates(request);
    if (parts[0] === "dashboard") return json(await getAccountingDashboard(admin, auth.orgId, dateFrom, dateTo));
    if (parts[0] === "commissions") return json(await getSalesCommissionsFinance(admin, auth.orgId, request));
    if (parts[0] === "accounts") return json(await listTable(admin, "accounting_accounts", auth.orgId, request, "code"));
    if (parts[0] === "cost-centers") return json(await listTable(admin, "accounting_cost_centers", auth.orgId, request, "code"));
    if (parts[0] === "vendors") {
      if (parts[1]) return json(await getRecord(admin, "accounting_vendors", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_vendors", auth.orgId, request));
    }
    if (parts[0] === "customers") {
      if (parts[1]) return json(await getRecord(admin, "accounting_customers", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_customers", auth.orgId, request));
    }
    if (parts[0] === "journal-entries") {
      if (parts[1]) return json(await getRecord(admin, "accounting_journal_entries", auth.orgId, parts[1], "*, lines:accounting_journal_lines(*, account:account_id(*), cost_center:cost_center_id(*))"));
      return json(await listTable(admin, "accounting_journal_entries", auth.orgId, request, "entry_date"));
    }
    if (parts[0] === "expenses") {
      if (parts[1]) return json(await getRecord(admin, "accounting_expenses", auth.orgId, parts[1], "*, vendor:vendor_id(*), employee:employee_id(full_name, employee_code), cost_center:cost_center_id(*)"));
      return json(await listTable(admin, "accounting_expenses", auth.orgId, request, "expense_date"));
    }
    if (parts[0] === "invoices") {
      if (parts[1]) return json(await getRecord(admin, "accounting_invoices", auth.orgId, parts[1], "*, customer:customer_id(*), lines:accounting_invoice_lines(*)"));
      return json(await listTable(admin, "accounting_invoices", auth.orgId, request, "invoice_date"));
    }
    if (parts[0] === "payments") {
      if (parts[1]) return json(await getRecord(admin, "accounting_payments", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_payments", auth.orgId, request, "payment_date"));
    }
    if (parts[0] === "tax-rates") {
      return json(await listTable(admin, "accounting_tax_rates", auth.orgId, request, "name_ar"));
    }
    if (parts[0] === "payroll" && parts[1] === "status") {
      return json(await getPayrollAccountingStatus(admin, auth.orgId, request.nextUrl.searchParams.get("month") || new Date()));
    }
    if (parts[0] === "sales" && parts[1] === "revenue-accounts") {
      const { data, error } = await db(admin)
        .from("accounting_accounts")
        .select("id, code, name_ar, name_en")
        .eq("organization_id", auth.orgId)
        .eq("type", "revenue")
        .eq("is_active", true)
        .order("code", { ascending: true });
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "sales" && parts[1] === "companies") {
      const { data, error } = await db(admin)
        .from("sales_companies")
        .select("id, name, code, brand_color, is_active, accounting_customer_id, accounting_customer:accounting_customer_id(id, name_ar)")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "sales" && parts[1] === "log-status") {
      const logId = requireText(request.nextUrl.searchParams.get("sales_log_id"));
      if (!logId) return message("sales_log_id is required.", 400);
      const { data, error } = await db(admin)
        .from("accounting_invoices")
        .select("id, invoice_no, status, total_amount, balance_due, journal_entry_id")
        .eq("organization_id", auth.orgId)
        .eq("source_module", "sales_log")
        .eq("source_id", logId)
        .not("status", "in", "(cancelled,void)")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return json({ sales_log_id: logId, status: data ? "invoice_created" : "not_generated", invoice: data || null });
    }
    // Multi-entity management endpoints
    if (parts[0] === "entities") {
      if (parts[1] === "allowed") return json(await getUserAllowedEntities(auth.orgId, auth.user.id));
      if (parts[1]) return json(await getLegalEntity(auth.orgId, parts[1]));
      return json(await getLegalEntities(auth.orgId));
    }
    if (parts[0] === "branches") {
      const entityFilter = request.nextUrl.searchParams.get("legal_entity_id") || undefined;
      return json(await getBranches(auth.orgId, entityFilter));
    }
    if (parts[0] === "books") {
      const entityFilter = request.nextUrl.searchParams.get("legal_entity_id") || undefined;
      return json(await getBooks(auth.orgId, entityFilter));
    }
    if (parts[0] === "user-scopes") {
      const entityFilter = request.nextUrl.searchParams.get("legal_entity_id") || undefined;
      return json(await getUserScopes(auth.orgId, entityFilter));
    }
    if (parts[0] === "dimension-types") {
      const { data, error } = await db(admin).from("accounting_dimension_types").select("*").eq("organization_id", auth.orgId).order("sort_order");
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "dimension-values") {
      let query = db(admin).from("accounting_dimension_values").select("*").eq("organization_id", auth.orgId).order("code");
      const typeId = request.nextUrl.searchParams.get("dimension_type_id");
      if (typeId) query = query.eq("dimension_type_id", typeId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "dimension-policies") {
      const { data, error } = await db(admin).from("accounting_dimension_policies").select("*").eq("organization_id", auth.orgId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "allocation-rules") {
      const { data, error } = await db(admin).from("accounting_allocation_rules").select("*").eq("organization_id", auth.orgId).order("code");
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "account-templates") {
      const { data, error } = await db(admin).from("accounting_account_templates").select("*").eq("organization_id", auth.orgId).order("code");
      if (error) throw new Error(error.message);
      return json(data || []);
    }
    if (parts[0] === "approval-policies") {
      if (parts[1]) return json(await getRecord(admin, "accounting_approval_policies", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_approval_policies", auth.orgId, request));
    }
    if (parts[0] === "approval-requests") {
      if (parts[1]) {
        const req = await getRecord(admin, "accounting_approval_requests", auth.orgId, parts[1]);
        const { data: decisions } = await db(admin).from("accounting_approval_decisions").select("*").eq("request_id", parts[1]).order("decided_at");
        return json({ ...req, decisions: decisions || [] });
      }
      return json(await listTable(admin, "accounting_approval_requests", auth.orgId, request));
    }
    if (parts[0] === "recurring-templates") {
      if (parts[1]) {
        const template = await getRecord(admin, "accounting_recurring_journal_templates", auth.orgId, parts[1]);
        const { data: lines } = await db(admin).from("accounting_recurring_journal_lines").select("*").eq("template_id", parts[1]).order("sort_order");
        const { data: schedules } = await db(admin).from("accounting_recurring_schedules").select("*").eq("template_id", parts[1]).order("created_at", { ascending: false });
        return json({ ...template, lines: lines || [], schedules: schedules || [] });
      }
      return json(await listTable(admin, "accounting_recurring_journal_templates", auth.orgId, request));
    }
    if (parts[0] === "recurring-schedules") {
      if (parts[1]) {
        const schedule = await getRecord(admin, "accounting_recurring_schedules", auth.orgId, parts[1]);
        const { data: runs } = await db(admin).from("accounting_recurring_runs").select("*").eq("schedule_id", parts[1]).order("run_date", { ascending: false }).limit(50);
        return json({ ...schedule, runs: runs || [] });
      }
      return json(await listTable(admin, "accounting_recurring_schedules", auth.orgId, request));
    }
    if (parts[0] === "recognition-schedules") {
      if (parts[1]) {
        const schedule = await getRecord(admin, "accounting_recognition_schedules", auth.orgId, parts[1]);
        const { data: lines } = await db(admin).from("accounting_recognition_schedule_lines").select("*").eq("schedule_id", parts[1]).order("period_date");
        return json({ ...schedule, lines: lines || [] });
      }
      return json(await listTable(admin, "accounting_recognition_schedules", auth.orgId, request));
    }
    if (parts[0] === "opening-balances") {
      if (parts[1]) return json(await getRecord(admin, "accounting_opening_balance_batches", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_opening_balance_batches", auth.orgId, request));
    }
    if (parts[0] === "close-runs") {
      if (parts[1]) {
        const run = await getRecord(admin, "accounting_close_runs", auth.orgId, parts[1]);
        const { data: tasks } = await db(admin).from("accounting_close_tasks").select("*").eq("close_run_id", parts[1]).order("task_order");
        return json({ ...run, tasks: tasks || [] });
      }
      return json(await listTable(admin, "accounting_close_runs", auth.orgId, request));
    }
    if (parts[0] === "close-checklist-templates") {
      return json(await listTable(admin, "accounting_close_checklist_templates", auth.orgId, request));
    }
    if (parts[0] === "currencies") return json(await getCurrencies(auth.orgId));
    if (parts[0] === "exchange-rates") {
      return json(await getExchangeRates(auth.orgId, {
        from: request.nextUrl.searchParams.get("from") || undefined,
        to: request.nextUrl.searchParams.get("to") || undefined,
        date: request.nextUrl.searchParams.get("date") || undefined,
        type: request.nextUrl.searchParams.get("type") || undefined,
      }));
    }
    if (parts[0] === "fiscal-calendars") return json(await getFiscalCalendars(auth.orgId));
    if (parts[0] === "budgets") {
      if (parts[1]) {
        const budget = await getRecord(admin, "accounting_budgets", auth.orgId, parts[1]);
        const { data: lines, error: linesError } = await db(admin)
          .from("accounting_budget_lines")
          .select("*, account:account_id(id, code, name_ar), cost_center:cost_center_id(id, code, name_ar)")
          .eq("budget_id", parts[1])
          .order("month", { ascending: true });
        if (linesError) throw new Error(linesError.message);
        return json({ ...budget, lines: lines || [] });
      }
      return json(await listTable(admin, "accounting_budgets", auth.orgId, request));
    }
    if (parts[0] === "periods") {
      if (parts[1]) return json(await getRecord(admin, "accounting_periods", auth.orgId, parts[1]));
      return json(await listTable(admin, "accounting_periods", auth.orgId, request, "start_date"));
    }
    if (parts[0] === "settings") {
      const settings = await getAccountingSettings(admin, auth.orgId);
      return json(settings);
    }
    if (parts[0] === "reports") {
      // Official financial reports are generated from posted/reversed ledger entries only.
      if (parts[1] === "trial-balance") return json(await getTrialBalance(admin, auth.orgId, dateFrom, dateTo));
      if (parts[1] === "general-ledger") return json(await getGeneralLedger(admin, auth.orgId, request.nextUrl.searchParams.get("account_id") || undefined, dateFrom, dateTo));
      if (parts[1] === "profit-loss") return json(await getProfitLoss(admin, auth.orgId, dateFrom, dateTo));
      if (parts[1] === "balance-sheet") return json(await getBalanceSheet(admin, auth.orgId, asOf || dateTo));
      if (parts[1] === "vat") return json(await getVatReport(admin, auth.orgId, dateFrom, dateTo));
      if (parts[1] === "payroll-cost") return json(await getPayrollCostReport(admin, auth.orgId, dateFrom, dateTo));
      if (parts[1] === "employee-advances") return json(await getEmployeeAdvancesReport(admin, auth.orgId, dateFrom, dateTo));
      // Operational AR aging uses business document status, not draft invoices.
      if (parts[1] === "ar-aging") {
        const { data, error } = await db(admin)
          .from("accounting_invoices")
          .select("invoice_no, invoice_date, due_date, total_amount, paid_amount, balance_due, status, customer:customer_id(name_ar)")
          .eq("organization_id", auth.orgId)
          .in("status", ["issued", "partially_paid"])
          .gt("balance_due", 0)
          .order("due_date", { ascending: true });
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      // Operational AP aging includes approved unpaid expenses only, excluding draft/rejected/cancelled.
      if (parts[1] === "ap-aging") {
        const { data, error } = await db(admin)
          .from("accounting_expenses")
          .select("expense_no, expense_date, total_amount, paid_status, status, vendor:vendor_id(name_ar)")
          .eq("organization_id", auth.orgId)
          .eq("status", "approved")
          .neq("paid_status", "paid")
          .order("expense_date", { ascending: true });
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      // Operational expense report excludes draft/rejected/cancelled unless a dedicated status filter is added later.
      if (parts[1] === "expenses") {
        const { data, error } = await db(admin)
          .from("accounting_expenses")
          .select("expense_no, expense_date, description, amount_before_vat, vat_amount, total_amount, status, cost_center:cost_center_id(name_ar, code)")
          .eq("organization_id", auth.orgId)
          .in("status", ["approved", "paid"])
          .gte("expense_date", dateFrom || "1900-01-01")
          .lte("expense_date", dateTo || "2999-12-31")
          .order("expense_date", { ascending: false });
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      if (parts[1] === "sales-revenue") {
        const { data, error } = await db(admin)
          .from("accounting_invoices")
          .select("invoice_no, invoice_date, subtotal, discount_amount, vat_amount, total_amount, status, source_module, customer:customer_id(name_ar, sales_company_id)")
          .eq("organization_id", auth.orgId)
          .in("status", ["issued", "partially_paid", "paid"])
          .gte("invoice_date", dateFrom || "1900-01-01")
          .lte("invoice_date", dateTo || "2999-12-31")
          .order("invoice_date", { ascending: false });
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      if (parts[1] === "cash-flow") {
        return json(await getCashFlowStatement(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31"));
      }
      if (parts[1] === "kpi-dashboard") {
        return json(await getKPIDashboard(admin, auth.orgId, dateFrom || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10), dateTo || new Date().toISOString().slice(0, 10)));
      }
      if (parts[1] === "cost-center-pnl") {
        const costCenterId = request.nextUrl.searchParams.get("cost_center_id") || undefined;
        return json(await getCostCenterPnL(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31", costCenterId));
      }
      if (parts[1] === "revenue-analysis") {
        const groupBy = (request.nextUrl.searchParams.get("group_by") || "customer") as "customer" | "product" | "channel" | "month";
        return json(await getRevenueAnalysis(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31", groupBy));
      }
      if (parts[1] === "expense-analysis") {
        const groupBy = (request.nextUrl.searchParams.get("group_by") || "category") as "category" | "vendor" | "cost_center" | "month";
        return json(await getExpenseAnalysis(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31", groupBy));
      }
      if (parts[1] === "payroll-analysis") {
        const groupBy = (request.nextUrl.searchParams.get("group_by") || "month") as "department" | "employee" | "month";
        return json(await getPayrollSummary(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31", groupBy));
      }
      if (parts[1] === "reconciliation") {
        const { data, error } = await db(admin).rpc("accounting_reconciliation_report", {
          p_org_id: auth.orgId,
          p_date_from: dateFrom || null,
          p_date_to: dateTo || null,
        });
        if (error) throw Object.assign(new Error(error.message), { code: error.code });
        return json(data);
      }
      if (parts[1] === "budget-variance") {
        const budgetId = request.nextUrl.searchParams.get("budget_id");
        if (!budgetId) return message("budget_id is required.", 400);
        return json(await getBudgetVariance(admin, auth.orgId, budgetId, dateFrom || "1900-01-01", dateTo || "2999-12-31"));
      }
      if (parts[1] === "cash-position") {
        return json(await getCashPosition(admin, auth.orgId, dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), dateTo || new Date().toISOString().slice(0, 10)));
      }
      if (parts[1] === "comparative") {
        const report = request.nextUrl.searchParams.get("report") || "profit-loss";
        const compare = (request.nextUrl.searchParams.get("compare") || "prior_period") as "prior_period" | "prior_year";
        if (report === "balance-sheet") {
          return json(await getComparativeBalanceSheet(admin, auth.orgId, asOf || dateTo || new Date().toISOString().slice(0, 10), compare));
        }
        return json(await getComparativeProfitLoss(admin, auth.orgId, dateFrom || "1900-01-01", dateTo || "2999-12-31", compare));
      }
      if (parts[1] === "ar-aging-enhanced") {
        return json(await getARAgingReport(admin, auth.orgId, asOf || undefined));
      }
      if (parts[1] === "ap-aging-enhanced") {
        return json(await getAPAgingReport(admin, auth.orgId, asOf || undefined));
      }
    }
    return message("مسار محاسبي غير مدعوم.", 404);
  } catch (error) {
    return message(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess(actionFor("POST", parts), request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));
  body.request_id ||= auth.requestId;

  try {
    if (parts[0] === "init-defaults") {
      await initializeAccountingDefaults(admin, auth.orgId, auth.user.id);
      await ensureDefaultEntity(auth.orgId);
      return json({ ok: true });
    }

    // Multi-entity management POST endpoints
    if (parts[0] === "entities") {
      if (parts[1] === "backfill-default") {
        const entityId = await ensureDefaultEntity(auth.orgId);
        return json({ legal_entity_id: entityId });
      }
      if (parts[1] && parts[2] === "status") {
        return json(await changeLegalEntityStatus(auth.orgId, auth.user.id, parts[1], body.status, Number(body.expected_version || 0)));
      }
      return json(await saveLegalEntity({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "legal_entity",
        entityId: parts[1] || null,
        expectedVersion: Number(body.expected_version || 0),
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "branches") {
      if (parts[1] && parts[2] === "deactivate") {
        return json(await deactivateBranch(auth.orgId, auth.user.id, parts[1], Number(body.expected_version || 0)));
      }
      return json(await saveBranch({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "branch",
        entityId: parts[1] || null,
        expectedVersion: Number(body.expected_version || 0),
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "books") {
      return json(await saveBook({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "book",
        entityId: parts[1] || null,
        expectedVersion: Number(body.expected_version || 0),
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "user-scopes") {
      if (parts[1] && parts[2] === "revoke") {
        return json(await revokeUserScope(auth.orgId, auth.user.id, parts[1]));
      }
      return json(await saveUserScope({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "scope",
        entityId: parts[1] || null,
        expectedVersion: 0,
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "currencies") {
      return json(await saveCurrency({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "currency",
        entityId: parts[1] || null,
        expectedVersion: 0,
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "exchange-rates") {
      if (parts[1] && parts[2] === "approve") {
        return json(await approveExchangeRate(auth.orgId, auth.user.id, parts[1]));
      }
      return json(await saveExchangeRate({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "rate",
        entityId: parts[1] || null,
        expectedVersion: 0,
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }
    if (parts[0] === "fiscal-calendars") {
      return json(await saveFiscalCalendar({
        orgId: auth.orgId,
        actorUserId: auth.user.id,
        entityType: "calendar",
        entityId: parts[1] || null,
        expectedVersion: 0,
        operation: "save",
        payload: body,
      }), parts[1] ? 200 : 201);
    }

    // Dimension management POST endpoints
    if (parts[0] === "dimension-types") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_dimension_types").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_dimension_types").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "dimension-values") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_dimension_values").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_dimension_values").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "dimension-policies") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_dimension_policies").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_dimension_policies").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "allocation-rules") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_allocation_rules").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_allocation_rules").insert({ ...body, organization_id: auth.orgId, created_by: auth.user.id }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "account-templates") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_account_templates").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_account_templates").insert({ ...body, organization_id: auth.orgId, created_by: auth.user.id }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "dimensions" && parts[1] === "backfill-cost-centers") {
      const { data, error } = await db(admin).rpc("accounting_backfill_cost_center_dimensions", { p_org_id: auth.orgId });
      if (error) throw new Error(error.message);
      return json({ count: data || 0 });
    }

    if (parts[0] === "approval-policies") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_approval_policies").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_approval_policies").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "approval-steps") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_approval_steps").update(body).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_approval_steps").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "approval-requests") {
      if (parts[1] && parts[2] === "decide") {
        const { data, error } = await db(admin).from("accounting_approval_decisions").insert({
          request_id: parts[1],
          organization_id: auth.orgId,
          step_number: Number(body.step_number || 1),
          decision: body.decision,
          actor_user_id: auth.user.id,
          reason: body.reason || null,
        }).select().single();
        if (error) throw new Error(error.message);
        const newStatus = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "returned";
        await db(admin).from("accounting_approval_requests").update({ status: newStatus, completed_at: new Date().toISOString() }).eq("id", parts[1]);
        return json(data, 201);
      }
      const { data, error } = await db(admin).from("accounting_approval_requests").insert({
        ...body,
        organization_id: auth.orgId,
        submitted_by: auth.user.id,
      }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "recurring-templates") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_recurring_journal_templates").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        if (Array.isArray(body.lines)) {
          await db(admin).from("accounting_recurring_journal_lines").delete().eq("template_id", parts[1]);
          const lines = (body.lines as Record<string, unknown>[]).map((l, i) => ({ ...l, template_id: parts[1], organization_id: auth.orgId, sort_order: i }));
          if (lines.length) await db(admin).from("accounting_recurring_journal_lines").insert(lines);
        }
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_recurring_journal_templates").insert({ ...body, organization_id: auth.orgId, created_by: auth.user.id }).select().single();
      if (error) throw new Error(error.message);
      if (Array.isArray(body.lines)) {
        const lines = (body.lines as Record<string, unknown>[]).map((l, i) => ({ ...l, template_id: data.id, organization_id: auth.orgId, sort_order: i }));
        if (lines.length) await db(admin).from("accounting_recurring_journal_lines").insert(lines);
      }
      return json(data, 201);
    }
    if (parts[0] === "recurring-schedules") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_recurring_schedules").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_recurring_schedules").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "recognition-schedules") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_recognition_schedules").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const payload = { ...body, organization_id: auth.orgId, created_by: auth.user.id, remaining_amount: body.total_amount };
      const { data, error } = await db(admin).from("accounting_recognition_schedules").insert(payload).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "opening-balances") {
      if (parts[1] && parts[2] === "approve") {
        const { data, error } = await db(admin).from("accounting_opening_balance_batches").update({ status: "approved", approved_by: auth.user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_opening_balance_batches").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_opening_balance_batches").insert({ ...body, organization_id: auth.orgId, uploaded_by: auth.user.id }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "close-checklist-templates") {
      if (parts[1]) {
        const { data, error } = await db(admin).from("accounting_close_checklist_templates").update({ ...body, updated_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_close_checklist_templates").insert({ ...body, organization_id: auth.orgId }).select().single();
      if (error) throw new Error(error.message);
      return json(data, 201);
    }
    if (parts[0] === "close-runs") {
      if (parts[1] && parts[2] === "complete-task") {
        const { data, error } = await db(admin).from("accounting_close_tasks").update({
          status: body.status || "completed",
          completed_by: auth.user.id,
          completed_at: new Date().toISOString(),
          exception_reason: body.exception_reason || null,
          updated_at: new Date().toISOString(),
        }).eq("organization_id", auth.orgId).eq("id", body.task_id).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      if (parts[1] && parts[2] === "complete") {
        const { data, error } = await db(admin).from("accounting_close_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("organization_id", auth.orgId).eq("id", parts[1]).select().single();
        if (error) throw new Error(error.message);
        return json(data);
      }
      const { data, error } = await db(admin).from("accounting_close_runs").insert({ ...body, organization_id: auth.orgId, started_by: auth.user.id }).select().single();
      if (error) throw new Error(error.message);
      if (body.checklist_template_id) {
        const { data: templateTasks } = await db(admin).from("accounting_close_tasks").select("name_ar, name_en, task_order").eq("close_run_id", body.checklist_template_id);
      }
      if (Array.isArray(body.tasks)) {
        const tasks = (body.tasks as Record<string, unknown>[]).map((t, i) => ({ ...t, close_run_id: data.id, organization_id: auth.orgId, task_order: i + 1 }));
        if (tasks.length) await db(admin).from("accounting_close_tasks").insert(tasks);
      }
      return json(data, 201);
    }

    if (parts[0] === "commissions" && parts[1] === "settle") {
      return json(await settleSalesCommissionsFinance(admin, auth.orgId, auth.user.id, body));
    }

    if (parts[0] === "accounts") {
      const values = {
        code: requireText(body.code),
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        type: requireText(body.type),
        subtype: requireText(body.subtype) || null,
        parent_id: body.parent_id || null,
        normal_balance: requireText(body.normal_balance, body.type === "asset" || body.type === "expense" ? "debit" : "credit"),
        description: requireText(body.description) || null,
      };
      if (!values.code || !values.name_ar) return message("رقم الحساب والاسم العربي مطلوبان.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
        p_request_id: command.requestId, p_command_id: command.commandId,
        p_entity_type: "account", p_entity_id: null, p_expected_version: 0,
        p_operation: "save", p_payload: values,
      }), 201);
    }

    if (parts[0] === "cost-centers") {
      const values = {
        code: requireText(body.code),
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        type: requireText(body.type, "custom"),
        reference_id: body.reference_id || null,
      };
      if (!values.code || !values.name_ar) return message("رقم مركز التكلفة والاسم العربي مطلوبان.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
        p_request_id: command.requestId, p_command_id: command.commandId,
        p_entity_type: "cost_center", p_entity_id: null, p_expected_version: 0,
        p_operation: "save", p_payload: values,
      }), 201);
    }

    if (parts[0] === "customers") {
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_customer", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_customer_id: null,
        p_expected_version: 0,
        p_payload: customerCommandPayload(body),
      }), 201);
    }

    if (parts[0] === "vendors") {
      const values: Record<string, unknown> = {
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        vat_number: requireText(body.vat_number) || null,
        commercial_registration: requireText(body.commercial_registration) || null,
        phone: requireText(body.phone) || null,
        email: requireText(body.email) || null,
        address: requireText(body.address) || null,
        city: requireText(body.city) || null,
        country: requireText(body.country, "Saudi Arabia"),
        payment_terms: requireText(body.payment_terms) || null,
      };
      values.bank_name = requireText(body.bank_name) || null;
      values.iban = requireText(body.iban) || null;
      if (!values.name_ar) return message("اسم المورد العربي مطلوب.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
        p_request_id: command.requestId, p_command_id: command.commandId,
        p_entity_type: "vendor", p_entity_id: null, p_expected_version: 0,
        p_operation: "save", p_payload: values,
      }), 201);
    }

    if (parts[0] === "journal-entries" && parts[1] && parts[2] === "post") {
      return json(await postJournalEntry(admin, auth.orgId, parts[1], auth.user.id, accountingCommandContext(request, body)));
    }
    if (parts[0] === "journal-entries" && parts[1] && parts[2] === "reverse") {
      return json(await reverseJournalEntry(
        admin,
        auth.orgId,
        parts[1],
        auth.user.id,
        requireText(body.reason) || undefined,
        accountingCommandContext(request, body)
      ));
    }
    if (parts[0] === "journal-entries") {
      const lines = Array.isArray(body.lines) ? body.lines as JournalLineInput[] : [];
      const command = accountingCommandContext(request, body);
      return json(await createJournalEntry(admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        entryDate: parseDate(body.entry_date),
        description: requireText(body.description),
        notes: requireText(body.notes) || null,
        status: body.status === "pending_approval" ? "pending_approval" : "draft",
        lines,
        commandId: command.commandId,
        requestId: command.requestId,
      }), 201);
    }

    if (parts[0] === "expenses" && parts[1] && parts[2] === "approve") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (!["draft", "pending_approval"].includes(String(expense.status))) return message("لا يمكن اعتماد هذا المصروف.", 400);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_transition_expense", {
        p_org_id: auth.orgId,
        p_expense_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? expense.version ?? 0),
        p_action: "approve",
        p_reason: null,
        p_paid_immediately: Boolean(body.paid_immediately),
      });
      return json(next);
    }
    if (parts[0] === "expenses" && parts[1] && parts[2] === "reject") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (!["draft", "pending_approval"].includes(String(expense.status))) return message("يمكن رفض المصروفات المسودة أو بانتظار الاعتماد فقط.", 400);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_transition_expense", {
        p_org_id: auth.orgId,
        p_expense_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? expense.version ?? 0),
        p_action: "reject",
        p_reason: requireText(body.reason) || null,
        p_paid_immediately: false,
      });
      return json(next);
    }
    if (parts[0] === "expenses" && parts[1] && parts[2] === "pay") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (String(expense.status) !== "approved") return message("يمكن سداد المصروفات المعتمدة وغير المسددة فقط.", 400);
      const amount = roundMoney(body.amount || expense.total_amount);
      const command = accountingCommandContext(request, body);
      await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: null,
        p_expected_version: 0,
        p_post: true,
        p_payload: paymentCommandPayload({
          payment_date: body.payment_date,
          amount,
          account_id: body.account_id,
          method: body.method,
          reference_no: body.reference_no,
          notes: body.notes,
          description: `سداد مصروف ${String(expense.expense_no || "")}`,
          vendor_id: expense.vendor_id,
          expense_id: parts[1],
          type: "vendor_payment",
          direction: "outbound",
        }),
      });
      const next = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      return json(next);
    }
    if (parts[0] === "expenses") {
      const command = accountingCommandContext(request, body);
      const result = await accountingRpcRecord(admin, "accounting_save_expense", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expense_id: null,
        p_expected_version: 0,
        p_payload: expenseCommandPayload(body),
      });
      return json(result, 201);
    }

    if (parts[0] === "invoices" && parts[1] && parts[2] === "issue") {
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1], "*, lines:accounting_invoice_lines(*)");
      if (invoice.status !== "draft") return message("يمكن إصدار الفواتير المسودة فقط.", 400);
      const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
      if (lines.length === 0) return message("لا يمكن إصدار فاتورة بدون بنود.", 400);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_issue_invoice", {
        p_org_id: auth.orgId,
        p_invoice_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? invoice.version ?? 0),
      });
      return json(next);
    }
    if (parts[0] === "invoices" && parts[1] && parts[2] === "record-payment") {
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1]);
      if (!["issued", "partially_paid"].includes(String(invoice.status))) return message("يمكن تسجيل السداد للفواتير الصادرة فقط.", 400);
      const amount = roundMoney(body.amount || invoice.balance_due);
      if (amount <= 0 || amount > Number(invoice.balance_due || 0)) return message("مبلغ السداد غير صحيح.", 400);
      const command = accountingCommandContext(request, body);
      await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: null,
        p_expected_version: 0,
        p_post: true,
        p_payload: paymentCommandPayload({
          payment_date: body.payment_date,
          type: "customer_receipt",
          direction: "inbound",
          amount,
          account_id: body.account_id,
          customer_id: invoice.customer_id,
          invoice_id: parts[1],
          method: body.method,
          reference_no: body.reference_no,
          notes: body.notes,
          description: `سداد فاتورة ${String(invoice.invoice_no || "")}`,
        }),
      });
      const next = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1]);
      return json(next);
    }
    if (parts[0] === "invoices") {
      const command = accountingCommandContext(request, body);
      const created = await accountingRpcRecord(admin, "accounting_save_invoice", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_invoice_id: null,
        p_expected_version: 0,
        p_payload: invoiceCommandPayload(body),
      });
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, String(created.id), "*, lines:accounting_invoice_lines(*)");
      return json(invoice, 201);
    }

    if (parts[0] === "payments" && parts[1] && parts[2] === "post") {
      const payment = await getRecord(admin, "accounting_payments", auth.orgId, parts[1]);
      if (payment.status !== "draft") return message("يمكن ترحيل الدفعات المسودة فقط.", 400);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: parts[1],
        p_expected_version: Number(body.expected_version ?? payment.version ?? 0),
        p_post: true,
        p_payload: paymentCommandPayload(payment),
      });
      return json(next);
    }
    if (parts[0] === "payments") {
      const paymentType = requireText(body.type, "manual");
      const direction = requireText(body.direction, "outbound");
      const amount = roundMoney(body.amount);
      const accountId = requireText(body.account_id) || null;
      const counterpartAccountId = requireText(body.counterpart_account_id) || null;
      const description = requireText(body.description) || requireText(body.notes) || null;
      if (amount <= 0) return message("مبلغ الدفعة يجب أن يكون أكبر من صفر.", 400);
      if (!["inbound", "outbound"].includes(direction)) return message("اتجاه الدفعة غير صحيح.", 400);
      if (paymentType === "manual") {
        if (!accountId) return message("حساب البنك أو النقدية مطلوب للدفعة اليدوية.", 400);
        if (!counterpartAccountId) return message("الحساب المقابل مطلوب للدفعة اليدوية.", 400);
        if (accountId === counterpartAccountId) return message("حساب البنك أو النقدية يجب أن يختلف عن الحساب المقابل.", 400);
        if (!description) return message("وصف الدفعة اليدوية مطلوب.", 400);
      }
      const command = accountingCommandContext(request, body);
      const result = await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: null,
        p_expected_version: 0,
        p_post: false,
        p_payload: paymentCommandPayload({ ...body, type: paymentType, direction, amount, account_id: accountId, counterpart_account_id: counterpartAccountId, description }),
      });
      return json(result, 201);
    }

    if (parts[0] === "payroll" && parts[1] === "create-draft-entry") {
      const month = normalizeMonth(body.month);
      if (!month) return message("الشهر مطلوب.", 400);
      const settings = await getAccountingSettings(admin, auth.orgId);
      if (!settings?.default_salary_expense_id || !settings?.default_salary_payable_id || !settings?.default_gosi_expense_id || !settings?.default_gosi_payable_id) {
        return message("أكمل حسابات مصروف/مستحق الرواتب ومصروف/مستحق التأمينات أولا.", 400);
      }
      const runResult = await db(admin).from("payroll_runs").select("*")
        .eq("org_id", auth.orgId).eq("month", month).maybeSingle();
      if (runResult.error) throw new Error(runResult.error.message);
      const run = runResult.data as Record<string, unknown> | null;
      if (!run || run.status !== "approved" || run.formula_version !== "sa-payroll-v1") {
        return message("يجب اعتماد مسير رواتب مكتمل ومحسوب بالصيغة الحالية قبل إنشاء القيد.", 400);
      }
      const advanceResult = await db(admin).from("payslips").select("advance_deduction")
        .eq("org_id", auth.orgId).eq("payroll_run_id", run.id);
      if (advanceResult.error) throw new Error(advanceResult.error.message);
      const advanceDeductions = roundMoney(((advanceResult.data || []) as Record<string, unknown>[])
        .reduce((sum, row) => sum + Number(row.advance_deduction || 0), 0));
      if (advanceDeductions > 0 && !settings.default_employee_advances_id) return message("Employee advances account is required before posting payroll advance deductions.", 400);
      const totalNet = roundMoney(run.total_net);
      const employeeGosi = roundMoney(run.total_employee_gosi);
      const employerGosi = roundMoney(run.total_employer_gosi);
      const salaryCost = roundMoney(totalNet + employeeGosi + advanceDeductions);
      const lines: JournalLineInput[] = [
        { account_id: String(settings.default_salary_expense_id), debit: salaryCost, credit: 0, description: `رواتب ${month}` },
        { account_id: String(settings.default_salary_payable_id), debit: 0, credit: totalNet, description: `رواتب مستحقة ${month}` },
      ];
      if (employerGosi > 0) lines.push({ account_id: String(settings.default_gosi_expense_id), debit: employerGosi, credit: 0, description: `تأمينات صاحب العمل ${month}` });
      if (employeeGosi + employerGosi > 0) lines.push({ account_id: String(settings.default_gosi_payable_id), debit: 0, credit: roundMoney(employeeGosi + employerGosi), description: `تأمينات مستحقة ${month}` });
      if (advanceDeductions > 0) {
        lines.push({ account_id: String(settings.default_employee_advances_id), debit: 0, credit: advanceDeductions, description: `خصم سلف ${month}` });
      }
      const command = accountingCommandContext(request, body);
      const entry = await createJournalEntry(admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        entryDate: parseDate(month),
        description: `قيد رواتب ${month}`,
        sourceModule: "payroll",
        sourceId: String(run.id),
        status: "draft",
        lines,
        commandId: command.commandId,
        requestId: command.requestId,
      });
      return json(entry, 201);
    }

    if (parts[0] === "payroll" && parts[1] === "record-payment") {
      const month = normalizeMonth(body.month);
      const status = await getPayrollAccountingStatus(admin, auth.orgId, month);
      if (status.status === "not_generated" || status.status === "draft_created") return message("يجب ترحيل قيد الرواتب قبل تسجيل السداد.", 400);
      if (status.payment_id) return message("تم تسجيل دفعة رواتب لهذا الشهر مسبقا.", 400);
      const amount = roundMoney(body.amount || status.total_net);
      const totalNet = roundMoney(status.total_net);
      if (amount <= 0 || amount !== totalNet) return message("مبلغ سداد الرواتب يجب أن يساوي صافي الرواتب المستحق للشهر.", 400);
      if (!status.payroll_id) return message("مسير الرواتب غير موجود.", 404);
      const command = accountingCommandContext(request, body);
      const payment = await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: null,
        p_expected_version: 0,
        p_post: true,
        p_payload: paymentCommandPayload({
          payment_date: body.payment_date,
          type: "payroll_payment",
          direction: "outbound",
          amount,
          account_id: body.account_id,
          payroll_id: status.payroll_id,
          description: `سداد رواتب ${month}`,
          reference_no: body.reference_no,
          method: body.method,
          notes: body.notes,
        }),
      });
      const journal = payment.journal_entry_id
        ? await getRecord(admin, "accounting_journal_entries", auth.orgId, String(payment.journal_entry_id))
        : null;
      return json({ payment, journal, status: await getPayrollAccountingStatus(admin, auth.orgId, month) }, 201);
    }

    if (parts[0] === "budgets" && parts[1] && parts[2] === "approve") {
      const budget = await getRecord(admin, "accounting_budgets", auth.orgId, parts[1]);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_approve_budget", {
        p_org_id: auth.orgId,
        p_budget_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? budget.version ?? 0),
      });
      return json(next);
    }
    if (parts[0] === "budgets") {
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_budget", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_budget_id: null,
        p_expected_version: 0,
        p_payload: budgetCommandPayload(body),
      }), 201);
    }

    if (parts[0] === "periods" && parts[1] && parts[2] === "close") {
      const period = await getRecord(admin, "accounting_periods", auth.orgId, parts[1]);
      if (period.status !== "open") return message("يمكن إغلاق الفترات المفتوحة فقط.", 400);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_close_period", {
        p_org_id: auth.orgId,
        p_period_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? period.version ?? 0),
      });
      return json(next);
    }

    if (parts[0] === "periods" && parts[1] && parts[2] === "reopen") {
      const period = await getRecord(admin, "accounting_periods", auth.orgId, parts[1]);
      const command = accountingCommandContext(request, body);
      const next = await accountingRpcRecord(admin, "accounting_reopen_period", {
        p_org_id: auth.orgId,
        p_period_id: parts[1],
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expected_version: Number(body.expected_version ?? period.version ?? 0),
        p_reason: requireText(body.reason),
      });
      return json(next);
    }

    if (parts[0] === "reports" && parts[1] === "export") {
      const reportName = requireText(body.report);
      const format = requireText(body.format, "csv");
      if (!reportName) return message("report name is required.", 400);
      const { dateFrom, dateTo } = getQueryDates(request);
      let reportData: unknown;
      if (reportName === "trial-balance") reportData = await getTrialBalance(admin, auth.orgId, dateFrom, dateTo);
      else if (reportName === "profit-loss") reportData = await getProfitLoss(admin, auth.orgId, dateFrom, dateTo);
      else if (reportName === "balance-sheet") reportData = await getBalanceSheet(admin, auth.orgId, dateTo);
      else return message("Report not supported for export.", 400);

      if (format === "csv") {
        const csv = reportToCSV(reportData as Record<string, unknown>);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${reportName}.csv"`,
          },
        });
      }
      return json(reportData);
    }

    if (parts[0] === "sales" && parts[1] === "link-company-customer") {
      const companyId = requireText(body.company_id);
      const customerId = requireText(body.customer_id);
      if (!companyId || !customerId) return message("شركة المبيعات والعميل المحاسبي مطلوبان.", 400);

      const current = await getRecord(admin, "accounting_customers", auth.orgId, customerId);
      const command = accountingCommandContext(request, body);
      const customer = await accountingRpcRecord(admin, "accounting_save_customer", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_customer_id: customerId,
        p_expected_version: Number(current.version || 0),
        p_payload: customerCommandPayload({ sales_company_id: companyId }, current),
      });
      const company = await getRecord(admin, "sales_companies", auth.orgId, companyId);
      return json({ company, customer });
    }

    if (parts[0] === "sales" && parts[1] === "create-invoice-from-log") {
      return message(
        "تم إيقاف إنشاء الفاتورة من سجل المبيعات لأن كل إصدار يُرحّل تلقائياً؛ إنشاء فاتورة إضافية يكرر الإيراد والذمم.",
        410
      );
    }

    // Phase 2: Payroll Auto-Post endpoint
    if (parts[0] === "payroll" && parts[1] === "auto-post") {
      const month = requireText(body.month);
      if (!/^\d{4}-\d{2}$/.test(month)) return message("الشهر مطلوب بصيغة YYYY-MM.", 400);
      const { autoPostPayrollMonth } = await import("@/lib/accounting/auto-posting");
      const command = accountingCommandContext(request, body);
      const result = await autoPostPayrollMonth(admin, auth.orgId, auth.user.id, month, command);
      if (!result.success) return message(result.error || "فشل ترحيل الرواتب تلقائيا.", 500);
      return json({ ...result, month }, 201);
    }

    // Phase 4: Asset Capitalization
    if (parts[0] === "assets" && parts[1] === "capitalize") {
      const assetId = requireText(body.asset_id);
      const assetName = requireText(body.asset_name);
      const purchasePrice = roundMoney(body.purchase_price);
      if (!assetId || purchasePrice <= 0) return message("معرف الأصل وسعر الشراء مطلوبان.", 400);
      const { autoCapitalizeAsset } = await import("@/lib/accounting/auto-posting");
      const command = accountingCommandContext(request, body);
      const result = await autoCapitalizeAsset(admin, auth.orgId, auth.user.id, {
        id: assetId,
        asset_name: assetName || "أصل",
        purchase_price: purchasePrice,
        paid_immediately: Boolean(body.paid_immediately),
        command_id: command.commandId,
        request_id: command.requestId,
      });
      if (!result.success) return message(result.error || "فشل رسملة الأصل.", 500);
      return json(result, 201);
    }

    // Phase 4: Monthly Depreciation Batch
    if (parts[0] === "assets" && parts[1] === "run-depreciation") {
      const month = requireText(body.month);
      if (!/^\d{4}-\d{2}$/.test(month)) return message("الشهر مطلوب بصيغة YYYY-MM.", 400);
      const { runMonthlyDepreciation } = await import("@/lib/accounting/auto-posting");
      const result = await runMonthlyDepreciation(admin, auth.orgId, auth.user.id, month);
      if (!result.success) return message(result.error || "فشل تشغيل الإهلاك.", 500);
      return json(result, 201);
    }

    // Phase 5: Monthly EOSB Accrual
    if (parts[0] === "eosb" && parts[1] === "run-accrual") {
      const month = requireText(body.month);
      if (!/^\d{4}-\d{2}$/.test(month)) return message("الشهر مطلوب بصيغة YYYY-MM.", 400);
      const { runMonthlyEOSBAccrual } = await import("@/lib/accounting/auto-posting");
      const command = accountingCommandContext(request, body);
      const result = await runMonthlyEOSBAccrual(admin, auth.orgId, auth.user.id, month, command);
      if (!result.success) return message(result.error || "فشل احتساب مخصص نهاية الخدمة.", 500);
      return json(result, 201);
    }

    // Phase 5: EOSB Settlement (also triggers Phase 6 leave encashment)
    if (parts[0] === "eosb" && parts[1] === "settle") {
      const employeeId = requireText(body.employee_id);
      if (!employeeId) return message("معرف الموظف مطلوب.", 400);
      const { settleEmployeeEOSB, calculateAndPostLeaveEncashment } = await import("@/lib/accounting/auto-posting");
      const eosb = await settleEmployeeEOSB(admin, auth.orgId, auth.user.id, employeeId);
      if (!eosb.success) return message(eosb.error || "فشل تسوية مكافأة نهاية الخدمة.", 500);

      const leaveEncashment = await calculateAndPostLeaveEncashment(admin, auth.orgId, auth.user.id, employeeId);
      if (!leaveEncashment.success) {
        return NextResponse.json({
          message: leaveEncashment.error || "تم ترحيل مكافأة نهاية الخدمة وتعذر ترحيل تعويض الإجازات؛ أعد المحاولة بأمان.",
          eosb,
          leaveEncashment,
          requestId: auth.requestId,
        }, { status: 500 });
      }
      return json({ eosb, leaveEncashment }, 201);
    }

    // Phase 6: Leave Encashment (standalone endpoint)
    if (parts[0] === "leave-encashment" && parts[1] === "post") {
      const employeeId = requireText(body.employee_id);
      if (!employeeId) return message("معرف الموظف مطلوب.", 400);
      const { calculateAndPostLeaveEncashment } = await import("@/lib/accounting/auto-posting");
      const result = await calculateAndPostLeaveEncashment(admin, auth.orgId, auth.user.id, employeeId);
      if (!result.success) return message(result.error || "فشل ترحيل تعويض الإجازات.", 500);
      return json(result, 201);
    }

    // Phase 7: GOSI Payment Recording
    if (parts[0] === "gosi" && parts[1] === "record-payment") {
      const month = requireText(body.month);
      const totalAmount = roundMoney(body.amount);
      if (!/^\d{4}-\d{2}$/.test(month)) return message("الشهر مطلوب بصيغة YYYY-MM.", 400);
      if (totalAmount <= 0) return message("مبلغ التأمينات يجب أن يكون أكبر من صفر.", 400);
      const { recordGOSIPayment } = await import("@/lib/accounting/auto-posting");
      const result = await recordGOSIPayment(admin, auth.orgId, auth.user.id, month, totalAmount);
      if (!result.success) return message(result.error || "فشل تسجيل سداد التأمينات.", 500);
      return json(result, 201);
    }

    return message("مسار محاسبي غير مدعوم.", 404);
  } catch (error) {
    return message(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess(actionFor("PATCH", parts), request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));
  body.request_id ||= auth.requestId;

  try {
    if (parts[0] === "settings") {
      const current = await getAccountingSettings(admin, auth.orgId);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
        p_request_id: command.requestId, p_command_id: command.commandId,
        p_entity_type: "settings", p_entity_id: current?.id || null,
        p_expected_version: Number(body.expected_version ?? current?.version ?? 0),
        p_operation: "save", p_payload: body,
      }));
    }

    if (parts[0] === "journal-entries") {
      const id = parts[1] || body.id;
      if (!id) return message("معرف القيد مطلوب.", 400);
      const current = await getRecord(admin, "accounting_journal_entries", auth.orgId, id, "*, lines:accounting_journal_lines(*)");
      if (current.status !== "draft") return message("يمكن تعديل أو إرسال القيود المسودة فقط.", 400);
      if (!Array.isArray(body.lines) && body.status !== "pending_approval") {
        return message("أرسل سطور القيد للتعديل أو status=pending_approval للإرسال للاعتماد.", 400);
      }
      const command = accountingCommandContext(request, body);
      return json(await updateDraftJournalEntry(admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        entryId: id,
        entryDate: parseDate(body.entry_date || current.entry_date),
        description: requireText(body.description, String(current.description || "")),
        notes: body.notes === undefined ? (current.notes as string | null) : requireText(body.notes) || null,
        status: body.status === "pending_approval" ? "pending_approval" : "draft",
        lines: (Array.isArray(body.lines) ? body.lines : current.lines) as JournalLineInput[],
        expectedVersion: Number(body.expected_version ?? current.version ?? 0),
        commandId: command.commandId,
        requestId: command.requestId,
      }));
    }

    if (parts[0] === "invoices" && parts[1]) {
      const current = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1], "*, lines:accounting_invoice_lines(*)");
      if (current.status !== "draft") return message("يمكن تعديل الفواتير المسودة فقط.", 400);
      const command = accountingCommandContext(request, body);
      const updated = await accountingRpcRecord(admin, "accounting_save_invoice", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_invoice_id: parts[1],
        p_expected_version: Number(body.expected_version ?? current.version ?? 0),
        p_payload: invoiceCommandPayload(body, current),
      });
      return json(await getRecord(admin, "accounting_invoices", auth.orgId, String(updated.id), "*, lines:accounting_invoice_lines(*)"));
    }

    if (parts[0] === "expenses" && parts[1]) {
      const current = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (!["draft", "pending_approval"].includes(String(current.status))) return message("لا يمكن تعديل هذا المصروف.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_expense", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_expense_id: parts[1],
        p_expected_version: Number(body.expected_version ?? current.version ?? 0),
        p_payload: expenseCommandPayload(body, current),
      }));
    }

    if (parts[0] === "payments" && parts[1]) {
      const current = await getRecord(admin, "accounting_payments", auth.orgId, parts[1]);
      if (current.status !== "draft") return message("يمكن تعديل الدفعات المسودة فقط.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_payment", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_payment_id: parts[1],
        p_expected_version: Number(body.expected_version ?? current.version ?? 0),
        p_post: false,
        p_payload: paymentCommandPayload(body, current),
      }));
    }

    if (parts[0] === "customers" && parts[1]) {
      const current = await getRecord(admin, "accounting_customers", auth.orgId, parts[1]);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_customer", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_customer_id: parts[1],
        p_expected_version: Number(body.expected_version ?? current.version ?? 0),
        p_payload: customerCommandPayload(body, current),
      }));
    }

    if (parts[0] === "budgets" && parts[1]) {
      const budget = await getRecord(admin, "accounting_budgets", auth.orgId, parts[1]);
      const { data: existingLines, error: linesError } = await db(admin)
        .from("accounting_budget_lines")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("budget_id", parts[1]);
      if (linesError) throw new Error(linesError.message);
      const command = accountingCommandContext(request, body);
      const updated = await accountingRpcRecord(admin, "accounting_save_budget", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_budget_id: parts[1],
        p_expected_version: Number(body.expected_version ?? budget.version ?? 0),
        p_payload: budgetCommandPayload(body, { ...budget, lines: existingLines || [] }),
      });
      const { data: lines } = await db(admin).from("accounting_budget_lines").select("*").eq("budget_id", parts[1]);
      return json({ ...updated, lines: lines || [] });
    }

    const map: Record<string, { table: string; entity: string }> = {
      accounts: { table: "accounting_accounts", entity: "account" },
      "cost-centers": { table: "accounting_cost_centers", entity: "cost_center" },
      vendors: { table: "accounting_vendors", entity: "vendor" },
    };
    const target = map[parts[0] || ""];
    const id = parts[1] || body.id;
    if (!target || !id) return message("مسار التحديث غير مدعوم.", 404);
    const current = await getRecord(admin, target.table, auth.orgId, id);
    const command = accountingCommandContext(request, body);
    return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
      p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
      p_request_id: command.requestId, p_command_id: command.commandId,
      p_entity_type: target.entity, p_entity_id: id,
      p_expected_version: Number(body.expected_version ?? current.version ?? 0),
      p_operation: "save", p_payload: body,
    }));
  } catch (error) {
    return message(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const parts = await segments(context);
  const auth = await requireAccountingAccess("manage", request);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const id = parts[1] || request.nextUrl.searchParams.get("id") || "";
  const body = await request.json().catch(() => ({}));

  try {
    if (!id) return message("معرف السجل مطلوب.", 400);
    if (parts[0] === "journal-entries") {
      const entry = await getRecord(admin, "accounting_journal_entries", auth.orgId, id);
      if (["posted", "reversed"].includes(String(entry.status))) return message("لا يمكن حذف أو إلغاء قيد مرحل.", 400);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
        p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
        p_request_id: command.requestId, p_command_id: command.commandId,
        p_entity_type: "journal", p_entity_id: id,
        p_expected_version: Number(body.expected_version ?? entry.version ?? 0),
        p_operation: "cancel", p_payload: {},
      }));
    }
    if (parts[0] === "customers") {
      const current = await getRecord(admin, "accounting_customers", auth.orgId, id);
      const command = accountingCommandContext(request, body);
      return json(await accountingRpcRecord(admin, "accounting_save_customer", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: command.commandId,
        p_request_id: command.requestId,
        p_customer_id: id,
        p_expected_version: Number(current.version || 0),
        p_payload: customerCommandPayload({ is_active: false }, current),
      }));
    }
    const softDeleteTables: Record<string, { table: string; entity: string }> = {
      accounts: { table: "accounting_accounts", entity: "account" },
      "cost-centers": { table: "accounting_cost_centers", entity: "cost_center" },
      vendors: { table: "accounting_vendors", entity: "vendor" },
    };
    const target = softDeleteTables[parts[0] || ""];
    if (!target) return message("مسار الحذف غير مدعوم.", 404);
    const current = await getRecord(admin, target.table, auth.orgId, id);
    const command = accountingCommandContext(request, body);
    return json(await accountingRpcRecord(admin, "execute_accounting_master_command", {
      p_org_id: auth.orgId, p_actor_user_id: auth.user.id,
      p_request_id: command.requestId, p_command_id: command.commandId,
      p_entity_type: target.entity, p_entity_id: id,
      p_expected_version: Number(body.expected_version ?? current.version ?? 0),
      p_operation: "deactivate", p_payload: {},
    }));
  } catch (error) {
    return message(error);
  }
}
