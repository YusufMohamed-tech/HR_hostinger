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
  subtotal?: number;
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

    // Canonical customer lookup: sales_companies.accounting_customer_id first,
    // then fall back to accounting_customers.sales_company_id
    let customerName: string | undefined;
    if (salesLog.company_id) {
      const { data: company } = await (admin as any)
        .from("sales_companies")
        .select("accounting_customer_id, name")
        .eq("organization_id", orgId)
        .eq("id", salesLog.company_id)
        .maybeSingle();

      let customerId: string | undefined = company?.accounting_customer_id;
      if (!customerId) {
        const { data: customerRow } = await (admin as any)
          .from("accounting_customers")
          .select("id, name_ar, name_en")
          .eq("organization_id", orgId)
          .eq("sales_company_id", salesLog.company_id)
          .maybeSingle();
        customerId = customerRow?.id;
        if (customerRow) {
          customerName = String(customerRow.name_ar || customerRow.name_en || "");
        }
      }
      if (customerId && !customerName) {
        const { data: custRow } = await (admin as any)
          .from("accounting_customers")
          .select("name_ar, name_en")
          .eq("organization_id", orgId)
          .eq("id", customerId)
          .maybeSingle();
        customerName = custRow ? String(custRow.name_ar || custRow.name_en || "") : company?.name;
      }
    }

    // Compute VAT from org tax rate (default 15%)
    const subtotal = salesLog.subtotal ?? salesLog.grand_total;
    const taxRate = Number((settings as any).default_tax_rate ?? 15) / 100;
    const vatAmount = roundMoney(subtotal * taxRate);
    // AR debit = subtotal + VAT
    const arTotal = roundMoney(subtotal + vatAmount);

    const result = await postTransaction(admin, orgId, userId, "sales_revenue", {
      id: salesLog.id,
      log_date: salesLog.log_date,
      grand_total: arTotal,
      vat_amount: vatAmount,
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
        const label = String(d.label || d.type || "").toLowerCase();
        if (label.includes("advance") || label.includes("سلف")) {
          advanceDeductions += Number(d.amount || 0);
        }
      }
    }

    // Use a stable sourceId that does NOT conflict with the manual create-draft-entry path
    // (which uses a deterministic UUID). We use a distinct prefix to avoid collision.
    const sourceId = `auto-payroll-${month}`;
    const result = await postTransaction(admin, orgId, userId, "payroll_accrual", {
      id: sourceId,
      month,
      total_base_salary: roundMoney(totalBaseSalary),
      total_allowances: roundMoney(totalAllowances),
      total_net: roundMoney(totalNet),
      advance_deductions: roundMoney(advanceDeductions),
      total_employer_gosi: roundMoney(totalEmployerGosi),
      total_employee_gosi: roundMoney(totalEmployeeGosi),
    }, {
      entryDate: lastDayOfMonth(month),
      status: "posted",
      sourceId,
    });

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll auto-posting failed";
    await logAutoPostFailure(admin, orgId, "payroll", `auto-payroll-${month}`, message);
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

    // Fetch assets with depreciation columns; skip those already depreciated this month
    const { data: assets, error } = await (admin as any)
      .from("employee_assets")
      .select("id, asset_name, purchase_price, useful_life_months, salvage_value, last_depreciation_date, months_depreciated")
      .eq("org_id", orgId)
      .gt("purchase_price", 0)
      .neq("status", "returned");

    if (error) throw new Error(error.message);
    if (!assets || assets.length === 0) return { success: true, assetsProcessed: 0 };

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const lines: Array<{ account_id: string; debit: number; credit: number; description: string }> = [];
    let assetsProcessed = 0;
    const monthEnd = lastDayOfMonth(month);

    for (const asset of assets as Record<string, unknown>[]) {
      const purchasePrice = Number(asset.purchase_price || 0);
      const salvageValue = Number(asset.salvage_value || 0);
      const usefulLifeMonths = Number(asset.useful_life_months || 60);
      const monthsDepreciated = Number(asset.months_depreciated || 0);

      if (purchasePrice <= salvageValue) continue;

      // Skip if already fully depreciated
      if (monthsDepreciated >= usefulLifeMonths) continue;

      // Skip if already depreciated this month (last_depreciation_date in same month)
      const lastDepDate = String(asset.last_depreciation_date || "");
      if (lastDepDate.startsWith(month)) continue;

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
        .update({
          last_depreciation_date: monthEnd,
          months_depreciated: monthsDepreciated + 1,
        })
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

      // Smooth monthly accrual: use daily rate × (15 or 30 days) / 12
      // This avoids the lumpy delta-of-totals approach.
      const dailyRate = roundMoney(baseSalary / 30);
      const daysPerYear = yearsOfService > 5 ? 30 : 15;
      const monthlyAccrual = roundMoney(dailyRate * daysPerYear / 12);

      if (monthlyAccrual <= 0) continue;

      const { data: existing } = await (admin as any)
        .from("eosb_accruals")
        .select("id")
        .eq("organization_id", orgId)
        .eq("employee_id", String(emp.id))
        .eq("month", month)
        .maybeSingle();

      if (existing) continue;

      // Cumulative: sum of all prior accruals + this month
      const { data: priorRows } = await (admin as any)
        .from("eosb_accruals")
        .select("monthly_accrual")
        .eq("organization_id", orgId)
        .eq("employee_id", String(emp.id));
      const priorTotal = roundMoney(
        ((priorRows as Record<string, unknown>[] | null) || []).reduce(
          (sum, r) => sum + Number(r.monthly_accrual || 0), 0
        )
      );
      const cumulativeAccrual = roundMoney(priorTotal + monthlyAccrual);

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
        cumulative_accrual: cumulativeAccrual,
      });

      employeesProcessed++;
    }

    if (lines.length === 0) return { success: true, employeesProcessed: 0 };

    const sourceId = `eosb-accrual-${month}`;
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: lastDayOfMonth(month),
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
      // Debit provision for the full accrued amount (clear it entirely)
      lines.push({
        account_id: settings.default_eosb_provision_id,
        debit: accruedAmount,
        credit: 0,
        description: `تسوية مخصص نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    if (difference > 0) {
      // Settlement exceeds accrued: expense the shortfall
      lines.push({
        account_id: settings.default_eosb_expense_id,
        debit: difference,
        credit: 0,
        description: `فرق مكافأة نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    } else if (difference < 0) {
      // Over-accrued: credit back the surplus to EOSB expense
      lines.push({
        account_id: settings.default_eosb_expense_id,
        debit: 0,
        credit: roundMoney(Math.abs(difference)),
        description: `إعادة فائض مخصص نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    // CR: Bank — the actual cash paid out
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

    // Use dedicated leave encashment account; no silent fallback to salary expense
    const leaveEncashmentAccount = settings.default_leave_encashment_id;
    if (!leaveEncashmentAccount) throw new Error("حساب تعويض الإجازات (5040) غير محدد في إعدادات المحاسبة.");
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
// Utility: compute last calendar day of a YYYY-MM month
// =============================================================================

function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate(); // day 0 of next month = last day of this month
  return `${month}-${String(lastDay).padStart(2, "0")}`;
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
      error_message: errorMessage,
    }, { onConflict: "organization_id,source_module,source_id" });
  } catch {
    // Silently ignore logging failures to not block the main flow
  }
}
