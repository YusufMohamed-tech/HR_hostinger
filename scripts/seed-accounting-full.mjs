import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const uuid = () => crypto.randomUUID();

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startStr, endStr) {
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  return new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ───── Main ─────
async function main() {
  console.log("🏦 Seeding full accounting test data...\n");

  // 1. Get organization
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();

  if (orgErr || !org) {
    console.error("Organization not found:", orgSlug, orgErr?.message);
    process.exit(1);
  }
  const orgId = org.id;
  console.log(`✓ Organization: ${orgSlug} (${orgId})`);

  // 2. Get a user for created_by
  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .limit(5);

  const adminMember = members?.find((m) => m.role === "Admin" || m.role === "Finance_Manager") || members?.[0];
  if (!adminMember) {
    console.error("No org members found");
    process.exit(1);
  }
  const userId = adminMember.user_id;
  console.log(`✓ User: ${userId}`);

  // 3. Create Chart of Accounts
  console.log("\n📋 Creating Chart of Accounts...");
  const accounts = await seedAccounts(orgId, userId);
  console.log(`  ✓ ${Object.keys(accounts).length} accounts created`);

  // 4. Create Cost Centers
  console.log("\n🏢 Creating Cost Centers...");
  const costCenters = await seedCostCenters(orgId, userId);
  console.log(`  ✓ ${costCenters.length} cost centers created`);

  // 5. Create Customers
  console.log("\n👥 Creating Customers...");
  const customers = await seedCustomers(orgId, userId);
  console.log(`  ✓ ${customers.length} customers created`);

  // 6. Create Vendors
  console.log("\n🏭 Creating Vendors...");
  const vendors = await seedVendors(orgId, userId);
  console.log(`  ✓ ${vendors.length} vendors created`);

  // 7. Create Tax Rates
  console.log("\n💰 Creating Tax Rates...");
  const taxRates = await seedTaxRates(orgId);
  console.log(`  ✓ ${taxRates.length} tax rates created`);

  // 8. Set up Accounting Settings
  console.log("\n⚙️  Setting up Accounting Settings...");
  await seedSettings(orgId, accounts);
  console.log("  ✓ Settings configured");

  // 9. Create Periods
  console.log("\n📅 Creating Accounting Periods...");
  const periods = await seedPeriods(orgId, userId);
  console.log(`  ✓ ${periods.length} periods created`);

  // 10. Create Journal Entries (posted)
  console.log("\n📖 Creating Journal Entries...");
  const journals = await seedJournalEntries(orgId, userId, accounts, costCenters);
  console.log(`  ✓ ${journals.length} journal entries created`);

  // 11. Create Invoices
  console.log("\n🧾 Creating Invoices...");
  const invoices = await seedInvoices(orgId, userId, accounts, customers, taxRates, costCenters);
  console.log(`  ✓ ${invoices.length} invoices created`);

  // 12. Create Expenses
  console.log("\n💳 Creating Expenses...");
  const expenses = await seedExpenses(orgId, userId, accounts, vendors, costCenters);
  console.log(`  ✓ ${expenses.length} expenses created`);

  // 13. Create Payments
  console.log("\n💵 Creating Payments...");
  const payments = await seedPayments(orgId, userId, accounts, customers, vendors, invoices, expenses);
  console.log(`  ✓ ${payments.length} payments created`);

  // 14. Create Budgets
  console.log("\n📊 Creating Budgets...");
  const budgets = await seedBudgets(orgId, userId, accounts, costCenters);
  console.log(`  ✓ ${budgets.length} budgets created`);

  console.log("\n✅ Accounting seed complete!");
}

// ─── Accounts ───
async function seedAccounts(orgId, userId) {
  const accountDefs = [
    // Assets
    { code: "1000", name_ar: "النقدية", name_en: "Cash", type: "asset", subtype: "cash", normal_balance: "debit" },
    { code: "1010", name_ar: "البنك الأهلي", name_en: "Al-Ahli Bank", type: "asset", subtype: "bank", normal_balance: "debit" },
    { code: "1020", name_ar: "بنك الراجحي", name_en: "Al-Rajhi Bank", type: "asset", subtype: "bank", normal_balance: "debit" },
    { code: "1100", name_ar: "الذمم المدينة", name_en: "Accounts Receivable", type: "asset", subtype: "receivable", normal_balance: "debit" },
    { code: "1200", name_ar: "سلف الموظفين", name_en: "Employee Advances", type: "asset", subtype: "current_asset", normal_balance: "debit" },
    { code: "1300", name_ar: "ضريبة القيمة المضافة المستحقة", name_en: "VAT Receivable (Input)", type: "asset", subtype: "current_asset", normal_balance: "debit" },
    { code: "1400", name_ar: "المخزون", name_en: "Inventory", type: "asset", subtype: "current_asset", normal_balance: "debit" },
    { code: "1500", name_ar: "الأصول الثابتة", name_en: "Fixed Assets", type: "asset", subtype: "fixed_asset", normal_balance: "debit" },
    { code: "1510", name_ar: "مجمع الإهلاك", name_en: "Accumulated Depreciation", type: "asset", subtype: "fixed_asset", normal_balance: "credit" },
    // Liabilities
    { code: "2000", name_ar: "الذمم الدائنة", name_en: "Accounts Payable", type: "liability", subtype: "payable", normal_balance: "credit" },
    { code: "2100", name_ar: "ضريبة القيمة المضافة المستحقة", name_en: "VAT Payable (Output)", type: "liability", subtype: "current_liability", normal_balance: "credit" },
    { code: "2200", name_ar: "الرواتب المستحقة", name_en: "Salaries Payable", type: "liability", subtype: "current_liability", normal_balance: "credit" },
    { code: "2300", name_ar: "مصاريف مستحقة", name_en: "Accrued Expenses", type: "liability", subtype: "current_liability", normal_balance: "credit" },
    { code: "2400", name_ar: "قرض بنكي", name_en: "Bank Loan", type: "liability", subtype: "long_term_liability", normal_balance: "credit" },
    { code: "2500", name_ar: "مكافأة نهاية الخدمة", name_en: "End of Service Benefits", type: "liability", subtype: "long_term_liability", normal_balance: "credit" },
    // Equity
    { code: "3000", name_ar: "رأس المال", name_en: "Share Capital", type: "equity", subtype: "capital", normal_balance: "credit" },
    { code: "3100", name_ar: "الأرباح المبقاة", name_en: "Retained Earnings", type: "equity", subtype: "retained_earnings", normal_balance: "credit" },
    // Revenue
    { code: "4000", name_ar: "إيرادات المبيعات", name_en: "Sales Revenue", type: "revenue", subtype: "operating_revenue", normal_balance: "credit" },
    { code: "4010", name_ar: "إيرادات الخدمات", name_en: "Service Revenue", type: "revenue", subtype: "operating_revenue", normal_balance: "credit" },
    { code: "4020", name_ar: "إيرادات الاستشارات", name_en: "Consulting Revenue", type: "revenue", subtype: "operating_revenue", normal_balance: "credit" },
    { code: "4100", name_ar: "إيرادات أخرى", name_en: "Other Income", type: "revenue", subtype: "other_income", normal_balance: "credit" },
    // Expenses
    { code: "5000", name_ar: "الرواتب والأجور", name_en: "Salaries & Wages", type: "expense", subtype: "payroll", normal_balance: "debit" },
    { code: "5010", name_ar: "بدلات الموظفين", name_en: "Employee Allowances", type: "expense", subtype: "payroll", normal_balance: "debit" },
    { code: "5020", name_ar: "مساهمة التأمينات", name_en: "GOSI Contribution", type: "expense", subtype: "payroll", normal_balance: "debit" },
    { code: "5100", name_ar: "إيجار المكتب", name_en: "Office Rent", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5110", name_ar: "المرافق", name_en: "Utilities", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5120", name_ar: "الاتصالات والإنترنت", name_en: "Telecom & Internet", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5130", name_ar: "مستلزمات مكتبية", name_en: "Office Supplies", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5200", name_ar: "مصاريف التسويق", name_en: "Marketing Expenses", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5210", name_ar: "مصاريف السفر", name_en: "Travel Expenses", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5220", name_ar: "تدريب وتطوير", name_en: "Training & Development", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5300", name_ar: "مصاريف الإهلاك", name_en: "Depreciation Expense", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5400", name_ar: "خدمات مهنية", name_en: "Professional Services", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
    { code: "5500", name_ar: "مصاريف بنكية", name_en: "Bank Charges", type: "expense", subtype: "other_expense", normal_balance: "debit" },
    { code: "5600", name_ar: "تأمينات", name_en: "Insurance", type: "expense", subtype: "operating_expense", normal_balance: "debit" },
  ];

  // Check existing accounts first
  const { data: existing } = await supabase
    .from("accounting_accounts")
    .select("id, code")
    .eq("organization_id", orgId);

  const existingMap = {};
  (existing || []).forEach((a) => { existingMap[a.code] = a.id; });

  const toInsert = [];
  const map = {};

  for (const a of accountDefs) {
    if (existingMap[a.code]) {
      map[a.code] = { ...a, id: existingMap[a.code] };
    } else {
      const row = { id: uuid(), organization_id: orgId, ...a, is_system: true, is_active: true, created_by: userId };
      toInsert.push(row);
      map[a.code] = row;
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("accounting_accounts").insert(toInsert);
    if (error) console.error("  Accounts insert error:", error.message);
  }

  return map;
}

// ─── Cost Centers ───
async function seedCostCenters(orgId, userId) {
  // Check existing cost centers
  const { data: existing } = await supabase
    .from("accounting_cost_centers")
    .select("id, code, name_ar, name_en, type")
    .eq("organization_id", orgId);

  if (existing && existing.length > 0) {
    console.log(`  (${existing.length} cost centers already exist, using them)`);
    return existing;
  }

  const defs = [
    { code: "CC-ADMIN", name_ar: "الإدارة العامة", name_en: "General Admin", type: "department" },
    { code: "CC-SALES", name_ar: "المبيعات", name_en: "Sales", type: "department" },
    { code: "CC-TECH", name_ar: "التقنية", name_en: "Technology", type: "department" },
    { code: "CC-HR", name_ar: "الموارد البشرية", name_en: "Human Resources", type: "department" },
    { code: "CC-MKT", name_ar: "التسويق", name_en: "Marketing", type: "department" },
    { code: "CC-OPS", name_ar: "العمليات", name_en: "Operations", type: "department" },
    { code: "CC-RYD", name_ar: "فرع الرياض", name_en: "Riyadh Branch", type: "branch" },
    { code: "CC-JED", name_ar: "فرع جدة", name_en: "Jeddah Branch", type: "branch" },
  ];

  const rows = defs.map((d) => ({
    id: uuid(),
    organization_id: orgId,
    ...d,
    is_active: true,
    created_by: userId,
  }));

  const { error } = await supabase.from("accounting_cost_centers").insert(rows);
  if (error) console.error("  Cost Centers error:", error.message);
  return rows;
}

// ─── Customers ───
async function seedCustomers(orgId, userId) {
  // Check existing
  const { data: existing } = await supabase
    .from("accounting_customers")
    .select("id, name_ar, name_en")
    .eq("organization_id", orgId);

  if (existing && existing.length >= 3) {
    console.log(`  (${existing.length} customers already exist, using them)`);
    return existing;
  }

  const defs = [
    { name_ar: "شركة الاتصالات السعودية", name_en: "STC", vat_number: "300000000000003", city: "الرياض" },
    { name_ar: "شركة موبايلي", name_en: "Mobily", vat_number: "300000000100003", city: "الرياض" },
    { name_ar: "شركة زين", name_en: "Zain KSA", vat_number: "300000000200003", city: "الرياض" },
    { name_ar: "مؤسسة التطوير التقني", name_en: "Tech Development Co.", vat_number: "310000000000003", city: "جدة" },
    { name_ar: "شركة البناء المتقدمة", name_en: "Advanced Construction", vat_number: "320000000000003", city: "الدمام" },
    { name_ar: "مجموعة الأغذية المتحدة", name_en: "United Foods Group", vat_number: "330000000000003", city: "الرياض" },
    { name_ar: "شركة المعدات الصناعية", name_en: "Industrial Equipment Co.", vat_number: "340000000000003", city: "جدة" },
    { name_ar: "الشركة السعودية للخدمات", name_en: "Saudi Services Co.", vat_number: "350000000000003", city: "الرياض" },
  ];

  const rows = defs.map((d) => ({
    id: uuid(),
    organization_id: orgId,
    ...d,
    country: "Saudi Arabia",
    payment_terms: pick(["net_15", "net_30", "net_45", "net_60"]),
    is_active: true,
    created_by: userId,
  }));

  const { error } = await supabase.from("accounting_customers").insert(rows);
  if (error) console.error("  Customers error:", error.message);
  return rows;
}

// ─── Vendors ───
async function seedVendors(orgId, userId) {
  // Check existing
  const { data: existing } = await supabase
    .from("accounting_vendors")
    .select("id, name_ar, name_en")
    .eq("organization_id", orgId);

  if (existing && existing.length >= 3) {
    console.log(`  (${existing.length} vendors already exist, using them)`);
    return existing;
  }

  const defs = [
    { name_ar: "شركة مايكروسوفت العربية", name_en: "Microsoft Arabia", city: "الرياض" },
    { name_ar: "شركة أمازون ويب سيرفيسز", name_en: "AWS Saudi", city: "الرياض" },
    { name_ar: "مؤسسة الفرسان للمقاولات", name_en: "Al-Fursan Contracting", city: "جدة" },
    { name_ar: "شركة التموين الذهبي", name_en: "Golden Catering Co.", city: "الرياض" },
    { name_ar: "مكتب المحامون المتحدون", name_en: "United Lawyers Firm", city: "الرياض" },
    { name_ar: "شركة التأمينات الوطنية", name_en: "National Insurance Co.", city: "جدة" },
    { name_ar: "مؤسسة الطباعة الحديثة", name_en: "Modern Print House", city: "الدمام" },
    { name_ar: "شركة أوراكل السعودية", name_en: "Oracle Saudi", city: "الرياض" },
  ];

  const rows = defs.map((d) => ({
    id: uuid(),
    organization_id: orgId,
    ...d,
    vat_number: `3${randomBetween(10000000000, 99999999999)}3`,
    country: "Saudi Arabia",
    payment_terms: pick(["net_30", "net_45", "net_60"]),
    is_active: true,
    created_by: userId,
  }));

  const { error } = await supabase.from("accounting_vendors").insert(rows);
  if (error) console.error("  Vendors error:", error.message);
  return rows;
}

// ─── Tax Rates ───
async function seedTaxRates(orgId) {
  // Check for existing tax rates
  const { data: existing } = await supabase
    .from("accounting_tax_rates")
    .select("id, rate")
    .eq("organization_id", orgId);

  if (existing && existing.length > 0) {
    return existing.map((t) => ({ ...t, organization_id: orgId }));
  }

  const rows = [
    { id: uuid(), organization_id: orgId, name_ar: "ضريبة القيمة المضافة 15%", name_en: "VAT 15%", rate: 15, is_default: true, is_active: true },
    { id: uuid(), organization_id: orgId, name_ar: "معفي من الضريبة", name_en: "Zero Rate", rate: 0, is_default: false, is_active: true },
  ];

  const { error } = await supabase.from("accounting_tax_rates").insert(rows);
  if (error) console.error("  Tax Rates error:", error.message);
  return rows;
}

// ─── Settings ───
async function seedSettings(orgId, accounts) {
  // Check if settings already exist
  const { data: existing } = await supabase
    .from("accounting_settings")
    .select("id")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (existing) {
    console.log("  (settings already exist, skipping)");
    return;
  }

  const settings = {
    id: uuid(),
    organization_id: orgId,
    default_cash_account_id: accounts["1000"].id,
    default_bank_account_id: accounts["1010"].id,
    default_accounts_receivable_id: accounts["1100"].id,
    default_accounts_payable_id: accounts["2000"].id,
    default_sales_revenue_id: accounts["4000"].id,
    default_vat_payable_id: accounts["2100"].id,
    default_vat_receivable_id: accounts["1300"].id,
    default_salary_expense_id: accounts["5000"].id,
    default_salary_payable_id: accounts["2200"].id,
    default_employee_advances_id: accounts["1200"].id,
    default_asset_account_id: accounts["1500"].id,
    default_depreciation_expense_id: accounts["5300"].id,
    default_accumulated_depreciation_id: accounts["1510"].id,
    fiscal_year_start_month: 1,
    invoice_prefix: "INV",
    expense_prefix: "EXP",
    journal_prefix: "JE",
    payment_prefix: "PAY",
  };

  const { error } = await supabase.from("accounting_settings").insert(settings);
  if (error) console.error("  Settings error:", error.message);
}

// ─── Periods ───
async function seedPeriods(orgId, userId) {
  // Check existing periods
  const { data: existing } = await supabase
    .from("accounting_periods")
    .select("id, name")
    .eq("organization_id", orgId);

  if (existing && existing.length > 0) {
    console.log(`  (${existing.length} periods already exist)`);
    // Re-open all closed periods so we can post journal entries
    const { error: reopenErr } = await supabase
      .from("accounting_periods")
      .update({ status: "open", closed_by: null, closed_at: null })
      .eq("organization_id", orgId)
      .eq("status", "closed");
    if (reopenErr) console.error("  Reopen periods error:", reopenErr.message);
    else console.log("  ✓ Re-opened closed periods for seeding");
    return existing;
  }

  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const startDate = `2025-${String(m).padStart(2, "0")}-01`;
    const endDate = m === 12 ? "2025-12-31" : `2025-${String(m + 1).padStart(2, "0")}-01`;
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);

    rows.push({
      id: uuid(),
      organization_id: orgId,
      name: `${m}/2025`,
      start_date: startDate,
      end_date: end.toISOString().slice(0, 10),
      status: "open",
    });
  }
  for (let m = 1; m <= 6; m++) {
    const startDate = `2026-${String(m).padStart(2, "0")}-01`;
    const endDate = m === 12 ? "2026-12-31" : `2026-${String(m + 1).padStart(2, "0")}-01`;
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);

    rows.push({
      id: uuid(),
      organization_id: orgId,
      name: `${m}/2026`,
      start_date: startDate,
      end_date: end.toISOString().slice(0, 10),
      status: "open",
    });
  }

  const { error } = await supabase.from("accounting_periods").insert(rows);
  if (error) console.error("  Periods error:", error.message);
  return rows;
}

// ─── Journal Entries (main GL postings) ───
async function seedJournalEntries(orgId, userId, accounts, costCenters) {
  const entries = [];
  // Get max existing journal number
  const { data: existingJE } = await supabase
    .from("accounting_journal_entries")
    .select("entry_no")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  let entryNum = 1;
  if (existingJE && existingJE.length > 0) {
    const match = existingJE[0].entry_no.match(/(\d+)/);
    if (match) entryNum = parseInt(match[1]) + 1;
  }

  // Opening balances
  const openingEntry = await createPostedJournal(orgId, userId, {
    entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
    entry_date: "2025-01-01",
    description: "قيود افتتاحية - رصيد أول المدة",
    source_module: "manual",
    lines: [
      { account_id: accounts["1000"].id, debit: 50000, credit: 0, description: "رصيد النقدية" },
      { account_id: accounts["1010"].id, debit: 500000, credit: 0, description: "رصيد البنك الأهلي" },
      { account_id: accounts["1020"].id, debit: 300000, credit: 0, description: "رصيد بنك الراجحي" },
      { account_id: accounts["1100"].id, debit: 150000, credit: 0, description: "ذمم مدينة سابقة" },
      { account_id: accounts["1500"].id, debit: 200000, credit: 0, description: "أصول ثابتة" },
      { account_id: accounts["2000"].id, debit: 0, credit: 80000, description: "ذمم دائنة سابقة" },
      { account_id: accounts["2400"].id, debit: 0, credit: 300000, description: "قرض بنكي" },
      { account_id: accounts["3000"].id, debit: 0, credit: 500000, description: "رأس المال" },
      { account_id: accounts["3100"].id, debit: 0, credit: 320000, description: "أرباح مبقاة" },
    ],
  });
  if (openingEntry) entries.push(openingEntry);

  // Monthly payroll entries (Jan 2025 - Jun 2026)
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2025-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 6; m++) months.push(`2026-${String(m).padStart(2, "0")}`);

  for (const month of months) {
    const baseSalary = randomBetween(85000, 105000);
    const allowances = randomBetween(20000, 35000);
    const gosi = Math.round(baseSalary * 0.0975);
    const total = baseSalary + allowances + gosi;
    const cc = pick(costCenters);

    const payrollEntry = await createPostedJournal(orgId, userId, {
      entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
      entry_date: `${month}-28`,
      description: `مسير رواتب شهر ${month}`,
      source_module: "payroll",
      lines: [
        { account_id: accounts["5000"].id, debit: baseSalary, credit: 0, description: "رواتب أساسية", cost_center_id: cc.id },
        { account_id: accounts["5010"].id, debit: allowances, credit: 0, description: "بدلات", cost_center_id: cc.id },
        { account_id: accounts["5020"].id, debit: gosi, credit: 0, description: "تأمينات اجتماعية", cost_center_id: cc.id },
        { account_id: accounts["2200"].id, debit: 0, credit: total, description: "الرواتب المستحقة" },
      ],
    });
    if (payrollEntry) entries.push(payrollEntry);

    // Payroll payment
    const paymentEntry = await createPostedJournal(orgId, userId, {
      entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
      entry_date: `${month}-28`,
      description: `صرف رواتب شهر ${month}`,
      source_module: "payment",
      lines: [
        { account_id: accounts["2200"].id, debit: total, credit: 0, description: "سداد الرواتب المستحقة" },
        { account_id: accounts["1010"].id, debit: 0, credit: total, description: "من البنك الأهلي" },
      ],
    });
    if (paymentEntry) entries.push(paymentEntry);
  }

  // Monthly rent
  for (const month of months) {
    const rent = 25000;
    const cc = costCenters.find((c) => c.code === "CC-ADMIN") || costCenters[0];
    const rentEntry = await createPostedJournal(orgId, userId, {
      entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
      entry_date: `${month}-01`,
      description: `إيجار المكتب - ${month}`,
      source_module: "manual",
      lines: [
        { account_id: accounts["5100"].id, debit: rent, credit: 0, description: "إيجار شهري", cost_center_id: cc.id },
        { account_id: accounts["1010"].id, debit: 0, credit: rent, description: "من البنك" },
      ],
    });
    if (rentEntry) entries.push(rentEntry);
  }

  // Various operational expenses
  const expenseTypes = [
    { account: "5110", desc: "فاتورة كهرباء ومياه", min: 3000, max: 8000 },
    { account: "5120", desc: "اشتراكات إنترنت واتصالات", min: 2000, max: 5000 },
    { account: "5130", desc: "مستلزمات مكتبية", min: 500, max: 3000 },
    { account: "5200", desc: "حملة تسويقية", min: 10000, max: 50000 },
    { account: "5210", desc: "مصاريف سفر وإقامة", min: 3000, max: 15000 },
    { account: "5220", desc: "دورة تدريبية", min: 5000, max: 20000 },
    { account: "5400", desc: "استشارات قانونية", min: 8000, max: 30000 },
    { account: "5500", desc: "عمولات بنكية", min: 200, max: 1500 },
    { account: "5600", desc: "تأمين طبي", min: 15000, max: 40000 },
  ];

  for (const month of months) {
    const numExpenses = randomBetween(3, 6);
    for (let i = 0; i < numExpenses; i++) {
      const et = pick(expenseTypes);
      const amount = randomBetween(et.min, et.max);
      const cc = pick(costCenters);

      const expEntry = await createPostedJournal(orgId, userId, {
        entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
        entry_date: randomDate(`${month}-01`, `${month}-28`),
        description: et.desc,
        source_module: "expense",
        lines: [
          { account_id: accounts[et.account].id, debit: amount, credit: 0, description: et.desc, cost_center_id: cc.id },
          { account_id: accounts["1010"].id, debit: 0, credit: amount, description: "من البنك" },
        ],
      });
      if (expEntry) entries.push(expEntry);
    }
  }

  // Revenue entries (sales / services)
  for (const month of months) {
    const numSales = randomBetween(2, 5);
    for (let i = 0; i < numSales; i++) {
      const revenueAccount = pick(["4000", "4010", "4020"]);
      const amount = randomBetween(20000, 200000);
      const vat = Math.round(amount * 0.15);
      const cc = pick(costCenters);

      const revEntry = await createPostedJournal(orgId, userId, {
        entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
        entry_date: randomDate(`${month}-01`, `${month}-28`),
        description: `إيراد مبيعات - ${accounts[revenueAccount].name_ar}`,
        source_module: "invoice",
        lines: [
          { account_id: accounts["1100"].id, debit: amount + vat, credit: 0, description: "ذمم العميل", cost_center_id: cc.id },
          { account_id: accounts[revenueAccount].id, debit: 0, credit: amount, description: "إيراد", cost_center_id: cc.id },
          { account_id: accounts["2100"].id, debit: 0, credit: vat, description: "ضريبة القيمة المضافة" },
        ],
      });
      if (revEntry) entries.push(revEntry);
    }
  }

  // Customer receipts
  for (const month of months) {
    const numReceipts = randomBetween(1, 3);
    for (let i = 0; i < numReceipts; i++) {
      const amount = randomBetween(30000, 250000);
      const receiptEntry = await createPostedJournal(orgId, userId, {
        entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
        entry_date: randomDate(`${month}-05`, `${month}-25`),
        description: "تحصيل من عميل",
        source_module: "payment",
        lines: [
          { account_id: accounts["1010"].id, debit: amount, credit: 0, description: "إيداع بنكي" },
          { account_id: accounts["1100"].id, debit: 0, credit: amount, description: "تخفيض ذمم مدينة" },
        ],
      });
      if (receiptEntry) entries.push(receiptEntry);
    }
  }

  // Depreciation
  for (const month of months) {
    const depAmount = 3333;
    const depEntry = await createPostedJournal(orgId, userId, {
      entry_no: `JE-${String(entryNum++).padStart(5, "0")}`,
      entry_date: `${month}-28`,
      description: `إهلاك شهري - ${month}`,
      source_module: "manual",
      lines: [
        { account_id: accounts["5300"].id, debit: depAmount, credit: 0, description: "مصروف إهلاك" },
        { account_id: accounts["1510"].id, debit: 0, credit: depAmount, description: "مجمع الإهلاك" },
      ],
    });
    if (depEntry) entries.push(depEntry);
  }

  return entries;
}

async function createPostedJournal(orgId, userId, { entry_no, entry_date, description, source_module, lines }) {
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  const journalId = uuid();
  const now = new Date().toISOString();

  // Step 1: Insert as draft (trigger enforces this)
  const { error: jeError } = await supabase.from("accounting_journal_entries").insert({
    id: journalId,
    organization_id: orgId,
    entry_no,
    entry_date,
    description,
    source_module,
    status: "draft",
    currency: "SAR",
    total_debit: totalDebit,
    total_credit: totalCredit,
    created_by: userId,
  });

  if (jeError) {
    console.error(`  JE error (${entry_no}):`, jeError.message);
    return null;
  }

  // Step 2: Insert lines
  const lineRows = lines.map((l) => ({
    id: uuid(),
    organization_id: orgId,
    journal_entry_id: journalId,
    account_id: l.account_id,
    debit: l.debit || 0,
    credit: l.credit || 0,
    description: l.description || "",
    cost_center_id: l.cost_center_id || null,
  }));

  const { error: lineError } = await supabase.from("accounting_journal_lines").insert(lineRows);
  if (lineError) {
    console.error(`  JL error (${entry_no}):`, lineError.message);
    return null;
  }

  // Step 3: Update to posted
  const { error: postError } = await supabase.from("accounting_journal_entries")
    .update({ status: "posted", posted_by: userId, posted_at: now })
    .eq("id", journalId);

  if (postError) {
    console.error(`  Post error (${entry_no}):`, postError.message);
  }

  return { id: journalId, entry_no, entry_date };
}

// ─── Invoices ───
async function seedInvoices(orgId, userId, accounts, customers, taxRates, costCenters) {
  const invoices = [];
  // Get max existing invoice number
  const { data: existingInv } = await supabase
    .from("accounting_invoices")
    .select("invoice_no")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  let invNum = 1;
  if (existingInv && existingInv.length > 0) {
    const match = existingInv[0].invoice_no.match(/(\d+)/);
    if (match) invNum = parseInt(match[1]) + 1;
  }
  const vat15 = taxRates.find((t) => t.rate === 15);

  const products = [
    { desc_ar: "خدمات استشارية تقنية", desc_en: "IT Consulting", price: 50000 },
    { desc_ar: "تطوير نظام ويب", desc_en: "Web Development", price: 120000 },
    { desc_ar: "دعم فني شهري", desc_en: "Monthly Support", price: 15000 },
    { desc_ar: "تصميم واجهات مستخدم", desc_en: "UI/UX Design", price: 35000 },
    { desc_ar: "استضافة وبنية تحتية", desc_en: "Hosting & Infra", price: 8000 },
    { desc_ar: "تدريب فريق العمل", desc_en: "Team Training", price: 25000 },
    { desc_ar: "تحليل بيانات", desc_en: "Data Analytics", price: 45000 },
  ];

  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2025-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 6; m++) months.push(`2026-${String(m).padStart(2, "0")}`);

  for (const month of months) {
    const numInvoices = randomBetween(2, 4);
    for (let i = 0; i < numInvoices; i++) {
      const customer = pick(customers);
      const product = pick(products);
      const qty = randomBetween(1, 3);
      const subtotal = product.price * qty;
      const vatAmount = Math.round(subtotal * 0.15);
      const total = subtotal + vatAmount;
      const cc = pick(costCenters);

      const invoiceDate = randomDate(`${month}-01`, `${month}-28`);
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 30);

      const isPaid = Math.random() > 0.3;
      const isPartial = !isPaid && Math.random() > 0.5;
      const paidAmount = isPaid ? total : isPartial ? Math.round(total * 0.5) : 0;
      const status = isPaid ? "paid" : isPartial ? "partially_paid" : (Math.random() > 0.2 ? "issued" : "draft");

      const invId = uuid();
      const invNo = `INV-${String(invNum++).padStart(5, "0")}`;

      const { error: invError } = await supabase.from("accounting_invoices").insert({
        id: invId,
        organization_id: orgId,
        customer_id: customer.id,
        invoice_no: invNo,
        invoice_date: invoiceDate,
        due_date: dueDate.toISOString().slice(0, 10),
        status,
        source_module: "manual",
        subtotal,
        discount_amount: 0,
        vat_amount: vatAmount,
        total_amount: total,
        paid_amount: paidAmount,
        balance_due: total - paidAmount,
        currency: "SAR",
        created_by: userId,
        issued_by: status !== "draft" ? userId : null,
        issued_at: status !== "draft" ? new Date().toISOString() : null,
      });

      if (invError) {
        console.error(`  Invoice error (${invNo}):`, invError.message);
        continue;
      }

      // Invoice lines
      await supabase.from("accounting_invoice_lines").insert({
        id: uuid(),
        organization_id: orgId,
        invoice_id: invId,
        description_ar: product.desc_ar,
        description_en: product.desc_en,
        quantity: qty,
        unit_price: product.price,
        discount_amount: 0,
        tax_rate_id: vat15?.id || null,
        vat_amount: vatAmount,
        line_total: total,
        revenue_account_id: accounts["4000"].id,
        cost_center_id: cc.id,
      });

      invoices.push({ id: invId, invoice_no: invNo, customer_id: customer.id, total_amount: total, balance_due: total - paidAmount, status });
    }
  }

  return invoices;
}

// ─── Expenses ───
async function seedExpenses(orgId, userId, accounts, vendors, costCenters) {
  const expenses = [];
  // Get max existing expense number
  const { data: existingExp } = await supabase
    .from("accounting_expenses")
    .select("expense_no")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  let expNum = 1;
  if (existingExp && existingExp.length > 0) {
    const match = existingExp[0].expense_no.match(/(\d+)/);
    if (match) expNum = parseInt(match[1]) + 1;
  }

  const categories = [
    { account: "5110", desc: "فاتورة كهرباء ومياه" },
    { account: "5120", desc: "فاتورة اتصالات" },
    { account: "5130", desc: "مستلزمات مكتبية" },
    { account: "5200", desc: "مصاريف تسويق" },
    { account: "5210", desc: "مصاريف سفر" },
    { account: "5400", desc: "خدمات مهنية" },
    { account: "5600", desc: "تأمين" },
  ];

  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2025-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 6; m++) months.push(`2026-${String(m).padStart(2, "0")}`);

  for (const month of months) {
    const numExpenses = randomBetween(3, 6);
    for (let i = 0; i < numExpenses; i++) {
      const cat = pick(categories);
      const vendor = pick(vendors);
      const cc = pick(costCenters);
      const amountBefore = randomBetween(1000, 30000);
      const vatAmount = Math.round(amountBefore * 0.15);
      const total = amountBefore + vatAmount;

      const isPaid = Math.random() > 0.25;
      const isApproved = isPaid || Math.random() > 0.3;
      const status = isPaid ? "paid" : isApproved ? "approved" : (Math.random() > 0.5 ? "pending_approval" : "draft");

      const expId = uuid();
      const expNo = `EXP-${String(expNum++).padStart(5, "0")}`;

      const { error } = await supabase.from("accounting_expenses").insert({
        id: expId,
        organization_id: orgId,
        expense_no: expNo,
        vendor_id: vendor.id,
        expense_date: randomDate(`${month}-01`, `${month}-28`),
        category_account_id: accounts[cat.account].id,
        payment_account_id: accounts["1010"].id,
        cost_center_id: cc.id,
        description: cat.desc,
        amount_before_vat: amountBefore,
        vat_amount: vatAmount,
        total_amount: total,
        status,
        paid_status: isPaid ? "paid" : "unpaid",
        payment_method: isPaid ? pick(["transfer", "cash", "cheque"]) : null,
        created_by: userId,
        approved_by: isApproved ? userId : null,
        approved_at: isApproved ? new Date().toISOString() : null,
        paid_at: isPaid ? new Date().toISOString() : null,
      });

      if (error) {
        console.error(`  Expense error (${expNo}):`, error.message);
        continue;
      }

      expenses.push({ id: expId, expense_no: expNo, vendor_id: vendor.id, total_amount: total, status });
    }
  }

  return expenses;
}

// ─── Payments ───
async function seedPayments(orgId, userId, accounts, customers, vendors, invoices, expenses) {
  const payments = [];
  // Get max existing payment number
  const { data: existingPay } = await supabase
    .from("accounting_payments")
    .select("payment_no")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  let payNum = 1;
  if (existingPay && existingPay.length > 0) {
    const match = existingPay[0].payment_no.match(/(\d+)/);
    if (match) payNum = parseInt(match[1]) + 1;
  }

  // Customer receipts
  const paidInvoices = invoices.filter((inv) => inv.status === "paid" || inv.status === "partially_paid");
  for (const inv of paidInvoices.slice(0, 30)) {
    const amount = inv.status === "paid" ? inv.total_amount : Math.round(inv.total_amount * 0.5);
    const payId = uuid();
    const payNo = `PAY-${String(payNum++).padStart(5, "0")}`;

    const { error } = await supabase.from("accounting_payments").insert({
      id: payId,
      organization_id: orgId,
      payment_no: payNo,
      payment_date: randomDate("2025-01-15", "2026-06-25"),
      type: "customer_receipt",
      direction: "inbound",
      amount,
      currency: "SAR",
      account_id: accounts["1010"].id,
      customer_id: inv.customer_id,
      invoice_id: inv.id,
      method: pick(["transfer", "cheque", "cash"]),
      reference_no: `REF-${randomBetween(100000, 999999)}`,
      status: "posted",
      created_by: userId,
      posted_by: userId,
      posted_at: new Date().toISOString(),
      description: `تحصيل فاتورة ${inv.invoice_no}`,
    });

    if (!error) payments.push({ id: payId, payment_no: payNo });
    else console.error(`  Payment error (${payNo}):`, error.message);
  }

  // Vendor payments
  const paidExpenses = expenses.filter((e) => e.status === "paid");
  for (const exp of paidExpenses.slice(0, 20)) {
    const payId = uuid();
    const payNo = `PAY-${String(payNum++).padStart(5, "0")}`;

    const { error } = await supabase.from("accounting_payments").insert({
      id: payId,
      organization_id: orgId,
      payment_no: payNo,
      payment_date: randomDate("2025-01-15", "2026-06-25"),
      type: "vendor_payment",
      direction: "outbound",
      amount: exp.total_amount,
      currency: "SAR",
      account_id: accounts["1010"].id,
      vendor_id: exp.vendor_id,
      expense_id: exp.id,
      method: pick(["transfer", "cheque"]),
      reference_no: `REF-${randomBetween(100000, 999999)}`,
      status: "posted",
      created_by: userId,
      posted_by: userId,
      posted_at: new Date().toISOString(),
      description: `سداد مصروف ${exp.expense_no}`,
    });

    if (!error) payments.push({ id: payId, payment_no: payNo });
    else console.error(`  Payment error (${payNo}):`, error.message);
  }

  // Payroll payments
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2025-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 6; m++) months.push(`2026-${String(m).padStart(2, "0")}`);

  for (const month of months) {
    const payId = uuid();
    const payNo = `PAY-${String(payNum++).padStart(5, "0")}`;
    const amount = randomBetween(100000, 150000);

    const { error } = await supabase.from("accounting_payments").insert({
      id: payId,
      organization_id: orgId,
      payment_no: payNo,
      payment_date: `${month}-28`,
      type: "payroll_payment",
      direction: "outbound",
      amount,
      currency: "SAR",
      account_id: accounts["1010"].id,
      method: "transfer",
      reference_no: `PAYROLL-${month}`,
      status: "posted",
      created_by: userId,
      posted_by: userId,
      posted_at: new Date().toISOString(),
      description: `صرف رواتب ${month}`,
    });

    if (!error) payments.push({ id: payId, payment_no: payNo });
    else console.error(`  Payment error (${payNo}):`, error.message);
  }

  return payments;
}

// ─── Budgets ───
async function seedBudgets(orgId, userId, accounts, costCenters) {
  const budgets = [];

  // Check if table exists
  const { error: checkErr } = await supabase.from("accounting_budgets").select("id").limit(1);
  if (checkErr && checkErr.message.includes("Could not find")) {
    console.log("  (accounting_budgets table not found - migration not applied, skipping)");
    return budgets;
  }

  for (const year of [2025, 2026]) {
    const budgetId = uuid();
    const { error: bErr } = await supabase.from("accounting_budgets").insert({
      id: budgetId,
      organization_id: orgId,
      name: `الميزانية التشغيلية ${year}`,
      fiscal_year: year,
      status: year === 2025 ? "approved" : "draft",
      created_by: userId,
      approved_by: year === 2025 ? userId : null,
      approved_at: year === 2025 ? new Date().toISOString() : null,
    });

    if (bErr) {
      console.error(`  Budget error (${year}):`, bErr.message);
      continue;
    }

    // Budget lines for expense accounts
    const expenseAccounts = ["5000", "5010", "5020", "5100", "5110", "5120", "5130", "5200", "5210", "5220", "5300", "5400", "5500", "5600"];
    const lines = [];

    for (const accCode of expenseAccounts) {
      const acc = accounts[accCode];
      if (!acc) continue;

      for (let m = 1; m <= 12; m++) {
        let monthlyBudget;
        if (accCode === "5000") monthlyBudget = randomBetween(85000, 110000);
        else if (accCode === "5010") monthlyBudget = randomBetween(20000, 35000);
        else if (accCode === "5100") monthlyBudget = 25000;
        else if (accCode === "5200") monthlyBudget = randomBetween(15000, 50000);
        else monthlyBudget = randomBetween(2000, 20000);

        lines.push({
          id: uuid(),
          organization_id: orgId,
          budget_id: budgetId,
          account_id: acc.id,
          cost_center_id: pick(costCenters).id,
          month: m,
          amount: monthlyBudget,
        });
      }
    }

    // Insert in batches of 100
    for (let i = 0; i < lines.length; i += 100) {
      const batch = lines.slice(i, i + 100);
      const { error: lErr } = await supabase.from("accounting_budget_lines").insert(batch);
      if (lErr) console.error(`  Budget lines error (batch ${i}):`, lErr.message);
    }

    budgets.push({ id: budgetId, year });
  }

  return budgets;
}

// ─── Execute ───
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
