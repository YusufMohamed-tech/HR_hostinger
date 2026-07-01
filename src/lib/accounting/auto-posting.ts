import { createAdminClient } from "@/lib/supabase/admin";
import { postTransaction, type AccountingSettings, type AdminClient } from "@/lib/accounting/posting-engine";
import { getAccountingSettings } from "@/lib/accounting/posting";
import { roundMoney } from "@/lib/accounting/validation";

// =============================================================================
// Phase 1: Sales Revenue Auto-Recognition
// =============================================================================

interface SalesLogData {
  id: string;
  log_date: string;
  grand_total: number;
  vat_amount?: number;
  company_id?: string;
  items?: Array<{ product_name?: string; line_total?: number }>;
}

export async function autoPostSalesLog(
  admin: AdminClient,
  orgId: string,
  userId: string,
  salesLog: SalesLogData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_sales) return { success: true };

    let customerName: string | undefined;
    if (salesLog.company_id) {
      const { data: link } = await (admin as any)
        .from("accounting_customers")
        .select("name_ar, name_en")
        .eq("organization_id", orgId)
        .eq("sales_company_id", salesLog.company_id)
        .maybeSingle();
      if (link) {
        customerName = String(link.name_ar || link.name_en || "");
      }
    }

    const result = await postTransaction(admin, orgId, userId, "sales_revenue", {
      id: salesLog.id,
      log_date: salesLog.log_date,
      grand_total: salesLog.grand_total,
      vat_amount: salesLog.vat_amount || 0,
      customer_name: customerName,
    }, {
      entryDate: salesLog.log_date,
      status: "posted",
      sourceId: salesLog.id,
    });

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-posting failed";
    await logAutoPostFailure(admin, orgId, "sales_log", salesLog.id, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Phase 2: Payroll Full Auto-Posting
// =============================================================================

interface PayrollSummary {
  month: string;
  total_base_salary: number;
  total_allowances: number;
  total_deductions: number;
  total_net: number;
  advance_deductions: number;
  employer_gosi: number;
  employee_gosi: number;
  department_breakdown?: Array<{
    department_id: string;
    department_name: string;
    amount: number;
  }>;
}

export async function autoPostPayrollMonth(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_payroll) return { success: true };

    const { data: payslips, error } = await (admin as any)
      .from("payslips")
      .select("id, employee_id, base_salary, total_allowances, total_deductions, net_salary, deductions_details, status, employee_gosi, employer_gosi")
      .eq("org_id", orgId)
      .eq("month", `${month}-01`)
      .eq("status", "approved");

    if (error) throw new Error(error.message);
    if (!payslips || payslips.length === 0) {
      throw new Error("لا توجد مسيرات رواتب معتمدة لهذا الشهر.");
    }

    let totalBaseSalary = 0;
    let totalAllowances = 0;
    let totalNet = 0;
    let advanceDeductions = 0;
    let totalEmployerGosi = 0;
    let totalEmployeeGosi = 0;

    for (const slip of payslips as Record<string, unknown>[]) {
      totalBaseSalary += Number(slip.base_salary || 0);
      totalAllowances += Number(slip.total_allowances || 0);
      totalNet += Number(slip.net_salary || 0);
      totalEmployerGosi += Number(slip.employer_gosi || 0);
      totalEmployeeGosi += Number(slip.employee_gosi || 0);

      const details = Array.isArray(slip.deductions_details) ? slip.deductions_details : [];
      for (const d of details as Record<string, unknown>[]) {
        if (String(d.type || "").toLowerCase().includes("advance") || String(d.type || "").toLowerCase().includes("سلف")) {
          advanceDeductions += Number(d.amount || 0);
        }
      }
    }

    const sourceId = `payroll-${month}`;
    const result = await postTransaction(admin, orgId, userId, "payroll_accrual", {
      id: sourceId,
      month,
      total_net: roundMoney(totalNet),
      advance_deductions: roundMoney(advanceDeductions),
    }, {
      entryDate: `${month}-28`,
      status: "posted",
      sourceId,
    });

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll auto-posting failed";
    await logAutoPostFailure(admin, orgId, "payroll", `payroll-${month}`, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Phase 3: Employee Advance Auto-Posting
// =============================================================================

interface AdvanceData {
  id: string;
  employee_id: string;
  employee_name?: string;
  approved_amount: number;
}

export async function autoPostAdvanceDisbursement(
  admin: AdminClient,
  orgId: string,
  userId: string,
  advanceRequest: AdvanceData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_advances) return { success: true };

    const result = await postTransaction(admin, orgId, userId, "advance_disbursement", {
      id: advanceRequest.id,
      employee_name: advanceRequest.employee_name || "موظف",
      amount: advanceRequest.approved_amount,
    }, {
      entryDate: new Date().toISOString().slice(0, 10),
      status: "posted",
      sourceId: advanceRequest.id,
    });

    await (admin as any)
      .from("advance_requests")
      .update({ journal_entry_id: result.journalEntryId })
      .eq("organization_id", orgId)
      .eq("id", advanceRequest.id);

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Advance auto-posting failed";
    await logAutoPostFailure(admin, orgId, "advance", advanceRequest.id, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Phase 4: Asset Capitalization & Depreciation
// =============================================================================

interface AssetData {
  id: string;
  asset_name: string;
  purchase_price: number;
  paid_immediately?: boolean;
}

export async function autoCapitalizeAsset(
  admin: AdminClient,
  orgId: string,
  userId: string,
  asset: AssetData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_assets) return { success: true };

    if (!settings.default_asset_account_id) {
      throw new Error("حساب الأصول الثابتة غير محدد.");
    }

    const creditAccountId = asset.paid_immediately
      ? (settings.default_bank_account_id || settings.default_cash_account_id)
      : settings.default_accounts_payable_id;

    if (!creditAccountId) {
      throw new Error("حساب الدفع غير محدد (بنك أو ذمم دائنة).");
    }

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `رسملة أصل: ${asset.asset_name}`,
      sourceModule: "asset_capitalization",
      sourceId: asset.id,
      status: "posted",
      lines: [
        {
          account_id: settings.default_asset_account_id,
          debit: asset.purchase_price,
          credit: 0,
          description: `شراء أصل: ${asset.asset_name}`,
        },
        {
          account_id: creditAccountId,
          debit: 0,
          credit: asset.purchase_price,
          description: `دفع ثمن أصل: ${asset.asset_name}`,
        },
      ],
    });

    await (admin as any)
      .from("employee_assets")
      .update({ capitalized_journal_id: entry.id })
      .eq("org_id", orgId)
      .eq("id", asset.id);

    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset capitalization failed";
    await logAutoPostFailure(admin, orgId, "asset_capitalization", asset.id, message);
    return { success: false, error: message };
  }
}

export async function runMonthlyDepreciation(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string
): Promise<{ success: boolean; journalEntryId?: string; assetsProcessed: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_assets) return { success: true, assetsProcessed: 0 };

    if (!settings.default_depreciation_expense_id || !settings.default_accumulated_depreciation_id) {
      throw new Error("حسابات الإهلاك غير محددة.");
    }

    const { data: assets, error } = await (admin as any)
      .from("employee_assets")
      .select("id, asset_name, purchase_price, useful_life_months, salvage_value, last_depreciation_date")
      .eq("org_id", orgId)
      .gt("purchase_price", 0)
      .neq("status", "returned");

    if (error) throw new Error(error.message);
    if (!assets || assets.length === 0) return { success: true, assetsProcessed: 0 };

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const lines: Array<{ account_id: string; debit: number; credit: number; description: string }> = [];
    let assetsProcessed = 0;
    const monthEnd = `${month}-28`;

    for (const asset of assets as Record<string, unknown>[]) {
      const purchasePrice = Number(asset.purchase_price || 0);
      const salvageValue = Number(asset.salvage_value || 0);
      const usefulLifeMonths = Number(asset.useful_life_months || 60);
      if (purchasePrice <= salvageValue) continue;

      const monthlyDep = roundMoney((purchasePrice - salvageValue) / usefulLifeMonths);
      if (monthlyDep <= 0) continue;

      lines.push(
        {
          account_id: settings.default_depreciation_expense_id!,
          debit: monthlyDep,
          credit: 0,
          description: `إهلاك ${asset.asset_name} - ${month}`,
        },
        {
          account_id: settings.default_accumulated_depreciation_id!,
          debit: 0,
          credit: monthlyDep,
          description: `مجمع إهلاك ${asset.asset_name} - ${month}`,
        }
      );

      await (admin as any)
        .from("employee_assets")
        .update({ last_depreciation_date: monthEnd })
        .eq("org_id", orgId)
        .eq("id", String(asset.id));

      assetsProcessed++;
    }

    if (lines.length === 0) return { success: true, assetsProcessed: 0 };

    const sourceId = `depreciation-${month}`;
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: monthEnd,
      description: `إهلاك أصول شهر ${month}`,
      sourceModule: "asset_depreciation",
      sourceId,
      status: "posted",
      lines,
    });

    return { success: true, journalEntryId: String(entry.id), assetsProcessed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Depreciation batch failed";
    await logAutoPostFailure(admin, orgId, "asset_depreciation", `depreciation-${month}`, message);
    return { success: false, assetsProcessed: 0, error: message };
  }
}

// =============================================================================
// Phase 5: End of Service Benefits (EOSB)
// =============================================================================

export function calculateEOSB(
  baseSalary: number,
  yearsOfService: number,
  terminationType: "resignation" | "termination" | "end_of_contract"
): number {
  const dailyRate = baseSalary / 30;
  let totalDays = 0;

  if (yearsOfService <= 5) {
    totalDays = yearsOfService * 15;
  } else {
    totalDays = (5 * 15) + ((yearsOfService - 5) * 30);
  }

  if (terminationType === "resignation") {
    if (yearsOfService < 2) return 0;
    if (yearsOfService < 5) totalDays = totalDays * (1 / 3);
    else if (yearsOfService < 10) totalDays = totalDays * (2 / 3);
  }

  return roundMoney(totalDays * dailyRate);
}

export async function runMonthlyEOSBAccrual(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string
): Promise<{ success: boolean; journalEntryId?: string; employeesProcessed: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_eosb_expense_id?: string; default_eosb_provision_id?: string }) | null;
    if (!settings?.auto_post_eosb) return { success: true, employeesProcessed: 0 };

    if (!settings.default_eosb_expense_id || !settings.default_eosb_provision_id) {
      throw new Error("حسابات مكافأة نهاية الخدمة غير محددة.");
    }

    const { data: employees, error } = await (admin as any)
      .from("employees")
      .select("id, full_name, base_salary, hiring_date")
      .eq("org_id", orgId)
      .eq("status", "Active")
      .not("hiring_date", "is", null);

    if (error) throw new Error(error.message);
    if (!employees || employees.length === 0) return { success: true, employeesProcessed: 0 };

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const lines: Array<{ account_id: string; debit: number; credit: number; description: string; employee_id?: string }> = [];
    let employeesProcessed = 0;
    const monthDate = new Date(`${month}-01`);

    for (const emp of employees as Record<string, unknown>[]) {
      const baseSalary = Number(emp.base_salary || 0);
      if (baseSalary <= 0) continue;

      const hireDate = new Date(String(emp.hiring_date));
      const yearsOfService = (monthDate.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (yearsOfService < 0) continue;

      const dailyRate = roundMoney(baseSalary / 30);
      const currentMonthEOSB = calculateEOSB(baseSalary, yearsOfService, "termination");
      const prevMonthYears = Math.max(0, yearsOfService - (1 / 12));
      const prevMonthEOSB = calculateEOSB(baseSalary, prevMonthYears, "termination");
      const monthlyAccrual = roundMoney(currentMonthEOSB - prevMonthEOSB);

      if (monthlyAccrual <= 0) continue;

      const { data: existing } = await (admin as any)
        .from("eosb_accruals")
        .select("id")
        .eq("organization_id", orgId)
        .eq("employee_id", String(emp.id))
        .eq("month", month)
        .maybeSingle();

      if (existing) continue;

      lines.push(
        {
          account_id: settings.default_eosb_expense_id,
          debit: monthlyAccrual,
          credit: 0,
          description: `مخصص نهاية خدمة ${emp.full_name} - ${month}`,
          employee_id: String(emp.id),
        },
        {
          account_id: settings.default_eosb_provision_id,
          debit: 0,
          credit: monthlyAccrual,
          description: `مخصص نهاية خدمة ${emp.full_name} - ${month}`,
          employee_id: String(emp.id),
        }
      );

      await (admin as any).from("eosb_accruals").insert({
        organization_id: orgId,
        employee_id: String(emp.id),
        month,
        years_of_service: roundMoney(yearsOfService),
        daily_rate: dailyRate,
        monthly_accrual: monthlyAccrual,
        cumulative_accrual: currentMonthEOSB,
      });

      employeesProcessed++;
    }

    if (lines.length === 0) return { success: true, employeesProcessed: 0 };

    const sourceId = `eosb-accrual-${month}`;
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: `${month}-28`,
      description: `مخصص مكافأة نهاية الخدمة - ${month}`,
      sourceModule: "eosb",
      sourceId,
      status: "posted",
      lines,
    });

    await (admin as any)
      .from("eosb_accruals")
      .update({ journal_entry_id: entry.id })
      .eq("organization_id", orgId)
      .eq("month", month);

    return { success: true, journalEntryId: String(entry.id), employeesProcessed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "EOSB accrual failed";
    await logAutoPostFailure(admin, orgId, "eosb", `eosb-accrual-${month}`, message);
    return { success: false, employeesProcessed: 0, error: message };
  }
}

export async function settleEmployeeEOSB(
  admin: AdminClient,
  orgId: string,
  userId: string,
  employeeId: string
): Promise<{ success: boolean; journalEntryId?: string; settlementAmount: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_eosb_expense_id?: string; default_eosb_provision_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    if (!settings.default_eosb_expense_id || !settings.default_eosb_provision_id) {
      throw new Error("حسابات مكافأة نهاية الخدمة غير محددة.");
    }

    const bankAccount = settings.default_bank_account_id || settings.default_cash_account_id;
    if (!bankAccount) throw new Error("حساب البنك غير محدد.");

    const { data: employee, error: empErr } = await (admin as any)
      .from("employees")
      .select("id, full_name, base_salary, hiring_date, termination_date, termination_type")
      .eq("org_id", orgId)
      .eq("id", employeeId)
      .maybeSingle();

    if (empErr) throw new Error(empErr.message);
    if (!employee) throw new Error("الموظف غير موجود.");

    const emp = employee as Record<string, unknown>;
    const baseSalary = Number(emp.base_salary || 0);
    const hireDate = new Date(String(emp.hiring_date));
    const terminationDate = emp.termination_date ? new Date(String(emp.termination_date)) : new Date();
    const yearsOfService = (terminationDate.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const terminationType = (String(emp.termination_type || "termination")) as "resignation" | "termination" | "end_of_contract";

    const settlementAmount = calculateEOSB(baseSalary, yearsOfService, terminationType);
    if (settlementAmount <= 0) return { success: true, settlementAmount: 0 };

    const { data: accruals } = await (admin as any)
      .from("eosb_accruals")
      .select("cumulative_accrual")
      .eq("organization_id", orgId)
      .eq("employee_id", employeeId)
      .order("month", { ascending: false })
      .limit(1);

    const accruedAmount = roundMoney(Number((accruals as any[])?.[0]?.cumulative_accrual || 0));
    const difference = roundMoney(settlementAmount - accruedAmount);

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const lines: Array<{ account_id: string; debit: number; credit: number; description: string; employee_id?: string }> = [];

    if (accruedAmount > 0) {
      lines.push({
        account_id: settings.default_eosb_provision_id,
        debit: Math.min(accruedAmount, settlementAmount),
        credit: 0,
        description: `تسوية مخصص نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    if (difference > 0) {
      lines.push({
        account_id: settings.default_eosb_expense_id,
        debit: difference,
        credit: 0,
        description: `فرق مكافأة نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    lines.push({
      account_id: bankAccount,
      debit: 0,
      credit: settlementAmount,
      description: `صرف مكافأة نهاية خدمة ${emp.full_name}`,
      employee_id: employeeId,
    });

    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `تسوية مكافأة نهاية خدمة ${emp.full_name}`,
      sourceModule: "eosb_settlement",
      sourceId: employeeId,
      status: "posted",
      lines,
    });

    return { success: true, journalEntryId: String(entry.id), settlementAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "EOSB settlement failed";
    await logAutoPostFailure(admin, orgId, "eosb_settlement", employeeId, message);
    return { success: false, settlementAmount: 0, error: message };
  }
}

// =============================================================================
// Phase 6: Leave Encashment
// =============================================================================

export async function calculateAndPostLeaveEncashment(
  admin: AdminClient,
  orgId: string,
  userId: string,
  employeeId: string
): Promise<{ success: boolean; journalEntryId?: string; encashmentAmount: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_leave_encashment_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    const leaveEncashmentAccount = settings.default_leave_encashment_id || settings.default_salary_expense_id;
    if (!leaveEncashmentAccount) throw new Error("حساب تعويض الإجازات غير محدد.");
    if (!settings.default_salary_payable_id) throw new Error("حساب الرواتب المستحقة غير محدد.");

    const [empResult, leaveResult] = await Promise.all([
      (admin as any)
        .from("employees")
        .select("id, full_name, base_salary")
        .eq("org_id", orgId)
        .eq("id", employeeId)
        .maybeSingle(),
      (admin as any)
        .from("leave_balances")
        .select("vacation_remaining")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .maybeSingle(),
    ]);

    if (empResult.error) throw new Error(empResult.error.message);
    if (!empResult.data) throw new Error("الموظف غير موجود.");

    const emp = empResult.data as Record<string, unknown>;
    const baseSalary = Number(emp.base_salary || 0);
    const vacationDays = Number(leaveResult.data?.vacation_remaining || 0);

    if (vacationDays <= 0 || baseSalary <= 0) return { success: true, encashmentAmount: 0 };

    const encashmentAmount = roundMoney(vacationDays * (baseSalary / 30));

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `تعويض إجازات ${emp.full_name} (${vacationDays} يوم)`,
      sourceModule: "leave_encashment",
      sourceId: employeeId,
      status: "posted",
      lines: [
        {
          account_id: leaveEncashmentAccount,
          debit: encashmentAmount,
          credit: 0,
          description: `تعويض إجازات ${emp.full_name}`,
          employee_id: employeeId,
        },
        {
          account_id: settings.default_salary_payable_id,
          debit: 0,
          credit: encashmentAmount,
          description: `تعويض إجازات مستحق ${emp.full_name}`,
          employee_id: employeeId,
        },
      ],
    });

    return { success: true, journalEntryId: String(entry.id), encashmentAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leave encashment failed";
    await logAutoPostFailure(admin, orgId, "leave_encashment", employeeId, message);
    return { success: false, encashmentAmount: 0, error: message };
  }
}

// =============================================================================
// Phase 7: GOSI Payment Recording
// =============================================================================

export async function recordGOSIPayment(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string,
  totalAmount: number
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_gosi_payable_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    const gosiPayableId = settings.default_gosi_payable_id;
    if (!gosiPayableId) throw new Error("حساب التأمينات الاجتماعية المستحقة غير محدد.");

    const bankAccount = settings.default_bank_account_id || settings.default_cash_account_id;
    if (!bankAccount) throw new Error("حساب البنك غير محدد.");

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const sourceId = `gosi-payment-${month}`;
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `سداد تأمينات اجتماعية - ${month}`,
      sourceModule: "gosi_payment",
      sourceId,
      status: "posted",
      lines: [
        {
          account_id: gosiPayableId,
          debit: totalAmount,
          credit: 0,
          description: `سداد تأمينات ${month}`,
        },
        {
          account_id: bankAccount,
          debit: 0,
          credit: totalAmount,
          description: `سداد تأمينات ${month}`,
        },
      ],
    });

    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOSI payment posting failed";
    await logAutoPostFailure(admin, orgId, "gosi_payment", `gosi-payment-${month}`, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Utility: Log Auto-Post Failure (non-blocking)
// =============================================================================

async function logAutoPostFailure(
  admin: AdminClient,
  orgId: string,
  sourceModule: string,
  sourceId: string,
  errorMessage: string
): Promise<void> {
  try {
    await (admin as any).from("accounting_source_postings").upsert({
      organization_id: orgId,
      source_module: sourceModule,
      source_id: sourceId,
      journal_entry_id: null,
      status: "failed",
    }, { onConflict: "organization_id,source_module,source_id" });
  } catch {
    // Silently ignore logging failures to not block the main flow
  }
}
