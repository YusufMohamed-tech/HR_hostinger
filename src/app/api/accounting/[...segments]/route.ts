import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAccountingAccess, type AccountingAction } from "@/lib/accounting/permissions";
import { generateAccountingNumber } from "@/lib/accounting/numbering";
import { createJournalEntry, getAccountingSettings, initializeAccountingDefaults, postJournalEntry, reverseJournalEntry, updateDraftJournalEntry } from "@/lib/accounting/posting";
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
import { parseDate, requireText, roundMoney, type JournalLineInput } from "@/lib/accounting/validation";
import { writeAuditLog } from "@/lib/utils/audit";

type RouteContext = { params: { segments?: string[] } };

function db(admin: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function message(error: unknown, status = 500) {
  return NextResponse.json({ message: error instanceof Error ? error.message : String(error || "حدث خطأ غير متوقع.") }, { status });
}

function segments(context: RouteContext) {
  return context.params.segments || [];
}

function getQueryDates(request: NextRequest) {
  return {
    dateFrom: request.nextUrl.searchParams.get("date_from") || undefined,
    dateTo: request.nextUrl.searchParams.get("date_to") || undefined,
    asOf: request.nextUrl.searchParams.get("as_of") || undefined,
  };
}

function deterministicUuid(seed: string) {
  const hash = createHash("sha1").update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeMonth(value: unknown) {
  const text = requireText(value);
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return parseDate(text);
}

function parseJsonArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sumAdvanceDeductions(payslips: Record<string, unknown>[]) {
  return roundMoney(payslips.reduce((sum, slip) => {
    const deductions = parseJsonArray(slip.deductions_details);
    const advanceAmount = deductions.reduce((deductionSum, deduction) => {
      const label = String(deduction.label || deduction.type || deduction.name || "").toLowerCase();
      const isAdvance = label.includes("advance") || label.includes("سلفة") || label.includes("سلف");
      return deductionSum + (isAdvance ? Number(deduction.amount || 0) : 0);
    }, 0);
    return sum + advanceAmount;
  }, 0));
}

function payrollSourceId(orgId: string, month: string) {
  return deterministicUuid(`payroll:${orgId}:${month}`);
}

function actionFor(method: string, parts: string[]): AccountingAction {
  if (parts[0] === "payroll" && method === "GET") return "payroll";
  if (parts[0] === "sales" && method === "GET") return "sales";
  if (parts[0] === "reports" && method === "GET") return "reports";
  if (parts[0] === "payroll" && parts[1] === "record-payment") return "post";
  if (method === "GET") return "view";
  if (parts[0] === "settings" || parts[0] === "init-defaults") return "settings";
  if (["post", "reverse", "approve", "reject", "pay", "issue", "record-payment"].includes(parts[2] || "")) return "post";
  if (parts[0] === "payments" && parts[2] === "post") return "post";
  return "manage";
}

async function audit(admin: ReturnType<typeof createAdminClient>, orgId: string, userId: string, action: string, entity: string, entityId?: string | null, values?: Record<string, unknown>) {
  await writeAuditLog(admin, {
    org_id: orgId,
    actor_user_id: userId,
    action,
    entity,
    entity_id: entityId || null,
    new_values: values || null,
  });
}

async function notifyFinance(admin: ReturnType<typeof createAdminClient>, orgId: string, title: string, body: string, link: string) {
  const { data } = await db(admin)
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["admin", "finance_manager", "accountant"]);
  const rows = ((data || []) as Record<string, unknown>[]).map((member) => ({
    org_id: orgId,
    user_id: String(member.user_id),
    title,
    body,
    type: "accounting",
    link,
    is_read: false,
  }));
  if (rows.length > 0) await db(admin).from("notifications").insert(rows);
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

async function updateRecord(admin: ReturnType<typeof createAdminClient>, table: string, orgId: string, id: string, values: Record<string, unknown>) {
  const { data, error } = await db(admin).from(table).update(values).eq("organization_id", orgId).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

async function normalizeInvoiceLines(admin: ReturnType<typeof createAdminClient>, orgId: string, lines: Record<string, unknown>[]) {
  const taxIds = Array.from(new Set(lines.map((line) => String(line.tax_rate_id || "")).filter(Boolean)));
  const taxRates = new Map<string, number>();
  if (taxIds.length > 0) {
    const { data, error } = await db(admin)
      .from("accounting_tax_rates")
      .select("id, rate")
      .eq("organization_id", orgId)
      .in("id", taxIds);
    if (error) throw new Error(error.message);
    for (const row of (data || []) as Record<string, unknown>[]) taxRates.set(String(row.id), Number(row.rate || 0));
  }

  return lines.map((line) => {
    const quantity = roundMoney(line.quantity || 1) || 1;
    const unitPrice = roundMoney(line.unit_price);
    const discount = roundMoney(line.discount_amount);
    const beforeVat = Math.max(0, roundMoney(quantity * unitPrice - discount));
    const taxRateId = String(line.tax_rate_id || "");
    const rate = taxRateId ? taxRates.get(taxRateId) ?? 0 : 0;
    const vat = roundMoney(line.vat_amount ?? (beforeVat * rate / 100));
    return {
      organization_id: orgId,
      product_id: line.product_id || null,
      description_ar: requireText(line.description_ar, "بند فاتورة"),
      description_en: requireText(line.description_en) || null,
      quantity,
      unit_price: unitPrice,
      discount_amount: discount,
      tax_rate_id: taxRateId || null,
      vat_amount: vat,
      line_total: roundMoney(beforeVat + vat),
      revenue_account_id: line.revenue_account_id || null,
      cost_center_id: line.cost_center_id || null,
    };
  });
}

async function createOrUpdateInvoiceLines(admin: ReturnType<typeof createAdminClient>, orgId: string, invoiceId: string, lines: Record<string, unknown>[]) {
  const normalized = await normalizeInvoiceLines(admin, orgId, lines);
  const subtotal = roundMoney(normalized.reduce((sum, line) => sum + (line.quantity * line.unit_price), 0));
  const discount = roundMoney(normalized.reduce((sum, line) => sum + line.discount_amount, 0));
  const vat = roundMoney(normalized.reduce((sum, line) => sum + line.vat_amount, 0));
  const total = roundMoney(normalized.reduce((sum, line) => sum + line.line_total, 0));

  await db(admin).from("accounting_invoice_lines").delete().eq("organization_id", orgId).eq("invoice_id", invoiceId);
  if (normalized.length > 0) {
    const rows = normalized.map((line) => ({ ...line, invoice_id: invoiceId }));
    const result = await db(admin).from("accounting_invoice_lines").insert(rows);
    if (result.error) throw new Error(result.error.message);
  }

  await updateRecord(admin, "accounting_invoices", orgId, invoiceId, {
    subtotal,
    discount_amount: discount,
    vat_amount: vat,
    total_amount: total,
    balance_due: total,
  });

  return { subtotal, discount, vat, total };
}

async function buildInvoiceJournal(admin: ReturnType<typeof createAdminClient>, orgId: string, invoice: Record<string, unknown>, userId: string) {
  const settings = await getAccountingSettings(admin, orgId);
  if (!settings?.default_accounts_receivable_id || !settings?.default_sales_revenue_id) {
    throw new Error("أكمل إعدادات حسابات الذمم المدينة وإيرادات المبيعات أولا.");
  }
  const invoiceLines = Array.isArray(invoice.lines) ? invoice.lines as Record<string, unknown>[] : [];
  const revenueByAccount = new Map<string, number>();
  if (invoiceLines.length > 0) {
    for (const line of invoiceLines) {
      const accountId = String(line.revenue_account_id || settings.default_sales_revenue_id);
      const amount = roundMoney(Number(line.line_total || 0) - Number(line.vat_amount || 0));
      revenueByAccount.set(accountId, roundMoney((revenueByAccount.get(accountId) || 0) + amount));
    }
  } else {
    revenueByAccount.set(String(settings.default_sales_revenue_id), roundMoney(Number(invoice.subtotal || 0) - Number(invoice.discount_amount || 0)));
  }
  const lines: JournalLineInput[] = [
    { account_id: String(settings.default_accounts_receivable_id), debit: Number(invoice.total_amount || 0), credit: 0, description: String(invoice.invoice_no) },
    ...Array.from(revenueByAccount.entries()).map(([accountId, amount]) => ({
      account_id: accountId,
      debit: 0,
      credit: amount,
      description: String(invoice.invoice_no),
    })),
  ];
  if (Number(invoice.vat_amount || 0) > 0) {
    if (!settings.default_vat_payable_id) throw new Error("حساب ضريبة القيمة المضافة المستحقة غير محدد.");
    lines.push({ account_id: String(settings.default_vat_payable_id), debit: 0, credit: Number(invoice.vat_amount), description: String(invoice.invoice_no) });
  }
  return createJournalEntry(admin, {
    orgId,
    userId,
    entryDate: String(invoice.invoice_date),
    description: `إصدار فاتورة ${invoice.invoice_no}`,
    sourceModule: "invoice",
    sourceId: String(invoice.id),
    status: "posted",
    lines,
  });
}

async function buildExpenseJournal(admin: ReturnType<typeof createAdminClient>, orgId: string, expense: Record<string, unknown>, userId: string, paidImmediately = false) {
  const settings = await getAccountingSettings(admin, orgId);
  const category = String(expense.category_account_id || "");
  if (!category) throw new Error("حساب تصنيف المصروف مطلوب.");
  const creditAccount = paidImmediately
    ? String(expense.payment_account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || "")
    : String(settings?.default_accounts_payable_id || "");
  if (!creditAccount) throw new Error("حساب الدفع أو الذمم الدائنة غير محدد.");
  const lines: JournalLineInput[] = [
    { account_id: category, debit: Number(expense.amount_before_vat || 0), credit: 0, description: String(expense.description) },
  ];
  if (Number(expense.vat_amount || 0) > 0) {
    if (!settings?.default_vat_receivable_id) throw new Error("حساب ضريبة القيمة المضافة القابلة للاسترداد غير محدد.");
    lines.push({ account_id: String(settings.default_vat_receivable_id), debit: Number(expense.vat_amount || 0), credit: 0, description: String(expense.description) });
  }
  lines.push({ account_id: creditAccount, debit: 0, credit: Number(expense.total_amount || 0), description: String(expense.description) });
  return createJournalEntry(admin, {
    orgId,
    userId,
    entryDate: String(expense.expense_date),
    description: `اعتماد مصروف ${expense.expense_no}`,
    sourceModule: paidImmediately ? "expense_paid" : "expense",
    sourceId: String(expense.id),
    status: "posted",
    lines,
  });
}

async function postPaymentJournal(admin: ReturnType<typeof createAdminClient>, orgId: string, payment: Record<string, unknown>, userId: string) {
  const settings = await getAccountingSettings(admin, orgId);
  const bank = String(payment.account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || "");
  if (!bank) throw new Error("حساب النقدية أو البنك غير محدد.");

  let otherAccount = "";
  if (payment.type === "customer_receipt") otherAccount = String(settings?.default_accounts_receivable_id || "");
  if (payment.type === "vendor_payment") otherAccount = String(settings?.default_accounts_payable_id || "");
  if (payment.type === "payroll_payment") otherAccount = String(settings?.default_salary_payable_id || "");
  if (payment.type === "employee_advance") otherAccount = String(settings?.default_employee_advances_id || "");
  if (payment.type === "manual") otherAccount = String(payment.counterpart_account_id || "");
  if (!otherAccount) throw new Error("إعدادات الحساب المقابل للدفعة غير مكتملة.");

  if (bank === otherAccount) throw new Error("Payment bank/cash account and counterpart account must be different.");

  const inbound = payment.direction === "inbound";
  const description = requireText(payment.description, requireText(payment.notes, String(payment.payment_no)));
  const costCenterId = payment.cost_center_id ? String(payment.cost_center_id) : null;
  const lines: JournalLineInput[] = inbound
    ? [
        { account_id: bank, debit: Number(payment.amount || 0), credit: 0, description, cost_center_id: costCenterId },
        { account_id: otherAccount, debit: 0, credit: Number(payment.amount || 0), description, cost_center_id: costCenterId },
      ]
    : [
        { account_id: otherAccount, debit: Number(payment.amount || 0), credit: 0, description, cost_center_id: costCenterId },
        { account_id: bank, debit: 0, credit: Number(payment.amount || 0), description, cost_center_id: costCenterId },
      ];

  return createJournalEntry(admin, {
    orgId,
    userId,
    entryDate: String(payment.payment_date),
    description: `ترحيل دفعة ${payment.payment_no}`,
    sourceModule: `payment_${payment.type}`,
    sourceId: String(payment.id),
    status: "posted",
    lines,
  });
}

async function getPayrollAccountingStatus(admin: ReturnType<typeof createAdminClient>, orgId: string, monthInput: unknown) {
  const month = normalizeMonth(monthInput);
  const sourceId = payrollSourceId(orgId, month);

  const payslipsResult = await db(admin)
    .from("payslips")
    .select("id, net_salary, deductions_details, status")
    .eq("org_id", orgId)
    .eq("month", month);
  if (payslipsResult.error) throw new Error(payslipsResult.error.message);

  const payslips = (payslipsResult.data || []) as Record<string, unknown>[];
  const totalNet = roundMoney(payslips.reduce((sum, row) => sum + Number(row.net_salary || 0), 0));
  const advanceDeductions = sumAdvanceDeductions(payslips);

  const sourcePosting = await db(admin)
    .from("accounting_source_postings")
    .select("journal_entry_id, status")
    .eq("organization_id", orgId)
    .eq("source_module", "payroll")
    .eq("source_id", sourceId)
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
    .eq("payroll_id", sourceId)
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
  const status = payment?.status === "posted"
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
    payslip_count: payslips.length,
    total_net: totalNet,
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

export async function GET(request: NextRequest, context: RouteContext) {
  const parts = segments(context);
  const auth = await requireAccountingAccess(actionFor("GET", parts));
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();

  try {
    const { dateFrom, dateTo, asOf } = getQueryDates(request);
    if (parts[0] === "dashboard") return json(await getAccountingDashboard(admin, auth.orgId, dateFrom, dateTo));
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
    }
    return message("مسار محاسبي غير مدعوم.", 404);
  } catch (error) {
    return message(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const parts = segments(context);
  const auth = await requireAccountingAccess(actionFor("POST", parts));
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));

  try {
    if (parts[0] === "init-defaults") {
      await initializeAccountingDefaults(admin, auth.orgId, auth.user.id);
      return json({ ok: true });
    }

    if (parts[0] === "accounts") {
      const values = {
        organization_id: auth.orgId,
        code: requireText(body.code),
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        type: requireText(body.type),
        subtype: requireText(body.subtype) || null,
        parent_id: body.parent_id || null,
        normal_balance: requireText(body.normal_balance, body.type === "asset" || body.type === "expense" ? "debit" : "credit"),
        description: requireText(body.description) || null,
        created_by: auth.user.id,
      };
      if (!values.code || !values.name_ar) return message("رقم الحساب والاسم العربي مطلوبان.", 400);
      const result = await db(admin).from("accounting_accounts").insert(values).select("*").single();
      if (result.error) throw new Error(result.error.message);
      await audit(admin, auth.orgId, auth.user.id, "accounting.account_created", "accounting_accounts", result.data.id, values);
      return json(result.data, 201);
    }

    if (parts[0] === "cost-centers") {
      const values = {
        organization_id: auth.orgId,
        code: requireText(body.code),
        name_ar: requireText(body.name_ar),
        name_en: requireText(body.name_en) || null,
        type: requireText(body.type, "custom"),
        reference_id: body.reference_id || null,
        created_by: auth.user.id,
      };
      const result = await db(admin).from("accounting_cost_centers").insert(values).select("*").single();
      if (result.error) throw new Error(result.error.message);
      await audit(admin, auth.orgId, auth.user.id, "accounting.cost_center_created", "accounting_cost_centers", result.data.id, values);
      return json(result.data, 201);
    }

    if (parts[0] === "vendors" || parts[0] === "customers") {
      const table = parts[0] === "vendors" ? "accounting_vendors" : "accounting_customers";
      const values: Record<string, unknown> = {
        organization_id: auth.orgId,
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
        created_by: auth.user.id,
      };
      if (table === "accounting_vendors") {
        values.bank_name = requireText(body.bank_name) || null;
        values.iban = requireText(body.iban) || null;
      } else {
        values.sales_company_id = body.sales_company_id || null;
      }
      const result = await db(admin).from(table).insert(values).select("*").single();
      if (result.error) throw new Error(result.error.message);
      if (table === "accounting_customers" && values.sales_company_id) {
        const companyUpdate = await db(admin)
          .from("sales_companies")
          .update({ accounting_customer_id: result.data.id })
          .eq("organization_id", auth.orgId)
          .eq("id", values.sales_company_id);
        if (companyUpdate.error) throw new Error(companyUpdate.error.message);
      }
      await audit(admin, auth.orgId, auth.user.id, `accounting.${parts[0].slice(0, -1)}_created`, table, result.data.id, values);
      return json(result.data, 201);
    }

    if (parts[0] === "journal-entries" && parts[1] && parts[2] === "post") {
      return json(await postJournalEntry(admin, auth.orgId, parts[1], auth.user.id));
    }
    if (parts[0] === "journal-entries" && parts[1] && parts[2] === "reverse") {
      return json(await reverseJournalEntry(admin, auth.orgId, parts[1], auth.user.id, requireText(body.reason) || undefined));
    }
    if (parts[0] === "journal-entries") {
      const lines = Array.isArray(body.lines) ? body.lines as JournalLineInput[] : [];
      return json(await createJournalEntry(admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        entryDate: parseDate(body.entry_date),
        description: requireText(body.description),
        notes: requireText(body.notes) || null,
        status: body.status === "pending_approval" ? "pending_approval" : "draft",
        lines,
      }), 201);
    }

    if (parts[0] === "expenses" && parts[1] && parts[2] === "approve") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (!["draft", "pending_approval"].includes(String(expense.status))) return message("لا يمكن اعتماد هذا المصروف.", 400);
      const journal = await buildExpenseJournal(admin, auth.orgId, expense, auth.user.id, Boolean(body.paid_immediately));
      const next = await updateRecord(admin, "accounting_expenses", auth.orgId, parts[1], {
        status: body.paid_immediately ? "paid" : "approved",
        paid_status: body.paid_immediately ? "paid" : "unpaid",
        approved_by: auth.user.id,
        approved_at: new Date().toISOString(),
        paid_at: body.paid_immediately ? new Date().toISOString() : null,
        journal_entry_id: journal.id,
      });
      await audit(admin, auth.orgId, auth.user.id, "accounting.expense_approved", "accounting_expenses", parts[1], next);
      await notifyFinance(admin, auth.orgId, "تم اعتماد مصروف", String(expense.description), `/accounting/expenses/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "expenses" && parts[1] && parts[2] === "reject") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (!["draft", "pending_approval"].includes(String(expense.status))) return message("يمكن رفض المصروفات المسودة أو بانتظار الاعتماد فقط.", 400);
      const next = await updateRecord(admin, "accounting_expenses", auth.orgId, parts[1], {
        status: "rejected",
        rejection_reason: requireText(body.reason) || null,
      });
      await audit(admin, auth.orgId, auth.user.id, "accounting.expense_rejected", "accounting_expenses", parts[1], next);
      await notifyFinance(admin, auth.orgId, "تم رفض مصروف", `${String(expense.description || "")}${next.rejection_reason ? ` - ${next.rejection_reason}` : ""}`, `/accounting/expenses/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "expenses" && parts[1] && parts[2] === "pay") {
      const expense = await getRecord(admin, "accounting_expenses", auth.orgId, parts[1]);
      if (String(expense.status) !== "approved") return message("يمكن سداد المصروفات المعتمدة وغير المسددة فقط.", 400);
      const paidResult = await db(admin)
        .from("accounting_payments")
        .select("amount")
        .eq("organization_id", auth.orgId)
        .eq("expense_id", parts[1])
        .eq("status", "posted");
      if (paidResult.error) throw new Error(paidResult.error.message);
      const alreadyPaid = roundMoney(((paidResult.data || []) as Record<string, unknown>[]).reduce((sum, row) => sum + Number(row.amount || 0), 0));
      const unpaidAmount = roundMoney(Number(expense.total_amount || 0) - alreadyPaid);
      const amount = roundMoney(body.amount || unpaidAmount);
      if (amount <= 0 || amount > unpaidAmount) return message("مبلغ السداد يتجاوز الرصيد غير المسدد للمصروف.", 400);
      const settings = await getAccountingSettings(admin, auth.orgId);
      const paymentNo = await generateAccountingNumber(admin, "accounting_payments", auth.orgId, String(settings?.payment_prefix || "PAY"));
      const paymentResult = await db(admin).from("accounting_payments").insert({
        organization_id: auth.orgId,
        payment_no: paymentNo,
        payment_date: parseDate(body.payment_date),
        type: "vendor_payment",
        direction: "outbound",
        amount,
        account_id: body.account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || null,
        vendor_id: expense.vendor_id || null,
        expense_id: parts[1],
        method: requireText(body.method) || null,
        created_by: auth.user.id,
      }).select("*").single();
      if (paymentResult.error) throw new Error(paymentResult.error.message);
      const journal = await postPaymentJournal(admin, auth.orgId, paymentResult.data, auth.user.id);
      await updateRecord(admin, "accounting_payments", auth.orgId, paymentResult.data.id, { status: "posted", posted_by: auth.user.id, posted_at: new Date().toISOString(), journal_entry_id: journal.id });
      const remaining = roundMoney(unpaidAmount - amount);
      const next = await updateRecord(admin, "accounting_expenses", auth.orgId, parts[1], {
        status: remaining === 0 ? "paid" : "approved",
        paid_status: remaining === 0 ? "paid" : "partially_paid",
        paid_at: remaining === 0 ? new Date().toISOString() : null,
      });
      await audit(admin, auth.orgId, auth.user.id, "accounting.expense_paid", "accounting_expenses", parts[1], next);
      await notifyFinance(admin, auth.orgId, "تم سداد مصروف", `${String(expense.expense_no || "")} - ${amount}`, `/accounting/expenses/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "expenses") {
      const settings = await getAccountingSettings(admin, auth.orgId);
      const expenseNo = await generateAccountingNumber(admin, "accounting_expenses", auth.orgId, String(settings?.expense_prefix || "EXP"), new Date(parseDate(body.expense_date)));
      const amount = roundMoney(body.amount_before_vat);
      const vat = roundMoney(body.vat_amount);
      const values = {
        organization_id: auth.orgId,
        expense_no: expenseNo,
        vendor_id: body.vendor_id || null,
        employee_id: body.employee_id || null,
        expense_date: parseDate(body.expense_date),
        category_account_id: body.category_account_id || null,
        payment_account_id: body.payment_account_id || null,
        cost_center_id: body.cost_center_id || null,
        description: requireText(body.description),
        amount_before_vat: amount,
        vat_amount: vat,
        total_amount: roundMoney(amount + vat),
        status: body.status === "pending_approval" ? "pending_approval" : "draft",
        payment_method: requireText(body.payment_method) || null,
        attachment_url: requireText(body.attachment_url) || null,
        created_by: auth.user.id,
      };
      const result = await db(admin).from("accounting_expenses").insert(values).select("*").single();
      if (result.error) throw new Error(result.error.message);
      await audit(admin, auth.orgId, auth.user.id, "accounting.expense_created", "accounting_expenses", result.data.id, values);
      await notifyFinance(admin, auth.orgId, "مصروف جديد", values.description, `/accounting/expenses/${result.data.id}`);
      return json(result.data, 201);
    }

    if (parts[0] === "invoices" && parts[1] && parts[2] === "issue") {
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1], "*, lines:accounting_invoice_lines(*)");
      if (invoice.status !== "draft") return message("يمكن إصدار الفواتير المسودة فقط.", 400);
      const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
      if (lines.length === 0) return message("لا يمكن إصدار فاتورة بدون بنود.", 400);
      const journal = await buildInvoiceJournal(admin, auth.orgId, invoice, auth.user.id);
      const next = await updateRecord(admin, "accounting_invoices", auth.orgId, parts[1], {
        status: "issued",
        issued_by: auth.user.id,
        issued_at: new Date().toISOString(),
        journal_entry_id: journal.id,
      });
      await audit(admin, auth.orgId, auth.user.id, "accounting.invoice_issued", "accounting_invoices", parts[1], next);
      await notifyFinance(admin, auth.orgId, "تم إصدار فاتورة", String(invoice.invoice_no), `/accounting/invoices/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "invoices" && parts[1] && parts[2] === "record-payment") {
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, parts[1]);
      if (!["issued", "partially_paid"].includes(String(invoice.status))) return message("يمكن تسجيل السداد للفواتير الصادرة فقط.", 400);
      const settings = await getAccountingSettings(admin, auth.orgId);
      const amount = roundMoney(body.amount || invoice.balance_due);
      if (amount <= 0 || amount > Number(invoice.balance_due || 0)) return message("مبلغ السداد غير صحيح.", 400);
      const paymentNo = await generateAccountingNumber(admin, "accounting_payments", auth.orgId, String(settings?.payment_prefix || "PAY"));
      const paymentResult = await db(admin).from("accounting_payments").insert({
        organization_id: auth.orgId,
        payment_no: paymentNo,
        payment_date: parseDate(body.payment_date),
        type: "customer_receipt",
        direction: "inbound",
        amount,
        account_id: body.account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || null,
        customer_id: invoice.customer_id || null,
        invoice_id: parts[1],
        method: requireText(body.method) || null,
        created_by: auth.user.id,
      }).select("*").single();
      if (paymentResult.error) throw new Error(paymentResult.error.message);
      const journal = await postPaymentJournal(admin, auth.orgId, paymentResult.data, auth.user.id);
      await updateRecord(admin, "accounting_payments", auth.orgId, paymentResult.data.id, { status: "posted", posted_by: auth.user.id, posted_at: new Date().toISOString(), journal_entry_id: journal.id });
      const paidAmount = roundMoney(Number(invoice.paid_amount || 0) + amount);
      const balanceDue = roundMoney(Number(invoice.total_amount || 0) - paidAmount);
      const next = await updateRecord(admin, "accounting_invoices", auth.orgId, parts[1], { paid_amount: paidAmount, balance_due: balanceDue, status: balanceDue === 0 ? "paid" : "partially_paid" });
      await audit(admin, auth.orgId, auth.user.id, "accounting.payment_received", "accounting_payments", paymentResult.data.id, { invoice_id: parts[1], amount });
      await notifyFinance(admin, auth.orgId, "تم تسجيل سداد فاتورة", `${String(invoice.invoice_no || "")} - ${amount}`, `/accounting/invoices/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "invoices") {
      const settings = await getAccountingSettings(admin, auth.orgId);
      const invoiceNo = await generateAccountingNumber(admin, "accounting_invoices", auth.orgId, String(settings?.invoice_prefix || "INV"), new Date(parseDate(body.invoice_date)));
      const invoiceResult = await db(admin).from("accounting_invoices").insert({
        organization_id: auth.orgId,
        customer_id: body.customer_id || null,
        invoice_no: invoiceNo,
        invoice_date: parseDate(body.invoice_date),
        due_date: body.due_date || null,
        source_module: requireText(body.source_module, "manual"),
        source_id: body.source_id || null,
        notes: requireText(body.notes) || null,
        created_by: auth.user.id,
      }).select("*").single();
      if (invoiceResult.error) throw new Error(invoiceResult.error.message);
      await createOrUpdateInvoiceLines(admin, auth.orgId, invoiceResult.data.id, Array.isArray(body.lines) ? body.lines : []);
      const invoice = await getRecord(admin, "accounting_invoices", auth.orgId, invoiceResult.data.id, "*, lines:accounting_invoice_lines(*)");
      await audit(admin, auth.orgId, auth.user.id, "accounting.invoice_created", "accounting_invoices", invoiceResult.data.id, { invoice_no: invoiceNo });
      return json(invoice, 201);
    }

    if (parts[0] === "payments" && parts[1] && parts[2] === "post") {
      const payment = await getRecord(admin, "accounting_payments", auth.orgId, parts[1]);
      if (payment.status !== "draft") return message("يمكن ترحيل الدفعات المسودة فقط.", 400);
      const journal = await postPaymentJournal(admin, auth.orgId, payment, auth.user.id);
      const next = await updateRecord(admin, "accounting_payments", auth.orgId, parts[1], { status: "posted", posted_by: auth.user.id, posted_at: new Date().toISOString(), journal_entry_id: journal.id });
      await audit(admin, auth.orgId, auth.user.id, "accounting.payment_posted", "accounting_payments", parts[1], next);
      await notifyFinance(admin, auth.orgId, payment.type === "manual" ? "تم ترحيل دفعة يدوية" : "تم ترحيل دفعة", String(payment.description || payment.payment_no || ""), `/accounting/payments/${parts[1]}`);
      return json(next);
    }
    if (parts[0] === "payments") {
      const settings = await getAccountingSettings(admin, auth.orgId);
      const paymentNo = await generateAccountingNumber(admin, "accounting_payments", auth.orgId, String(settings?.payment_prefix || "PAY"), new Date(parseDate(body.payment_date)));
      const paymentType = requireText(body.type, "manual");
      const direction = requireText(body.direction, "outbound");
      const amount = roundMoney(body.amount);
      const accountId = paymentType === "manual"
        ? requireText(body.account_id)
        : body.account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || null;
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
      const values = {
        organization_id: auth.orgId,
        payment_no: paymentNo,
        payment_date: parseDate(body.payment_date),
        type: paymentType,
        direction,
        amount,
        account_id: accountId,
        counterpart_account_id: counterpartAccountId,
        cost_center_id: body.cost_center_id || null,
        customer_id: body.customer_id || null,
        vendor_id: body.vendor_id || null,
        employee_id: body.employee_id || null,
        invoice_id: body.invoice_id || null,
        expense_id: body.expense_id || null,
        advance_request_id: body.advance_request_id || null,
        payroll_id: body.payroll_id || null,
        description,
        reference_no: requireText(body.reference_no) || null,
        method: requireText(body.method) || null,
        notes: requireText(body.notes) || null,
        attachment_url: requireText(body.attachment_url) || null,
        created_by: auth.user.id,
      };
      const result = await db(admin).from("accounting_payments").insert(values).select("*").single();
      if (result.error) throw new Error(result.error.message);
      await audit(admin, auth.orgId, auth.user.id, "accounting.payment_created", "accounting_payments", result.data.id, values);
      return json(result.data, 201);
    }

    if (parts[0] === "payroll" && parts[1] === "create-draft-entry") {
      const month = normalizeMonth(body.month);
      if (!month) return message("الشهر مطلوب.", 400);
      const settings = await getAccountingSettings(admin, auth.orgId);
      if (!settings?.default_salary_expense_id || !settings?.default_salary_payable_id) return message("إعدادات حسابات الرواتب غير مكتملة.", 400);
      const payslipsResult = await db(admin).from("payslips").select("*").eq("org_id", auth.orgId).eq("month", month);
      if (payslipsResult.error) throw new Error(payslipsResult.error.message);
      const payslips = (payslipsResult.data || []) as Record<string, unknown>[];
      if (payslips.length === 0) return message("لا توجد مسيرات رواتب لهذا الشهر.", 404);
      const totalNet = roundMoney(payslips.reduce((sum, row) => sum + Number(row.net_salary || 0), 0));
      const advanceDeductions = sumAdvanceDeductions(payslips);
      if (advanceDeductions > 0 && !settings.default_employee_advances_id) return message("Employee advances account is required before posting payroll advance deductions.", 400);
      const salaryCost = roundMoney(totalNet + advanceDeductions);
      const lines: JournalLineInput[] = [
        { account_id: String(settings.default_salary_expense_id), debit: salaryCost, credit: 0, description: `رواتب ${month}` },
        { account_id: String(settings.default_salary_payable_id), debit: 0, credit: salaryCost, description: `رواتب مستحقة ${month}` },
      ];
      if (advanceDeductions > 0) {
        lines.push(
          { account_id: String(settings.default_salary_payable_id), debit: advanceDeductions, credit: 0, description: `خصم سلف ${month}` },
          { account_id: String(settings.default_employee_advances_id), debit: 0, credit: advanceDeductions, description: `خصم سلف ${month}` },
        );
      }
      const payrollSource = requireText(body.payroll_id) || payrollSourceId(auth.orgId, month);
      const entry = await createJournalEntry(admin, {
        orgId: auth.orgId,
        userId: auth.user.id,
        entryDate: parseDate(month),
        description: `قيد رواتب ${month}`,
        sourceModule: "payroll",
        sourceId: payrollSource,
        status: "draft",
        lines,
      });
      await notifyFinance(admin, auth.orgId, "تم إنشاء مسودة قيد رواتب", `قيد رواتب ${month} جاهز للمراجعة.`, `/accounting/journal-entries/${entry.id}`);
      return json(entry, 201);
    }

    if (parts[0] === "payroll" && parts[1] === "record-payment") {
      const month = normalizeMonth(body.month);
      const status = await getPayrollAccountingStatus(admin, auth.orgId, month);
      if (status.status === "not_generated" || status.status === "draft_created") return message("يجب ترحيل قيد الرواتب قبل تسجيل السداد.", 400);
      if (status.payment_id) return message("تم تسجيل دفعة رواتب لهذا الشهر مسبقا.", 400);

      const settings = await getAccountingSettings(admin, auth.orgId);
      const amount = roundMoney(body.amount || status.total_net);
      const totalNet = roundMoney(status.total_net);
      if (amount <= 0 || amount !== totalNet) return message("مبلغ سداد الرواتب يجب أن يساوي صافي الرواتب المستحق للشهر.", 400);

      const paymentNo = await generateAccountingNumber(admin, "accounting_payments", auth.orgId, String(settings?.payment_prefix || "PAY"), new Date(parseDate(body.payment_date)));
      const paymentResult = await db(admin).from("accounting_payments").insert({
        organization_id: auth.orgId,
        payment_no: paymentNo,
        payment_date: parseDate(body.payment_date),
        type: "payroll_payment",
        direction: "outbound",
        amount,
        account_id: body.account_id || settings?.default_bank_account_id || settings?.default_cash_account_id || null,
        payroll_id: status.payroll_id,
        description: `سداد رواتب ${month}`,
        reference_no: requireText(body.reference_no) || null,
        method: requireText(body.method) || null,
        notes: requireText(body.notes) || null,
        created_by: auth.user.id,
      }).select("*").single();
      if (paymentResult.error) throw new Error(paymentResult.error.message);

      const journal = await postPaymentJournal(admin, auth.orgId, paymentResult.data, auth.user.id);
      const next = await updateRecord(admin, "accounting_payments", auth.orgId, paymentResult.data.id, {
        status: "posted",
        posted_by: auth.user.id,
        posted_at: new Date().toISOString(),
        journal_entry_id: journal.id,
      });

      const payslipUpdate = await db(admin)
        .from("payslips")
        .update({ status: "paid" })
        .eq("org_id", auth.orgId)
        .eq("month", month);
      if (payslipUpdate.error) throw new Error(payslipUpdate.error.message);

      await audit(admin, auth.orgId, auth.user.id, "accounting.payroll_paid", "accounting_payments", paymentResult.data.id, { month, amount });
      await notifyFinance(admin, auth.orgId, "تم سداد الرواتب", `تم تسجيل سداد رواتب ${month}.`, `/accounting/payments/${paymentResult.data.id}`);
      return json({ payment: next, journal, status: await getPayrollAccountingStatus(admin, auth.orgId, month) }, 201);
    }

    if (parts[0] === "sales" && parts[1] === "link-company-customer") {
      const companyId = requireText(body.company_id);
      const customerId = requireText(body.customer_id);
      if (!companyId || !customerId) return message("شركة المبيعات والعميل المحاسبي مطلوبان.", 400);

      const companyUpdate = await db(admin)
        .from("sales_companies")
        .update({ accounting_customer_id: customerId })
        .eq("organization_id", auth.orgId)
        .eq("id", companyId)
        .select("id, name, accounting_customer_id")
        .single();
      if (companyUpdate.error) throw new Error(companyUpdate.error.message);

      const customerUpdate = await db(admin)
        .from("accounting_customers")
        .update({ sales_company_id: companyId })
        .eq("organization_id", auth.orgId)
        .eq("id", customerId)
        .select("id, name_ar, sales_company_id")
        .single();
      if (customerUpdate.error) throw new Error(customerUpdate.error.message);

      await audit(admin, auth.orgId, auth.user.id, "accounting.sales_company_customer_linked", "sales_companies", companyId, { customer_id: customerId });
      return json({ company: companyUpdate.data, customer: customerUpdate.data });
    }

    if (parts[0] === "sales" && parts[1] === "create-invoice-from-log") {
      const logId = requireText(body.sales_log_id);
      const log = await getRecord(admin, "sales_logs", auth.orgId, logId.replace(/[^0-9a-f-]/gi, ""), "*").catch(async () => {
        const { data, error } = await db(admin).from("sales_logs").select("*").eq("organization_id", auth.orgId).eq("id", logId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("سجل المبيعات غير موجود.");
        return data;
      });
      const companyId = String(log.company_id || "");
      let customerId = requireText(body.customer_id);
      if (!customerId && companyId) {
        const companyResult = await db(admin)
          .from("sales_companies")
          .select("accounting_customer_id")
          .eq("organization_id", auth.orgId)
          .eq("id", companyId)
          .maybeSingle();
        if (companyResult.error) throw new Error(companyResult.error.message);
        customerId = requireText(companyResult.data?.accounting_customer_id);
      }
      if (!customerId && companyId) {
        const customerResult = await db(admin)
          .from("accounting_customers")
          .select("id")
          .eq("organization_id", auth.orgId)
          .eq("sales_company_id", companyId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (customerResult.error) throw new Error(customerResult.error.message);
        customerId = requireText(customerResult.data?.id);
      }
      if (!customerId) return message("اختر العميل المرتبط بسجل المبيعات.", 400);
      const existingInvoice = await db(admin)
        .from("accounting_invoices")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("source_module", "sales_log")
        .eq("source_id", logId)
        .limit(1)
        .maybeSingle();
      if (existingInvoice.error) throw new Error(existingInvoice.error.message);
      if (existingInvoice.data?.id) return message("تم إنشاء فاتورة لهذا السجل مسبقا.", 400);
      const items = Array.isArray(log.items) ? log.items as Record<string, unknown>[] : [];
      const productIds = Array.from(new Set(items.map((item) => String(item.product_id || "")).filter(Boolean)));
      const revenueByProduct = new Map<string, string | null>();
      if (productIds.length > 0) {
        const productsResult = await db(admin)
          .from("sales_products")
          .select("id, revenue_account_id")
          .eq("organization_id", auth.orgId)
          .in("id", productIds);
        if (productsResult.error) throw new Error(productsResult.error.message);
        for (const product of (productsResult.data || []) as Record<string, unknown>[]) {
          revenueByProduct.set(String(product.id), product.revenue_account_id ? String(product.revenue_account_id) : null);
        }
      }
      body.customer_id = customerId;
      body.invoice_date = log.log_date || new Date().toISOString().slice(0, 10);
      body.lines = items.map((item) => ({
        description_ar: item.product_name,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        revenue_account_id: revenueByProduct.get(String(item.product_id || "")) || null,
      }));
      const settings = await getAccountingSettings(admin, auth.orgId);
      const invoiceNo = await generateAccountingNumber(admin, "accounting_invoices", auth.orgId, String(settings?.invoice_prefix || "INV"));
      const invoiceResult = await db(admin).from("accounting_invoices").insert({
        organization_id: auth.orgId,
        customer_id: customerId,
        invoice_no: invoiceNo,
        invoice_date: parseDate(body.invoice_date),
        source_module: "sales_log",
        source_id: logId,
        notes: `فاتورة من سجل مبيعات ${logId}`,
        created_by: auth.user.id,
      }).select("*").single();
      if (invoiceResult.error) throw new Error(invoiceResult.error.message);
      await createOrUpdateInvoiceLines(admin, auth.orgId, invoiceResult.data.id, body.lines);
      await audit(admin, auth.orgId, auth.user.id, "accounting.sales_invoice_generated", "accounting_invoices", invoiceResult.data.id, { sales_log_id: logId, invoice_no: invoiceNo });
      await notifyFinance(admin, auth.orgId, "تم إنشاء فاتورة من المبيعات", String(invoiceNo), `/accounting/invoices/${invoiceResult.data.id}`);
      return json(await getRecord(admin, "accounting_invoices", auth.orgId, invoiceResult.data.id, "*, lines:accounting_invoice_lines(*)"), 201);
    }

    return message("مسار محاسبي غير مدعوم.", 404);
  } catch (error) {
    return message(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const parts = segments(context);
  const auth = await requireAccountingAccess(actionFor("PATCH", parts));
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const body = await request.json().catch(() => ({}));

  try {
    if (parts[0] === "settings") {
      const values = { ...body, organization_id: auth.orgId };
      const result = await db(admin).from("accounting_settings").upsert(values, { onConflict: "organization_id" }).select("*").single();
      if (result.error) throw new Error(result.error.message);
      await audit(admin, auth.orgId, auth.user.id, "accounting.settings_updated", "accounting_settings", result.data.id, body);
      await notifyFinance(admin, auth.orgId, "تم تحديث إعدادات المحاسبة", "تم تعديل الحسابات أو الترقيم الافتراضي لوحدة المالية.", "/accounting/settings");
      return json(result.data);
    }

    if (parts[0] === "journal-entries") {
      const id = parts[1] || body.id;
      if (!id) return message("معرف القيد مطلوب.", 400);
      const current = await getRecord(admin, "accounting_journal_entries", auth.orgId, id);
      if (current.status !== "draft") return message("يمكن تعديل أو إرسال القيود المسودة فقط.", 400);

      if (Array.isArray(body.lines)) {
        const updated = await updateDraftJournalEntry(admin, {
          orgId: auth.orgId,
          userId: auth.user.id,
          entryId: id,
          entryDate: parseDate(body.entry_date || current.entry_date),
          description: requireText(body.description, String(current.description || "")),
          notes: body.notes === undefined ? (current.notes as string | null) : requireText(body.notes) || null,
          lines: body.lines as JournalLineInput[],
        });

        if (body.status !== "pending_approval") return json(updated);
      } else if (body.status !== "pending_approval") {
        return message("أرسل سطور القيد للتعديل أو status=pending_approval للإرسال للاعتماد.", 400);
      }

      await updateRecord(admin, "accounting_journal_entries", auth.orgId, id, {
        status: "pending_approval",
        updated_at: new Date().toISOString(),
      });
      await audit(admin, auth.orgId, auth.user.id, "accounting.journal_submitted", "accounting_journal_entries", id, {
        previous_status: current.status,
        status: "pending_approval",
      });
      await notifyFinance(admin, auth.orgId, "قيد محاسبي بانتظار الاعتماد", String(current.description || ""), `/accounting/journal-entries/${id}`);
      return json(await getRecord(admin, "accounting_journal_entries", auth.orgId, id, "*, lines:accounting_journal_lines(*, account:account_id(*), cost_center:cost_center_id(*))"));
    }

    const map: Record<string, string> = {
      accounts: "accounting_accounts",
      "cost-centers": "accounting_cost_centers",
      vendors: "accounting_vendors",
      customers: "accounting_customers",
      expenses: "accounting_expenses",
      invoices: "accounting_invoices",
      payments: "accounting_payments",
    };
    const table = map[parts[0] || ""];
    const id = parts[1] || body.id;
    if (!table || !id) return message("مسار التحديث غير مدعوم.", 404);

    if (table === "accounting_invoices") {
      const current = await getRecord(admin, table, auth.orgId, id);
      if (current.status !== "draft") return message("يمكن تعديل الفواتير المسودة فقط.", 400);
    }
    if (table === "accounting_expenses") {
      const current = await getRecord(admin, table, auth.orgId, id);
      if (["paid", "rejected", "cancelled"].includes(String(current.status))) return message("لا يمكن تعديل هذا المصروف.", 400);
    }
    if (table === "accounting_payments") {
      const current = await getRecord(admin, table, auth.orgId, id);
      if (current.status !== "draft") return message("يمكن تعديل الدفعات المسودة فقط.", 400);
    }

    const values = { ...body };
    if (table === "accounting_accounts") values.updated_by = auth.user.id;
    delete values.id;
    delete values.lines;
    const data = await updateRecord(admin, table, auth.orgId, id, values);

    if (table === "accounting_invoices" && Array.isArray(body.lines)) {
      await createOrUpdateInvoiceLines(admin, auth.orgId, id, body.lines);
      await audit(admin, auth.orgId, auth.user.id, `accounting.${parts[0]}_updated`, table, id, values);
      return json(await getRecord(admin, table, auth.orgId, id, "*, lines:accounting_invoice_lines(*)"));
    }

    await audit(admin, auth.orgId, auth.user.id, `accounting.${parts[0]}_updated`, table, id, values);
    if (["accounting_accounts", "accounting_cost_centers", "accounting_vendors", "accounting_customers"].includes(table)) {
      await notifyFinance(admin, auth.orgId, "تم تحديث بيانات محاسبية", `تم تحديث ${parts[0]}.`, `/accounting/${parts[0]}`);
    }
    return json(data);
  } catch (error) {
    return message(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const parts = segments(context);
  const auth = await requireAccountingAccess("manage");
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const id = parts[1] || request.nextUrl.searchParams.get("id") || "";

  try {
    if (!id) return message("معرف السجل مطلوب.", 400);
    if (parts[0] === "journal-entries") {
      const entry = await getRecord(admin, "accounting_journal_entries", auth.orgId, id);
      if (["posted", "reversed"].includes(String(entry.status))) return message("لا يمكن حذف أو إلغاء قيد مرحل.", 400);
      const next = await updateRecord(admin, "accounting_journal_entries", auth.orgId, id, { status: "cancelled" });
      await audit(admin, auth.orgId, auth.user.id, "accounting.journal_cancelled", "accounting_journal_entries", id, next);
      return json(next);
    }
    const softDeleteTables: Record<string, string> = {
      accounts: "accounting_accounts",
      "cost-centers": "accounting_cost_centers",
      vendors: "accounting_vendors",
      customers: "accounting_customers",
    };
    const table = softDeleteTables[parts[0] || ""];
    if (!table) return message("مسار الحذف غير مدعوم.", 404);
    const data = await updateRecord(admin, table, auth.orgId, id, { is_active: false });
    await audit(admin, auth.orgId, auth.user.id, `accounting.${parts[0]}_deactivated`, table, id, data);
    await notifyFinance(admin, auth.orgId, "تم تعطيل سجل محاسبي", `تم تعطيل ${parts[0]}.`, `/accounting/${parts[0]}`);
    return json(data);
  } catch (error) {
    return message(error);
  }
}
