"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  BadgePercent,
  Banknote,
  BarChart3,
  BookOpen,
  CheckCircle,
  FilePlus2,
  Landmark,
  LineChart,
  Pencil,
  PieChart,
  Plus,
  Power,
  Receipt,
  RotateCcw,
  Save,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import {
  AccountingEmptyState,
  AccountingLoading,
  AccountingPageHeader,
  AccountingStatCard,
  AccountingStatusBadge,
  ExportCsvButton,
  MoneyAmount,
} from "@/components/accounting/AccountingPrimitives";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { JournalAttachments } from "@/components/accounting/JournalAttachments";
import {
  approveExpense,
  createAccountingAccount,
  createCostCenter,
  createCustomer,
  createExpense,
  createInvoice,
  createJournalEntry,
  createPayment,
  createPayrollDraftEntry,
  createVendor,
  deactivateAccountingAccount,
  deactivateCostCenter,
  deactivateCustomer,
  deactivateVendor,
  getAccountingAccounts,
  getAccountingDashboard,
  getAccountingReport,
  getAccountingSalesCompanies,
  getAccountingSettings,
  getCostCenters,
  getJournalAttachments,
  getCustomers,
  getExpense,
  getExpenses,
  getInvoice,
  getInvoices,
  getJournalEntries,
  getJournalEntry,
  getPayments,
  getSalesCommissions,
  getTaxRates,
  getVendors,
  initializeAccountingDefaults,
  issueInvoice,
  payExpense,
  postJournalEntry,
  postPayment,
  recordInvoicePayment,
  rejectExpense,
  reverseJournalEntry,
  settleSalesCommissions,
  updateAccountingAccount,
  updateAccountingSettings,
  updateCostCenter,
  updateCustomer,
  updateJournalEntry,
  updateVendor,
} from "@/lib/services/accounting";
import type { AccountingAccount, AccountingCostCenter, AccountingCustomer, AccountingPayment, AccountingSalesCompanyLink, AccountingTaxRate, AccountingVendor, AgentCommissionFinanceRow, CommissionPaymentMethod, MerchantCommissionFinanceRow } from "@/types/accounting";
import { useRoleContext } from "@/providers/RoleProvider";
import { EntityManagementPage } from "@/components/accounting/EntityManagement";

type AccountingView =
  | "dashboard"
  | "accounts"
  | "journals"
  | "journal-new"
  | "cost-centers"
  | "vendors"
  | "customers"
  | "expenses"
  | "expense-new"
  | "invoices"
  | "invoice-new"
  | "payments"
  | "commissions"
  | "reports"
  | "settings"
  | "entity-setup";

type JournalLineDraft = {
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  cost_center_id: string;
};

const accountTypeLabels: Record<string, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  expense: "مصروف",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function SelectField({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className || "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"}
    >
      {children}
    </select>
  );
}

function useAccountingCapabilities() {
  const { currentUser } = useRoleContext();
  const role = currentUser?.role;
  return {
    canManage: ["Finance_Manager", "Accountant"].includes(String(role)),
    canPost: role === "Finance_Manager",
    canManageSettings: role === "Finance_Manager",
  };
}

function useLoad<T>(loader: () => Promise<{ data: T | null; error: string | null }>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loader();
    if (result.error) {
      setMessage(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, message, setMessage, load };
}

export function AccountingPage({ view }: { view: AccountingView }) {
  if (view === "dashboard") return <AccountingDashboard />;
  if (view === "accounts") return <AccountsPage />;
  if (view === "journals") return <JournalEntriesPage />;
  if (view === "journal-new") return <JournalEntryFormPage />;
  if (view === "cost-centers") return <CostCentersPage />;
  if (view === "vendors") return <PartyPage kind="vendors" />;
  if (view === "customers") return <PartyPage kind="customers" />;
  if (view === "expenses") return <ExpensesPage />;
  if (view === "expense-new") return <ExpenseFormPage />;
  if (view === "invoices") return <InvoicesPage />;
  if (view === "invoice-new") return <InvoiceFormPage />;
  if (view === "payments") return <PaymentsPage />;
  if (view === "commissions") return <SalesCommissionsPage />;
  if (view === "reports") return <ReportsIndexPage />;
  if (view === "settings") return <AccountingSettingsPage />;
  if (view === "entity-setup") return <EntityManagementPage />;
  return null;
}

function AccountingDashboard() {
  const { canManage, canManageSettings } = useAccountingCapabilities();
  const [dates, setDates] = useState({ date_from: monthStart(), date_to: today() });
  const [payrollMonth, setPayrollMonth] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const { data, loading, message, setMessage, load } = useLoad(() => getAccountingDashboard(dates), [dates.date_from, dates.date_to]);
  const stats = (data?.stats || {}) as Record<string, unknown>;
  const recentJournals = (data?.recentJournals || []) as Record<string, unknown>[];
  const recentInvoices = (data?.recentInvoices || []) as Record<string, unknown>[];

  const init = async () => {
    const result = await initializeAccountingDefaults();
    if (result.error) setMessage(result.error);
    else {
      setMessage("تمت تهيئة دليل الحسابات والإعدادات الافتراضية بنجاح.");
      load();
    }
  };

  const createPayrollDraft = async () => {
    const result = await createPayrollDraftEntry(payrollMonth);
    if (result.error) setMessage(result.error);
    else setMessage("تم إنشاء مسودة قيد الرواتب بنجاح.");
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <AccountingPageHeader
        title="المالية والمحاسبة"
        description="لوحة تشغيلية للقيود، الذمم، المصروفات، الإيرادات، ضريبة القيمة المضافة، وتكاملات الرواتب والمبيعات."
        actions={
          <>
            <Input type="date" value={dates.date_from} onChange={(event) => setDates((prev) => ({ ...prev, date_from: event.target.value }))} className="w-40" />
            <Input type="date" value={dates.date_to} onChange={(event) => setDates((prev) => ({ ...prev, date_to: event.target.value }))} className="w-40" />
            {canManage ? <Input type="month" value={payrollMonth.slice(0, 7)} onChange={(event) => setPayrollMonth(`${event.target.value}-01`)} className="w-36" /> : null}
            {canManage ? <Button variant="outline" onClick={createPayrollDraft}>مسودة قيد رواتب</Button> : null}
            {canManageSettings ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={init}>
              <Settings className="ml-2 h-4 w-4" />
              تهيئة الإعدادات المحاسبية
            </Button> : null}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AccountingStatCard label="النقدية والبنك" value={<MoneyAmount value={stats.cashAndBank} />} tone="green" />
        <AccountingStatCard label="الذمم المدينة" value={<MoneyAmount value={stats.accountsReceivable} />} tone="blue" />
        <AccountingStatCard label="الذمم الدائنة" value={<MoneyAmount value={stats.accountsPayable} />} tone="amber" />
        <AccountingStatCard label="صافي الربح / الخسارة" value={<MoneyAmount value={stats.netProfit} />} tone={Number(stats.netProfit || 0) >= 0 ? "green" : "red"} />
        <AccountingStatCard label="إيرادات الفترة" value={<MoneyAmount value={stats.monthlyRevenue} />} />
        <AccountingStatCard label="مصروفات الفترة" value={<MoneyAmount value={stats.monthlyExpenses} />} />
        <AccountingStatCard label="صافي ضريبة القيمة المضافة" value={<MoneyAmount value={stats.vatNet} />} />
        <AccountingStatCard label="إجمالي الالتزامات" value={<MoneyAmount value={stats.liabilities} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <RecentTable title="آخر القيود اليومية" rows={recentJournals} columns={["entry_no", "entry_date", "description", "status"]} hrefBase="/accounting/journal-entries" />
        <RecentTable title="آخر الفواتير" rows={recentInvoices} columns={["invoice_no", "invoice_date", "total_amount", "status"]} hrefBase="/accounting/invoices" moneyColumn="total_amount" />
      </div>
    </div>
  );
}

function RecentTable({ title, rows, columns, hrefBase, moneyColumn }: { title: string; rows: Record<string, unknown>[]; columns: string[]; hrefBase: string; moneyColumn?: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6"><AccountingEmptyState title="لا توجد بيانات بعد" description="ستظهر السجلات هنا بعد بدء استخدام الوحدة." /></div>
        ) : (
          <Table>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.id)}>
                  {columns.map((column) => (
                    <TableCell key={column}>
                      {column === "status" ? <AccountingStatusBadge status={String(row[column] || "")} /> : column === moneyColumn ? <MoneyAmount value={row[column]} /> : String(row[column] || "-")}
                    </TableCell>
                  ))}
                  <TableCell className="text-left">
                    <Link className="text-sm font-medium text-brand hover:text-brand-dark" href={`${hrefBase}/${row.id}`}>عرض</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AccountsPage() {
  const { canManage, canManageSettings } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getAccountingAccounts(), []);
  const rows = data || [];
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <AccountingPageHeader
        title="دليل الحسابات"
        description="إدارة الحسابات المحاسبية وربطها بإعدادات القيود والتقارير."
        actions={canManage ? <AccountDialog onDone={load} onMessage={setMessage} /> : null}
      />
      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {loading ? <div className="p-6"><AccountingLoading /></div> : rows.length === 0 ? (
            <div className="p-6"><AccountingEmptyState title="لا يوجد دليل حسابات" description="ابدأ بتهيئة الإعدادات المحاسبية أو أضف حسابا يدويا." action={canManageSettings ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={async () => { const r = await initializeAccountingDefaults(); if (r.error) setMessage(r.error); else load(); }}>تهيئة الإعدادات المحاسبية</Button> : undefined} /></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الحساب</TableHead><TableHead>النوع</TableHead><TableHead>الرصيد الطبيعي</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((account) => <TableRow key={account.id}><TableCell className="font-mono">{account.code}</TableCell><TableCell className="font-medium">{account.name_ar}<div className="text-xs text-gray-500">{account.name_en}</div></TableCell><TableCell>{accountTypeLabels[account.type] || account.type}</TableCell><TableCell>{account.normal_balance === "debit" ? "Debit" : "Credit"}</TableCell><TableCell><AccountingStatusBadge status={account.is_active ? "active" : "cancelled"} /></TableCell><TableCell><div className="flex justify-end gap-2">{canManage ? <><AccountDialog account={account} onDone={load} onMessage={setMessage} />{account.is_active ? <ConfirmActionButton variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" title="تعطيل الحساب" description="سيتم تعطيل الحساب ومنعه من الاستخدام في قيود جديدة دون حذف سجلاته السابقة." confirmLabel="تعطيل" destructive onConfirm={async () => { const r = await deactivateAccountingAccount(account.id); if (r.error) setMessage(r.error); else load(); }}><Power className="h-4 w-4" /></ConfirmActionButton> : null}</> : <span className="text-xs text-gray-400">عرض فقط</span>}</div></TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountDialog({ account, onDone, onMessage }: { account?: AccountingAccount; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", type: "asset", normal_balance: "debit", description: "" });
  useEffect(() => {
    if (!open) return;
    setForm(account ? {
      code: account.code || "",
      name_ar: account.name_ar || "",
      name_en: account.name_en || "",
      type: account.type || "asset",
      normal_balance: account.normal_balance || "debit",
      description: account.description || "",
    } : { code: "", name_ar: "", name_en: "", type: "asset", normal_balance: "debit", description: "" });
  }, [account, open]);
  const save = async () => {
    const result = account ? await updateAccountingAccount(account.id, form as Partial<AccountingAccount>) : await createAccountingAccount(form as Partial<AccountingAccount>);
    if (result.error) onMessage(result.error);
    else {
      setOpen(false);
      setForm({ code: "", name_ar: "", name_en: "", type: "asset", normal_balance: "debit", description: "" });
      onDone();
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={account ? "ghost" : "default"} size={account ? "sm" : "default"} className={account ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark"} />}>{account ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" />إضافة حساب</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{account ? "تعديل حساب" : "إضافة حساب"}</DialogTitle><DialogDescription>أدخل بيانات الحساب المحاسبي.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <Input placeholder="الكود" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
          <Input placeholder="الاسم العربي" value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} />
          <Input placeholder="الاسم الإنجليزي" value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField value={form.type} onChange={(value) => setForm((p) => ({ ...p, type: value, normal_balance: value === "asset" || value === "expense" ? "debit" : "credit" }))}>
              {Object.entries(accountTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </SelectField>
            <SelectField value={form.normal_balance} onChange={(value) => setForm((p) => ({ ...p, normal_balance: value }))}>
              <option value="debit">Debit</option><option value="credit">Credit</option>
            </SelectField>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostCentersPage() {
  const { canManage } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getCostCenters(), []);
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="مراكز التكلفة" description="ربط المصروفات والقيود بالأقسام والمواقع والمشاريع وقنوات البيع." actions={canManage ? <CostCenterDialog onDone={load} onMessage={setMessage} /> : null} />
      <Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : !data?.length ? <div className="p-6"><AccountingEmptyState title="لا توجد مراكز تكلفة" /></div> : <Table><TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>النوع</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{data.map((center) => <TableRow key={center.id}><TableCell className="font-mono">{center.code}</TableCell><TableCell>{center.name_ar}<div className="text-xs text-gray-500">{center.name_en}</div></TableCell><TableCell>{center.type}</TableCell><TableCell><AccountingStatusBadge status={center.is_active ? "active" : "cancelled"} /></TableCell><TableCell><div className="flex justify-end gap-2">{canManage ? <><CostCenterDialog center={center} onDone={load} onMessage={setMessage} />{center.is_active ? <ConfirmActionButton variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" title="تعطيل مركز التكلفة" description="سيتم تعطيل مركز التكلفة ومنعه من الاستخدام في عمليات جديدة." confirmLabel="تعطيل" destructive onConfirm={async () => { const r = await deactivateCostCenter(center.id); if (r.error) setMessage(r.error); else load(); }}><Power className="h-4 w-4" /></ConfirmActionButton> : null}</> : <span className="text-xs text-gray-400">عرض فقط</span>}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    </div>
  );
}

function CostCenterDialog({ center, onDone, onMessage }: { center?: AccountingCostCenter; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", type: "custom" });
  useEffect(() => {
    if (!open) return;
    setForm(center ? {
      code: center.code || "",
      name_ar: center.name_ar || "",
      name_en: center.name_en || "",
      type: center.type || "custom",
    } : { code: "", name_ar: "", name_en: "", type: "custom" });
  }, [center, open]);
  const save = async () => {
    const result = center ? await updateCostCenter(center.id, form as Partial<AccountingCostCenter>) : await createCostCenter(form as Partial<AccountingCostCenter>);
    if (result.error) onMessage(result.error);
    else { setOpen(false); onDone(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={center ? "ghost" : "default"} size={center ? "sm" : "default"} className={center ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark"} />}>{center ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" />إضافة مركز تكلفة</>}</DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>{center ? "تعديل مركز تكلفة" : "إضافة مركز تكلفة"}</DialogTitle></DialogHeader><div className="grid gap-3 py-4"><Input placeholder="الكود" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} /><Input placeholder="الاسم العربي" value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} /><Input placeholder="الاسم الإنجليزي" value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} /><SelectField value={form.type} onChange={(value) => setForm((p) => ({ ...p, type: value }))}><option value="custom">مخصص</option><option value="department">قسم</option><option value="location">موقع</option><option value="sales_company">شركة مبيعات</option><option value="project">مشروع</option><option value="branch">فرع</option><option value="channel">قناة</option></SelectField></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button></DialogFooter></DialogContent>
    </Dialog>
  );
}

function PartyPage({ kind }: { kind: "vendors" | "customers" }) {
  const { canManage } = useAccountingCapabilities();
  const isVendor = kind === "vendors";
  const { data, loading, message, setMessage, load } = useLoad(() => isVendor ? getVendors() : getCustomers(), [kind]);
  const rows = data || [];
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title={isVendor ? "الموردون" : "العملاء"} description={isVendor ? "ملفات الموردين ومعلومات السداد والضريبة." : "ملفات العملاء وربطهم بشركات المبيعات والفواتير."} actions={canManage ? <PartyDialog kind={kind} onDone={load} onMessage={setMessage} /> : null} />
      <Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : rows.length === 0 ? <div className="p-6"><AccountingEmptyState title={isVendor ? "لا يوجد موردون" : "لا يوجد عملاء"} /></div> : <Table><TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>الرقم الضريبي</TableHead><TableHead>السجل التجاري</TableHead><TableHead>الجوال</TableHead><TableHead>المدينة</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{rows.map((party) => <TableRow key={party.id}><TableCell className="font-medium">{party.name_ar}<div className="text-xs text-gray-500">{party.name_en}</div></TableCell><TableCell>{party.vat_number || "-"}</TableCell><TableCell>{party.commercial_registration || "-"}</TableCell><TableCell>{party.phone || "-"}</TableCell><TableCell>{party.city || "-"}</TableCell><TableCell><AccountingStatusBadge status={party.is_active ? "active" : "cancelled"} /></TableCell><TableCell><div className="flex justify-end gap-2">{canManage ? <><PartyDialog kind={kind} party={party} onDone={load} onMessage={setMessage} />{party.is_active ? <ConfirmActionButton variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" title={isVendor ? "تعطيل مورد" : "تعطيل عميل"} description={isVendor ? "سيتم تعطيل المورد ومنعه من الاستخدام في عمليات جديدة." : "سيتم تعطيل العميل ومنعه من الاستخدام في فواتير جديدة."} confirmLabel="تعطيل" destructive onConfirm={async () => { const r = isVendor ? await deactivateVendor(party.id) : await deactivateCustomer(party.id); if (r.error) setMessage(r.error); else load(); }}><Power className="h-4 w-4" /></ConfirmActionButton> : null}</> : <span className="text-xs text-gray-400">عرض فقط</span>}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    </div>
  );
}

function PartyDialog({ kind, party, onDone, onMessage }: { kind: "vendors" | "customers"; party?: AccountingVendor | AccountingCustomer; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [salesCompanies, setSalesCompanies] = useState<AccountingSalesCompanyLink[]>([]);
  const [form, setForm] = useState({ name_ar: "", name_en: "", vat_number: "", commercial_registration: "", phone: "", email: "", city: "", bank_name: "", iban: "", sales_company_id: "" });
  useEffect(() => {
    if (kind === "customers" && open) getAccountingSalesCompanies().then((result) => setSalesCompanies(result.data || []));
    if (!open) return;
    const customer = party as AccountingCustomer | undefined;
    setForm(party ? {
      name_ar: party.name_ar || "",
      name_en: party.name_en || "",
      vat_number: party.vat_number || "",
      commercial_registration: party.commercial_registration || "",
      phone: party.phone || "",
      email: party.email || "",
      city: party.city || "",
      bank_name: (party as AccountingVendor).bank_name || "",
      iban: (party as AccountingVendor).iban || "",
      sales_company_id: customer?.sales_company_id || "",
    } : { name_ar: "", name_en: "", vat_number: "", commercial_registration: "", phone: "", email: "", city: "", bank_name: "", iban: "", sales_company_id: "" });
  }, [kind, party, open]);
  const save = async () => {
    const result = kind === "vendors"
      ? party ? await updateVendor(party.id, form as Partial<AccountingVendor>) : await createVendor(form as Partial<AccountingVendor>)
      : party ? await updateCustomer(party.id, form as Partial<AccountingCustomer>) : await createCustomer(form as Partial<AccountingCustomer>);
    if (result.error) onMessage(result.error);
    else { setOpen(false); setForm({ name_ar: "", name_en: "", vat_number: "", commercial_registration: "", phone: "", email: "", city: "", bank_name: "", iban: "", sales_company_id: "" }); onDone(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={party ? "ghost" : "default"} size={party ? "sm" : "default"} className={party ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark"} />}>{party ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" />{kind === "vendors" ? "إضافة مورد" : "إضافة عميل"}</>}</DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>{party ? (kind === "vendors" ? "تعديل مورد" : "تعديل عميل") : (kind === "vendors" ? "إضافة مورد" : "إضافة عميل")}</DialogTitle></DialogHeader><div className="grid gap-3 py-4 sm:grid-cols-2"><Input placeholder="الاسم العربي" value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} /><Input placeholder="الاسم الإنجليزي" value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} /><Input placeholder="الرقم الضريبي" value={form.vat_number} onChange={(e) => setForm((p) => ({ ...p, vat_number: e.target.value }))} /><Input placeholder="السجل التجاري" value={form.commercial_registration} onChange={(e) => setForm((p) => ({ ...p, commercial_registration: e.target.value }))} /><Input placeholder="الجوال" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /><Input placeholder="البريد الإلكتروني" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /><Input placeholder="المدينة" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />{kind === "customers" ? <SelectField value={form.sales_company_id} onChange={(value) => setForm((p) => ({ ...p, sales_company_id: value }))}><option value="">بدون ربط بشركة مبيعات</option>{salesCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</SelectField> : null}{kind === "vendors" ? <><Input placeholder="البنك" value={form.bank_name} onChange={(e) => setForm((p) => ({ ...p, bank_name: e.target.value }))} /><Input placeholder="IBAN" dir="ltr" value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} /></> : null}</div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button></DialogFooter></DialogContent>
    </Dialog>
  );
}

function JournalEntriesPage() {
  const { canManage, canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getJournalEntries(), []);
  const rows = data || [];
  const submitForApproval = async (id: string) => { const r = await updateJournalEntry(id, { status: "pending_approval" }); if (r.error) setMessage(r.error); else load(); };
  const post = async (id: string) => { const r = await postJournalEntry(id); if (r.error) setMessage(r.error); else load(); };
  const reverse = async (id: string) => { const r = await reverseJournalEntry(id, "عكس من شاشة القيود"); if (r.error) setMessage(r.error); else load(); };
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="القيود اليومية" description="إنشاء ومراجعة وترحيل القيود المحاسبية. القيود المرحلة لا تعدل مباشرة." actions={canManage ? <Button asChild className="bg-brand text-white hover:bg-brand-dark"><Link href="/accounting/journal-entries/new"><FilePlus2 className="ml-2 h-4 w-4" />قيد جديد</Link></Button> : null} />
      <Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : rows.length === 0 ? <div className="p-6"><AccountingEmptyState title="لا توجد قيود يومية" /></div> : <Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الوصف</TableHead><TableHead>المدين</TableHead><TableHead>الدائن</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell className="font-mono">{row.entry_no}</TableCell><TableCell>{row.entry_date}</TableCell><TableCell>{row.description}</TableCell><TableCell><MoneyAmount value={row.total_debit} /></TableCell><TableCell><MoneyAmount value={row.total_credit} /></TableCell><TableCell><AccountingStatusBadge status={row.status} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button asChild variant="outline" size="sm"><Link href={`/accounting/journal-entries/${row.id}`}>عرض</Link></Button>{canManage && row.status === "draft" ? <Button size="sm" variant="outline" onClick={() => submitForApproval(row.id)}>إرسال للاعتماد</Button> : null}{canPost && ["draft", "pending_approval"].includes(row.status) ? <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => post(row.id)}><CheckCircle className="ml-1 h-4 w-4" />ترحيل</Button> : null}{canPost && row.status === "posted" ? <Button size="sm" variant="outline" onClick={() => reverse(row.id)}><RotateCcw className="ml-1 h-4 w-4" />عكس</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    </div>
  );
}

function JournalEntryFormPage() {
  const { canManage } = useAccountingCapabilities();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [costCenters, setCostCenters] = useState<AccountingCostCenter[]>([]);
  const [form, setForm] = useState({ entry_date: today(), description: "", notes: "" });
  const [lines, setLines] = useState<JournalLineDraft[]>([{ account_id: "", debit: "", credit: "", description: "", cost_center_id: "" }, { account_id: "", debit: "", credit: "", description: "", cost_center_id: "" }]);
  const [submittingStatus, setSubmittingStatus] = useState<"draft" | "pending_approval" | null>(null);
  const submitLockRef = useRef(false);
  useEffect(() => { getAccountingAccounts().then((r) => setAccounts(r.data || [])); getCostCenters().then((r) => setCostCenters(r.data || [])); }, []);
  const totals = useMemo(() => ({ debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0), credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0) }), [lines]);
  const submit = async (status: "draft" | "pending_approval") => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmittingStatus(status);
    const result = await createJournalEntry({ ...form, status, lines: lines.map((line) => ({ ...line, debit: Number(line.debit || 0), credit: Number(line.credit || 0), cost_center_id: line.cost_center_id || null })) });
    if (result.error) {
      submitLockRef.current = false;
      setSubmittingStatus(null);
      setMessage(result.error);
    } else {
      router.push(`/accounting/journal-entries/${result.data?.id}`);
    }
  };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء قيود محاسبية." />;
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="قيد يومية جديد" description="أضف سطور المدين والدائن ثم احفظ القيد كمسودة أو أرسله للاعتماد." />
      <Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5"><div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>تاريخ القيد</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm((p) => ({ ...p, entry_date: e.target.value }))} /></div><div className="space-y-2 md:col-span-2"><Label>الوصف</Label><Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div></div><JournalLinesEditor accounts={accounts} costCenters={costCenters} lines={lines} setLines={setLines} /><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 text-sm"><div>إجمالي المدين: <MoneyAmount value={totals.debit} /> · إجمالي الدائن: <MoneyAmount value={totals.credit} /></div><div className={totals.debit === totals.credit ? "text-green-700" : "text-red-700"}>{totals.debit === totals.credit ? "القيد متوازن" : "القيد غير متوازن"}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => submit("draft")} disabled={Boolean(submittingStatus)}><Save className="ml-2 h-4 w-4" />{submittingStatus === "draft" ? "جاري الحفظ..." : "حفظ مسودة"}</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={() => submit("pending_approval")} disabled={Boolean(submittingStatus)}>{submittingStatus === "pending_approval" ? "جاري الإرسال..." : "إرسال للاعتماد"}</Button></div></CardContent></Card>
    </div>
  );
}

function JournalLinesEditor({ accounts, costCenters, lines, setLines }: { accounts: AccountingAccount[]; costCenters: AccountingCostCenter[]; lines: JournalLineDraft[]; setLines: React.Dispatch<React.SetStateAction<JournalLineDraft[]>> }) {
  const patch = (index: number, key: keyof JournalLineDraft, value: string) => setLines(lines.map((line, i) => i === index ? { ...line, [key]: value } : line));
  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div key={index} className="grid gap-3 rounded-lg border border-gray-100 bg-white p-3 md:grid-cols-[1.5fr_1fr_110px_110px_1fr_auto]">
          <AccountCombobox value={line.account_id || ""} onChange={(value) => patch(index, "account_id", value)} accounts={accounts} />
          <Input placeholder="وصف السطر" value={line.description || ""} onChange={(e) => patch(index, "description", e.target.value)} />
          <Input type="number" placeholder="مدين" value={line.debit || ""} onChange={(e) => patch(index, "debit", e.target.value)} />
          <Input type="number" placeholder="دائن" value={line.credit || ""} onChange={(e) => patch(index, "credit", e.target.value)} />
          <SelectField value={line.cost_center_id || ""} onChange={(value) => patch(index, "cost_center_id", value)}><option value="">مركز تكلفة</option>{costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} - {center.name_ar}</option>)}</SelectField>
          <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, i) => i !== index))}>حذف</Button>
        </div>
      ))}
      <Button variant="outline" onClick={() => setLines([...lines, { account_id: "", debit: "", credit: "", description: "", cost_center_id: "" }])}><Plus className="ml-2 h-4 w-4" />إضافة سطر</Button>
    </div>
  );
}

export function AccountingDetailPage({ entity, id }: { entity: "journal-entries" | "expenses" | "invoices"; id: string }) {
  if (entity === "journal-entries") return <JournalDetail id={id} />;
  if (entity === "expenses") return <ExpenseDetail id={id} />;
  return <InvoiceDetail id={id} />;
}

function JournalDetail({ id }: { id: string }) {
  const { canManage, canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getJournalEntry(id), [id]);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [costCenters, setCostCenters] = useState<AccountingCostCenter[]>([]);
  const [editForm, setEditForm] = useState({ entry_date: today(), description: "", notes: "" });
  const [editLines, setEditLines] = useState<JournalLineDraft[]>([]);

  useEffect(() => {
    if (!editing) return;
    getAccountingAccounts().then((r) => setAccounts(r.data || []));
    getCostCenters().then((r) => setCostCenters(r.data || []));
  }, [editing]);

  useEffect(() => {
    if (!editing || !data) return;
    setEditForm({
      entry_date: String(data.entry_date || today()),
      description: data.description || "",
      notes: data.notes || "",
    });
    setEditLines((data.lines || []).map((line) => ({
      account_id: line.account_id || "",
      debit: String(line.debit || ""),
      credit: String(line.credit || ""),
      description: line.description || "",
      cost_center_id: line.cost_center_id || "",
    })));
  }, [data, editing]);

  const validateEdit = () => {
    if (editLines.length < 2) return "يجب أن يحتوي القيد على سطرين على الأقل.";
    const invalidLine = editLines.find((line) => !line.account_id || (Number(line.debit || 0) > 0 && Number(line.credit || 0) > 0) || Number(line.debit || 0) < 0 || Number(line.credit || 0) < 0 || (Number(line.debit || 0) === 0 && Number(line.credit || 0) === 0));
    if (invalidLine) return "كل سطر يحتاج حسابا نشطا ومبلغ مدين أو دائن فقط دون قيم سالبة.";
    const debit = editLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = editLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100)) return "يجب أن يتساوى إجمالي المدين مع إجمالي الدائن.";
    return "";
  };

  const saveDraft = async (status?: "pending_approval") => {
    const validationMessage = validateEdit();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setSavingEdit(true);
    const r = await updateJournalEntry(id, {
      ...editForm,
      status,
      lines: editLines.map((line) => ({
        account_id: line.account_id,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        description: line.description || null,
        cost_center_id: line.cost_center_id || null,
      })),
    });
    setSavingEdit(false);
    if (r.error) setMessage(r.error);
    else {
      setEditing(false);
      load();
    }
  };

  const submitForApproval = async () => {
    setSubmittingApproval(true);
    const r = await updateJournalEntry(id, { status: "pending_approval" });
    setSubmittingApproval(false);
    if (r.error) setMessage(r.error);
    else load();
  };
  const post = async () => { const r = await postJournalEntry(id); if (r.error) setMessage(r.error); else load(); };
  const reverse = async () => { const r = await reverseJournalEntry(id, "عكس من صفحة التفاصيل"); if (r.error) setMessage(r.error); else load(); };
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="القيد غير موجود" />;
  const lines = data.lines || [];
  const editTotals = {
    debit: editLines.reduce((sum, line) => sum + Number(line.debit || 0), 0),
    credit: editLines.reduce((sum, line) => sum + Number(line.credit || 0), 0),
  };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader
        title={`قيد ${data.entry_no}`}
        description={data.description}
        actions={
          <>
            {canManage && data.status === "draft" ? <Button variant="outline" onClick={() => setEditing((value) => !value)}>{editing ? "إلغاء التعديل" : "تعديل المسودة"}</Button> : null}
            {canManage && data.status === "draft" && !editing ? <Button variant="outline" onClick={submitForApproval} disabled={submittingApproval}>{submittingApproval ? "جاري الإرسال..." : "إرسال للاعتماد"}</Button> : null}
            {canPost && ["draft", "pending_approval"].includes(data.status) && !editing ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={post}>ترحيل</Button> : null}
            {canPost && data.status === "posted" ? <Button variant="outline" onClick={reverse}>عكس القيد</Button> : null}
          </>
        }
      />
      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 p-5 md:grid-cols-4">
          <AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} />
          <AccountingStatCard label="التاريخ" value={data.entry_date} />
          <AccountingStatCard label="إجمالي المدين" value={<MoneyAmount value={data.total_debit} />} />
          <AccountingStatCard label="إجمالي الدائن" value={<MoneyAmount value={data.total_credit} />} />
        </CardContent>
      </Card>
      {editing ? (
        <Card className="border-none shadow-sm">
          <CardContent className="grid gap-4 p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>تاريخ القيد</Label>
                <Input type="date" value={editForm.entry_date} onChange={(e) => setEditForm((p) => ({ ...p, entry_date: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>الوصف</Label>
                <Input value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
            </div>
            <JournalLinesEditor accounts={accounts} costCenters={costCenters} lines={editLines} setLines={setEditLines} />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 text-sm">
              <div>إجمالي المدين: <MoneyAmount value={editTotals.debit} /> · إجمالي الدائن: <MoneyAmount value={editTotals.credit} /></div>
              <div className={Math.round(editTotals.debit * 100) === Math.round(editTotals.credit * 100) ? "text-green-700" : "text-red-700"}>{Math.round(editTotals.debit * 100) === Math.round(editTotals.credit * 100) ? "القيد متوازن" : "القيد غير متوازن"}</div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => saveDraft()} disabled={savingEdit}>حفظ التعديل</Button>
              <Button className="bg-brand text-white hover:bg-brand-dark" onClick={() => saveDraft("pending_approval")} disabled={savingEdit}>حفظ وإرسال للاعتماد</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <SimpleTable rows={lines} emptyTitle="لا توجد سطور" columns={[["account.code", "الحساب"], ["description", "الوصف"], ["debit", "مدين"], ["credit", "دائن"]]} moneyColumns={["debit", "credit"]} />
      )}
      <JournalAttachmentsSection journalEntryId={id} canUpload={canManage && ["draft", "posted"].includes(data.status)} canDelete={canManage && data.status === "draft"} />
    </div>
  );
}

function JournalAttachmentsSection({ journalEntryId, canUpload, canDelete }: { journalEntryId: string; canUpload: boolean; canDelete: boolean }) {
  const { data: attachments, load } = useLoad(() => getJournalAttachments(journalEntryId), [journalEntryId]);
  return (
    <Card className="border-none shadow-sm">
      <CardHeader><CardTitle>المرفقات ({attachments?.length || 0})</CardTitle></CardHeader>
      <CardContent>
        <JournalAttachments journalEntryId={journalEntryId} attachments={attachments || []} canUpload={canUpload} canDelete={canDelete} onRefresh={load} />
      </CardContent>
    </Card>
  );
}

function ExpensesPage() {
  const { canManage, canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getExpenses(), []);
  const approve = async (id: string) => { const r = await approveExpense(id); if (r.error) setMessage(r.error); else load(); };
  const pay = async (id: string) => { const r = await payExpense(id); if (r.error) setMessage(r.error); else load(); };
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="المصروفات" description="تسجيل المصروفات واعتمادها وسدادها مع القيود المحاسبية." actions={canManage ? <Button asChild className="bg-brand text-white hover:bg-brand-dark"><Link href="/accounting/expenses/new"><Plus className="ml-2 h-4 w-4" />مصروف جديد</Link></Button> : null} /><Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : !data?.length ? <div className="p-6"><AccountingEmptyState title="لا توجد مصروفات" /></div> : <Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الوصف</TableHead><TableHead>المبلغ</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{data.map((row) => <TableRow key={row.id}><TableCell>{row.expense_no}</TableCell><TableCell>{row.expense_date}</TableCell><TableCell>{row.description}</TableCell><TableCell><MoneyAmount value={row.total_amount} /></TableCell><TableCell><AccountingStatusBadge status={row.status} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button asChild variant="outline" size="sm"><Link href={`/accounting/expenses/${row.id}`}>عرض</Link></Button>{canPost && ["draft", "pending_approval"].includes(row.status) ? <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => approve(row.id)}>اعتماد</Button> : null}{canPost && row.status === "approved" ? <Button size="sm" variant="outline" onClick={() => pay(row.id)}>سداد</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card></div>;
}

function ExpenseFormPage() {
  const { canManage } = useAccountingCapabilities();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [costCenters, setCostCenters] = useState<AccountingCostCenter[]>([]);
  const [vendors, setVendors] = useState<AccountingVendor[]>([]);
  const [form, setForm] = useState({ expense_date: today(), vendor_id: "", category_account_id: "", payment_account_id: "", cost_center_id: "", description: "", amount_before_vat: "", vat_amount: "", attachment_url: "", status: "pending_approval" });
  useEffect(() => { getAccountingAccounts().then((r) => setAccounts(r.data || [])); getCostCenters().then((r) => setCostCenters(r.data || [])); getVendors().then((r) => setVendors(r.data || [])); }, []);
  const submit = async () => { const r = await createExpense(form); if (r.error) setMessage(r.error); else router.push(`/accounting/expenses/${r.data?.id}`); };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء مصروفات." />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="مصروف جديد" /><Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-2"><Input type="date" value={form.expense_date} onChange={(e) => setForm((p) => ({ ...p, expense_date: e.target.value }))} /><SelectField value={form.vendor_id} onChange={(v) => setForm((p) => ({ ...p, vendor_id: v }))}><option value="">المورد</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name_ar}</option>)}</SelectField><SelectField value={form.category_account_id} onChange={(v) => setForm((p) => ({ ...p, category_account_id: v }))}><option value="">حساب المصروف</option>{accounts.filter((a) => a.is_active !== false && a.type === "expense").map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}</SelectField><SelectField value={form.cost_center_id} onChange={(v) => setForm((p) => ({ ...p, cost_center_id: v }))}><option value="">مركز التكلفة</option>{costCenters.filter((c) => c.is_active !== false).map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</SelectField><SelectField value={form.payment_account_id} onChange={(v) => setForm((p) => ({ ...p, payment_account_id: v }))}><option value="">حساب الدفع عند السداد الفوري</option>{accounts.filter((a) => a.is_active !== false && a.type === "asset").map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}</SelectField><Input placeholder="رابط المرفق" value={form.attachment_url} onChange={(e) => setForm((p) => ({ ...p, attachment_url: e.target.value }))} /><Input placeholder="الوصف" className="md:col-span-2" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /><Input type="number" min={0} step="0.01" placeholder="المبلغ قبل الضريبة" value={form.amount_before_vat} onChange={(e) => setForm((p) => ({ ...p, amount_before_vat: e.target.value }))} /><Input type="number" min={0} step="0.01" placeholder="ضريبة القيمة المضافة" value={form.vat_amount} onChange={(e) => setForm((p) => ({ ...p, vat_amount: e.target.value }))} /><div className="md:col-span-2 flex justify-end"><Button className="bg-brand text-white hover:bg-brand-dark" onClick={submit}>حفظ المصروف</Button></div></CardContent></Card></div>;
}

function ExpenseDetail({ id }: { id: string }) {
  const { canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getExpense(id), [id]);
  const [rejectReason, setRejectReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [postedPaidAmount, setPostedPaidAmount] = useState(0);
  useEffect(() => {
    getPayments().then((result) => {
      const rows = (result.data || []) as Array<AccountingPayment & { expense_id?: string | null }>;
      const paid = rows
        .filter((payment) => payment.expense_id === id && payment.status === "posted")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      setPostedPaidAmount(paid);
    });
  }, [id, data?.paid_status]);
  const reject = async () => {
    const r = await rejectExpense(id, rejectReason || "مرفوض من شاشة التفاصيل");
    if (r.error) setMessage(r.error);
    else {
      setRejectReason("");
      load();
    }
  };
  const pay = async () => {
    const unpaidAmount = Math.max(0, Number(data?.total_amount || 0) - postedPaidAmount);
    const amount = Number(paymentAmount || unpaidAmount);
    if (amount <= 0 || amount > unpaidAmount) {
      setMessage("مبلغ السداد يجب أن يكون أكبر من صفر ولا يتجاوز الرصيد غير المسدد للمصروف.");
      return;
    }
    const r = await payExpense(id, { amount, payment_date: paymentDate });
    if (r.error) setMessage(r.error);
    else {
      setPaymentAmount("");
      load();
    }
  };
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="المصروف غير موجود" />;
  const canApproveOrReject = ["draft", "pending_approval"].includes(data.status);
  const canPayExpense = data.status === "approved" && data.paid_status !== "paid";
  const unpaidAmount = Math.max(0, Number(data.total_amount || 0) - postedPaidAmount);
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={`مصروف ${data.expense_no}`} description={data.description} actions={canPost && canApproveOrReject ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={async () => { const r = await approveExpense(id); if (r.error) setMessage(r.error); else load(); }}>اعتماد</Button> : null} /><div className="grid gap-4 md:grid-cols-5"><AccountingStatCard label="المبلغ" value={<MoneyAmount value={data.total_amount} />} /><AccountingStatCard label="الضريبة" value={<MoneyAmount value={data.vat_amount} />} /><AccountingStatCard label="المسدد" value={<MoneyAmount value={postedPaidAmount} />} /><AccountingStatCard label="المتبقي" value={<MoneyAmount value={unpaidAmount} />} /><AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} /></div>{data.attachment_url ? <Card className="border-none shadow-sm"><CardContent className="p-5"><a className="text-sm font-medium text-brand hover:text-brand-dark" href={data.attachment_url} target="_blank" rel="noreferrer">عرض المرفق</a></CardContent></Card> : null}{canPost && canApproveOrReject ? <Card className="border-none shadow-sm"><CardContent className="grid gap-3 p-5 md:grid-cols-[1fr_auto]"><Input placeholder="سبب الرفض" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /><Button variant="outline" className="text-red-700" onClick={reject}>رفض المصروف</Button></CardContent></Card> : null}{canPost && canPayExpense ? <Card className="border-none shadow-sm"><CardContent className="grid gap-3 p-5 md:grid-cols-[160px_180px_auto]"><Input type="number" min={0} step="0.01" max={unpaidAmount} placeholder="مبلغ السداد" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /><Button variant="outline" onClick={pay}>سداد المصروف</Button></CardContent></Card> : null}{data.rejection_reason ? <Card className="border-none shadow-sm"><CardContent className="p-5 text-sm text-red-700">سبب الرفض: {data.rejection_reason}</CardContent></Card> : null}</div>;
}

function InvoicesPage() {
  const { canManage } = useAccountingCapabilities();
  const { data, loading, message, setMessage } = useLoad(() => getInvoices(), []);
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="الفواتير" description="إنشاء فواتير العملاء وإصدارها وتسجيل المدفوعات." actions={canManage ? <Button asChild className="bg-brand text-white hover:bg-brand-dark"><Link href="/accounting/invoices/new"><Plus className="ml-2 h-4 w-4" />فاتورة جديدة</Link></Button> : null} /><Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : !data?.length ? <div className="p-6"><AccountingEmptyState title="لا توجد فواتير" /></div> : <Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الإجمالي</TableHead><TableHead>المتبقي</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{data.map((row) => <TableRow key={row.id}><TableCell>{row.invoice_no}</TableCell><TableCell>{row.invoice_date}</TableCell><TableCell><MoneyAmount value={row.total_amount} /></TableCell><TableCell><MoneyAmount value={row.balance_due} /></TableCell><TableCell><AccountingStatusBadge status={row.status} /></TableCell><TableCell className="text-left"><Button asChild variant="outline" size="sm"><Link href={`/accounting/invoices/${row.id}`}>عرض</Link></Button></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card></div>;
}

function InvoiceFormPage() {
  const { canManage } = useAccountingCapabilities();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [customers, setCustomers] = useState<AccountingCustomer[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<AccountingAccount[]>([]);
  const [taxRates, setTaxRates] = useState<AccountingTaxRate[]>([]);
  const [form, setForm] = useState({ customer_id: "", invoice_date: today(), due_date: "", notes: "" });
  const [lines, setLines] = useState([{ description_ar: "", quantity: "1", unit_price: "", discount_amount: "", vat_amount: "", revenue_account_id: "", tax_rate_id: "" }]);
  useEffect(() => {
    getCustomers().then((r) => setCustomers(r.data || []));
    getAccountingAccounts({ type: "revenue" }).then((r) => setRevenueAccounts(r.data || []));
    getTaxRates().then((r) => setTaxRates(r.data || []));
  }, []);
  const patchLine = (index: number, values: Partial<(typeof lines)[number]>) => setLines(lines.map((line, i) => i === index ? { ...line, ...values } : line));
  const submit = async () => {
    const preparedLines = lines
      .filter((line) => line.description_ar.trim() || Number(line.unit_price || 0) > 0)
      .map((line) => ({
        description_ar: line.description_ar || "بند فاتورة",
        quantity: Number(line.quantity || 1),
        unit_price: Number(line.unit_price || 0),
        discount_amount: Number(line.discount_amount || 0),
        vat_amount: line.vat_amount === "" ? undefined : Number(line.vat_amount || 0),
        revenue_account_id: line.revenue_account_id || null,
        tax_rate_id: line.tax_rate_id || null,
      }));
    if (preparedLines.length === 0) {
      setMessage("أضف بندا واحدا على الأقل قبل حفظ الفاتورة.");
      return;
    }
    const r = await createInvoice({ ...form, lines: preparedLines });
    if (r.error) setMessage(r.error);
    else router.push(`/accounting/invoices/${r.data?.id}`);
  };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء فواتير." />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="فاتورة جديدة" /><Card className="border-none shadow-sm"><CardContent className="space-y-4 p-5"><div className="grid gap-4 md:grid-cols-3"><SelectField value={form.customer_id} onChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}><option value="">العميل</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</SelectField><Input type="date" value={form.invoice_date} onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))} /><Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} /></div><div className="space-y-3">{lines.map((line, i) => <div key={i} className="grid gap-3 rounded-lg border border-gray-100 p-3 md:grid-cols-[1.4fr_80px_110px_110px_1fr_1fr_100px_auto]"><Input placeholder="الوصف" value={line.description_ar} onChange={(e) => patchLine(i, { description_ar: e.target.value })} /><Input type="number" min={0} step="0.01" placeholder="الكمية" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} /><Input type="number" min={0} step="0.01" placeholder="سعر الوحدة" value={line.unit_price} onChange={(e) => patchLine(i, { unit_price: e.target.value })} /><Input type="number" min={0} step="0.01" placeholder="خصم" value={line.discount_amount} onChange={(e) => patchLine(i, { discount_amount: e.target.value })} /><SelectField value={line.revenue_account_id} onChange={(value) => patchLine(i, { revenue_account_id: value })}><option value="">حساب الإيراد الافتراضي</option>{revenueAccounts.filter((account) => account.is_active !== false).map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}</SelectField><SelectField value={line.tax_rate_id} onChange={(value) => patchLine(i, { tax_rate_id: value, vat_amount: "" })}><option value="">بدون ضريبة / إدخال يدوي</option>{taxRates.filter((tax) => tax.is_active !== false).map((tax) => <option key={tax.id} value={tax.id}>{tax.name_ar} - {tax.rate}%</option>)}</SelectField><Input type="number" min={0} step="0.01" placeholder="ضريبة" value={line.vat_amount} onChange={(e) => patchLine(i, { vat_amount: e.target.value })} /><Button variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>حذف</Button></div>)}</div><p className="text-xs text-gray-500">عند ترك حساب الإيراد فارغا سيتم استخدام حساب إيرادات المبيعات الافتراضي من إعدادات المحاسبة.</p><Button variant="outline" onClick={() => setLines([...lines, { description_ar: "", quantity: "1", unit_price: "", discount_amount: "", vat_amount: "", revenue_account_id: "", tax_rate_id: "" }])}>إضافة بند</Button><div className="flex justify-end"><Button className="bg-brand text-white hover:bg-brand-dark" onClick={submit}>حفظ الفاتورة</Button></div></CardContent></Card></div>;
}

function InvoiceDetail({ id }: { id: string }) {
  const { canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getInvoice(id), [id]);
  const [amount, setAmount] = useState("");
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="الفاتورة غير موجودة" />;
  const lines = data.lines || [];
  const issue = async () => {
    if (lines.length === 0) {
      setMessage("لا يمكن إصدار فاتورة بدون بنود.");
      return;
    }
    const r = await issueInvoice(id);
    if (r.error) setMessage(r.error);
    else load();
  };
  const recordPayment = async () => {
    const paymentAmount = Number(amount || data.balance_due);
    if (paymentAmount <= 0 || paymentAmount > Number(data.balance_due || 0)) {
      setMessage("مبلغ السداد يجب ألا يتجاوز رصيد الفاتورة.");
      return;
    }
    const r = await recordInvoicePayment(id, { amount: paymentAmount, payment_date: today() });
    if (r.error) setMessage(r.error);
    else {
      setAmount("");
      load();
    }
  };
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={`فاتورة ${data.invoice_no}`} description={`تاريخ الفاتورة ${data.invoice_date}`} actions={canPost ? <>{data.status === "draft" ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={issue}>إصدار</Button> : null}{["issued", "partially_paid"].includes(data.status) ? <div className="flex gap-2"><Input className="w-36" type="number" min={0} step="0.01" placeholder="مبلغ السداد" value={amount} onChange={(e) => setAmount(e.target.value)} /><Button variant="outline" onClick={recordPayment}>تسجيل سداد</Button></div> : null}</> : null} /><div className="grid gap-4 md:grid-cols-4"><AccountingStatCard label="الإجمالي" value={<MoneyAmount value={data.total_amount} />} /><AccountingStatCard label="المدفوع" value={<MoneyAmount value={data.paid_amount} />} /><AccountingStatCard label="المتبقي" value={<MoneyAmount value={data.balance_due} />} /><AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} /></div><SimpleTable rows={lines} emptyTitle="لا توجد بنود" columns={[["description_ar", "الوصف"], ["quantity", "الكمية"], ["unit_price", "سعر الوحدة"], ["vat_amount", "الضريبة"], ["line_total", "الإجمالي"]]} moneyColumns={["unit_price", "vat_amount", "line_total"]} /></div>;
}

function PaymentsPage() {
  const { canManage, canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getPayments(), []);
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [costCenters, setCostCenters] = useState<AccountingCostCenter[]>([]);
  const [form, setForm] = useState({
    payment_date: today(),
    type: "manual",
    direction: "outbound",
    amount: "",
    account_id: "",
    counterpart_account_id: "",
    cost_center_id: "",
    description: "",
    method: "",
    reference_no: "",
    attachment_url: "",
    notes: "",
  });

  useEffect(() => {
    getAccountingAccounts().then((result) => setAccounts(result.data || []));
    getCostCenters().then((result) => setCostCenters(result.data || []));
  }, []);

  const bankAccounts = accounts.filter((account) => account.is_active !== false && account.type === "asset");
  const counterpartAccounts = accounts.filter((account) => account.is_active !== false);

  const save = async () => {
    const r = await createPayment({ ...form, amount: Number(form.amount || 0), cost_center_id: form.cost_center_id || null, counterpart_account_id: form.counterpart_account_id || null });
    if (r.error) setMessage(r.error);
    else {
      setOpen(false);
      setForm({ payment_date: today(), type: "manual", direction: "outbound", amount: "", account_id: "", counterpart_account_id: "", cost_center_id: "", description: "", method: "", reference_no: "", attachment_url: "", notes: "" });
      load();
    }
  };

  const post = async (id: string) => { const r = await postPayment(id); if (r.error) setMessage(r.error); else load(); };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader
        title="المدفوعات"
        description="سندات القبض والصرف وترحيلها محاسبيا."
        actions={canManage ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}>
              <Plus className="ml-2 h-4 w-4" />دفعة جديدة
            </DialogTrigger>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>دفعة جديدة</DialogTitle>
                <DialogDescription>الدفعات اليدوية تحتاج حساب بنك أو نقدية وحسابا مقابلا لإنشاء قيد متوازن.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>تاريخ الدفعة</Label>
                  <Input type="date" value={form.payment_date} onChange={(e) => setForm((p) => ({ ...p, payment_date: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>النوع</Label>
                  <SelectField value={form.type} onChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                    <option value="manual">يدوي</option>
                    <option value="customer_receipt">قبض عميل</option>
                    <option value="vendor_payment">سداد مورد</option>
                    <option value="payroll_payment">سداد رواتب</option>
                    <option value="employee_advance">سلفة موظف</option>
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label>الاتجاه</Label>
                  <SelectField value={form.direction} onChange={(v) => setForm((p) => ({ ...p, direction: v }))}>
                    <option value="outbound">صادر</option>
                    <option value="inbound">وارد</option>
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label>المبلغ</Label>
                  <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>حساب البنك / النقدية</Label>
                  <SelectField value={form.account_id} onChange={(v) => setForm((p) => ({ ...p, account_id: v }))}>
                    <option value="">اختر الحساب</option>
                    {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label>الحساب المقابل</Label>
                  <SelectField value={form.counterpart_account_id} onChange={(v) => setForm((p) => ({ ...p, counterpart_account_id: v }))}>
                    <option value="">اختر الحساب المقابل</option>
                    {counterpartAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label>مركز التكلفة</Label>
                  <SelectField value={form.cost_center_id} onChange={(v) => setForm((p) => ({ ...p, cost_center_id: v }))}>
                    <option value="">بدون مركز تكلفة</option>
                    {costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} - {center.name_ar}</option>)}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label>طريقة الدفع</Label>
                  <Input value={form.method} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>الوصف</Label>
                  <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>المرجع</Label>
                  <Input value={form.reference_no} onChange={(e) => setForm((p) => ({ ...p, reference_no: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>رابط المرفق</Label>
                  <Input value={form.attachment_url} onChange={(e) => setForm((p) => ({ ...p, attachment_url: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      />
      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {loading ? <div className="p-6"><AccountingLoading /></div> : !data?.length ? (
            <div className="p-6"><AccountingEmptyState title="لا توجد مدفوعات" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>الاتجاه</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.payment_no}</TableCell>
                    <TableCell>{row.payment_date}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>{row.description || "-"}</TableCell>
                    <TableCell>{row.direction === "inbound" ? "وارد" : "صادر"}</TableCell>
                    <TableCell><MoneyAmount value={row.amount} /></TableCell>
                    <TableCell><AccountingStatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-left">{canPost && row.status === "draft" ? <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => post(row.id)}>ترحيل</Button> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type CommissionFinanceRow = AgentCommissionFinanceRow | MerchantCommissionFinanceRow;

const commissionPaymentLabels: Record<CommissionPaymentMethod, string> = {
  cash: "نقدي",
  bank_transfer: "تحويل بنكي",
  wallet: "محفظة",
  other: "أخرى",
};

function SalesCommissionsPage() {
  const { canManage } = useAccountingCapabilities();
  const [activeTab, setActiveTab] = useState<"agent" | "merchant">("agent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settlement, setSettlement] = useState({
    payment_method: "cash" as CommissionPaymentMethod,
    payment_reference: "",
    finance_notes: "",
  });
  const [filters, setFilters] = useState({
    status: "unpaid",
    beneficiary_type: "all",
    date_from: "",
    date_to: "",
    agent_id: "",
    merchant_id: "",
    package_id: "",
    provider: "",
  });
  const { data, loading, message, setMessage, load } = useLoad(() => getSalesCommissions(filters), [
    filters.status,
    filters.beneficiary_type,
    filters.date_from,
    filters.date_to,
    filters.agent_id,
    filters.merchant_id,
    filters.package_id,
    filters.provider,
  ]);
  const summary = data?.summary;
  const rows = activeTab === "agent" ? data?.agent_commissions || [] : data?.merchant_commissions || [];
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const selectedTotal = selectedRows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0);

  useEffect(() => {
    setSelectedIds([]);
  }, [activeTab, filters.status, filters.beneficiary_type]);

  const patchFilter = (key: keyof typeof filters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));
  const toggleSelected = (row: CommissionFinanceRow) => {
    if (row.is_paid) return;
    setSelectedIds((prev) => prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id]);
  };

  const settle = async () => {
    if (!canManage) return;
    if (selectedIds.length === 0) {
      setMessage("اختر عمولة واحدة على الأقل.");
      return;
    }
    const result = await settleSalesCommissions({
      beneficiary_type: activeTab,
      commission_ids: selectedIds,
      payment_method: settlement.payment_method,
      payment_reference: settlement.payment_reference.trim() || undefined,
      finance_notes: settlement.finance_notes.trim() || undefined,
    });
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(`تم سداد ${result.data?.settled_count || 0} عمولة بإجمالي ${formatAccountingMoney(result.data?.total_amount || 0)}.`);
    setSelectedIds([]);
    load();
  };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <AccountingPageHeader
        title="عمولات المبيعات"
        description="متابعة عمولات شرائح SIM المستحقة والمدفوعة للمندوبين والتجار."
        actions={<Button variant="outline" onClick={load}><BadgePercent className="ml-2 h-4 w-4" />تحديث</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AccountingStatCard label="عمولات مندوبين غير مدفوعة" value={<MoneyAmount value={summary?.unpaid_agent_total || 0} />} tone="amber" />
        <AccountingStatCard label="عمولات تجار غير مدفوعة" value={<MoneyAmount value={summary?.unpaid_merchant_total || 0} />} tone="amber" />
        <AccountingStatCard label="المدفوع هذا الشهر" value={<MoneyAmount value={summary?.paid_total || 0} />} tone="green" />
        <AccountingStatCard label="إجمالي مصروف العمولة" value={<MoneyAmount value={summary?.total_commission_expense || 0} />} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-3 p-5 md:grid-cols-4 xl:grid-cols-8">
          <SelectField value={filters.status} onChange={(value) => patchFilter("status", value)}>
            <option value="unpaid">غير مدفوعة</option>
            <option value="paid">مدفوعة</option>
            <option value="all">الكل</option>
          </SelectField>
          <SelectField value={filters.beneficiary_type} onChange={(value) => patchFilter("beneficiary_type", value)}>
            <option value="all">كل المستفيدين</option>
            <option value="agent">المندوبون</option>
            <option value="merchant">التجار</option>
          </SelectField>
          <Input type="date" value={filters.date_from} onChange={(e) => patchFilter("date_from", e.target.value)} />
          <Input type="date" value={filters.date_to} onChange={(e) => patchFilter("date_to", e.target.value)} />
          <Input placeholder="معرف المندوب" value={filters.agent_id} onChange={(e) => patchFilter("agent_id", e.target.value)} />
          <Input placeholder="معرف التاجر" value={filters.merchant_id} onChange={(e) => patchFilter("merchant_id", e.target.value)} />
          <Input placeholder="معرف الباقة" value={filters.package_id} onChange={(e) => patchFilter("package_id", e.target.value)} />
          <Input placeholder="المزود" value={filters.provider} onChange={(e) => patchFilter("provider", e.target.value)} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant={activeTab === "agent" ? "default" : "outline"} onClick={() => setActiveTab("agent")} className={activeTab === "agent" ? "bg-brand text-white hover:bg-brand-dark" : ""}>
          عمولات المندوبين
        </Button>
        <Button variant={activeTab === "merchant" ? "default" : "outline"} onClick={() => setActiveTab("merchant")} className={activeTab === "merchant" ? "bg-brand text-white hover:bg-brand-dark" : ""}>
          عمولات التجار
        </Button>
      </div>

      {canManage ? (
        <Card className="border-none shadow-sm">
          <CardContent className="grid gap-3 p-5 md:grid-cols-[180px_1fr_1fr_auto]">
            <SelectField value={settlement.payment_method} onChange={(value) => setSettlement((prev) => ({ ...prev, payment_method: value as CommissionPaymentMethod }))}>
              {Object.entries(commissionPaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectField>
            <Input placeholder="مرجع السداد" value={settlement.payment_reference} onChange={(e) => setSettlement((prev) => ({ ...prev, payment_reference: e.target.value }))} />
            <Input placeholder="ملاحظات مالية" value={settlement.finance_notes} onChange={(e) => setSettlement((prev) => ({ ...prev, finance_notes: e.target.value }))} />
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={settle} disabled={selectedIds.length === 0}>
              سداد {selectedIds.length} / {formatAccountingMoney(selectedTotal)}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6"><AccountingLoading /></div>
          ) : rows.length === 0 ? (
            <div className="p-6"><AccountingEmptyState title="لا توجد عمولات" /></div>
          ) : (
            <CommissionFinanceTable
              rows={rows}
              type={activeTab}
              selectedIds={selectedIds}
              canSelect={canManage}
              onToggle={toggleSelected}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatAccountingMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

function CommissionFinanceTable({
  rows,
  type,
  selectedIds,
  canSelect,
  onToggle,
}: {
  rows: CommissionFinanceRow[];
  type: "agent" | "merchant";
  selectedIds: string[];
  canSelect: boolean;
  onToggle: (row: CommissionFinanceRow) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {canSelect ? <TableHead className="w-10"></TableHead> : null}
          <TableHead>{type === "agent" ? "المندوب" : "التاجر"}</TableHead>
          {type === "merchant" ? <TableHead>المندوب المالك</TableHead> : null}
          <TableHead>الباقة</TableHead>
          <TableHead>الشريحة</TableHead>
          <TableHead>تاريخ البيع</TableHead>
          <TableHead>سعر البيع</TableHead>
          <TableHead>العمولة</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead>مرجع السداد</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            {canSelect ? (
              <TableCell>
                <input
                  aria-label="اختيار العمولة"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={selectedIds.includes(row.id)}
                  disabled={row.is_paid}
                  onChange={() => onToggle(row)}
                />
              </TableCell>
            ) : null}
            <TableCell className="font-medium">{row.beneficiary_name || "-"}</TableCell>
            {type === "merchant" ? <TableCell>{row.owner_agent_name || row.agent_name || "-"}</TableCell> : null}
            <TableCell>
              {row.package_name || "-"}
              <div className="text-xs text-gray-500">{row.package_provider || "-"}</div>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.sim_label || row.sim_iccid || "-"}</TableCell>
            <TableCell>{row.sale_date ? String(row.sale_date).slice(0, 10) : "-"}</TableCell>
            <TableCell><MoneyAmount value={row.sale_price} /></TableCell>
            <TableCell>
              <MoneyAmount value={row.commission_amount} />
              <div className="text-xs text-gray-500">{row.commission_type === "percentage" ? `${row.commission_rate}%` : `${row.commission_rate} ${row.commission_currency || "SAR"}`}</div>
            </TableCell>
            <TableCell><AccountingStatusBadge status={row.is_paid ? "paid" : "pending"} /></TableCell>
            <TableCell>{row.payment_reference || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReportsIndexPage() {
  const reports = [
    ["dashboard", "لوحة المؤشرات المالية", BarChart3],
    ["trial-balance", "ميزان المراجعة", BookOpen],
    ["general-ledger", "دفتر الأستاذ العام", Landmark],
    ["profit-loss", "قائمة الدخل", Receipt],
    ["balance-sheet", "الميزانية العمومية", Banknote],
    ["comparative", "التقارير المقارنة", TrendingUp],
    ["cash-flow", "قائمة التدفقات النقدية", Wallet],
    ["cost-center", "ربحية مراكز التكلفة", PieChart],
    ["revenue", "تحليل الإيرادات", LineChart],
    ["expense-analysis", "تحليل المصروفات", PieChart],
    ["payroll-analysis", "تحليل الرواتب", BarChart3],
    ["vat", "تقرير ضريبة القيمة المضافة", Receipt],
    ["payroll-cost", "تكلفة الرواتب", Banknote],
    ["employee-advances", "سلف الموظفين", ArrowRightLeft],
    ["ar-aging", "أعمار الذمم المدينة", Receipt],
    ["ap-aging", "أعمار الذمم الدائنة", Receipt],
    ["expenses", "مصروفات حسب المركز", Receipt],
    ["sales-revenue", "إيرادات المبيعات", Receipt],
    ["reconciliation", "مراقبة المطابقة والترحيل", CheckCircle],
  ] as const;
  return <div className="space-y-6"><AccountingPageHeader title="التقارير المالية" description="تقارير مبنية على القيود المرحلة والعمليات المحاسبية الحقيقية." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reports.map(([key, label, Icon]) => <Link key={key} href={`/accounting/reports/${key}`} className="rounded-lg bg-white p-5 shadow-sm transition hover:shadow-md"><Icon className="mb-3 h-6 w-6 text-brand" /><p className="font-semibold text-gray-950">{label}</p><p className="mt-1 text-sm text-gray-500">عرض وتصفية وتصدير CSV</p></Link>)}</div></div>;
}

export function AccountingReportPage({ report }: { report: string }) {
  const [dates, setDates] = useState({ date_from: monthStart(), date_to: today(), as_of: today() });
  const { data, loading, message, setMessage, load } = useLoad(() => getAccountingReport(report, dates), [report, dates.date_from, dates.date_to, dates.as_of]);
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : Object.entries((data || {}) as Record<string, unknown>).flatMap(([, value]) => Array.isArray(value) ? value as Record<string, unknown>[] : []);
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={reportTitle(report)} actions={<><Input type="date" value={dates.date_from} onChange={(e) => setDates((p) => ({ ...p, date_from: e.target.value }))} className="w-40" /><Input type="date" value={dates.date_to} onChange={(e) => setDates((p) => ({ ...p, date_to: e.target.value, as_of: e.target.value }))} className="w-40" /><Button variant="outline" onClick={load}>تحديث</Button><ExportCsvButton rows={rows} filename={`accounting-${report}`} /></>} />{loading ? <AccountingLoading /> : <ReportRenderer data={data} />}</div>;
}

function reportTitle(report: string) {
  const labels: Record<string, string> = {
    "trial-balance": "ميزان المراجعة",
    "general-ledger": "دفتر الأستاذ العام",
    "profit-loss": "قائمة الدخل",
    "balance-sheet": "الميزانية العمومية",
    vat: "تقرير ضريبة القيمة المضافة",
    "payroll-cost": "تقرير تكلفة الرواتب",
    "employee-advances": "تقرير سلف الموظفين",
    "ar-aging": "أعمار الذمم المدينة",
    "ap-aging": "أعمار الذمم الدائنة",
    expenses: "تقرير المصروفات",
    "sales-revenue": "تقرير إيرادات المبيعات",
    dashboard: "لوحة المؤشرات المالية",
    "cash-flow": "قائمة التدفقات النقدية",
    comparative: "التقارير المقارنة",
    "cost-center": "ربحية مراكز التكلفة",
    revenue: "تحليل الإيرادات",
    "expense-analysis": "تحليل المصروفات",
    "payroll-analysis": "تحليل الرواتب",
    reconciliation: "مراقبة المطابقة والترحيل",
  };
  return labels[report] || "تقرير مالي";
}

function reportStatValue(key: string, value: unknown) {
  if (typeof value === "number") {
    return /(amount|total|balance|revenue|expense|profit|vat|cost|variance)/i.test(key)
      ? <MoneyAmount value={value} />
      : value.toLocaleString("ar-SA");
  }
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

function ReportRenderer({ data }: { data: unknown }) {
  if (!data) return <AccountingEmptyState title="لا توجد بيانات للتقرير" />;
  if (Array.isArray(data)) return <SimpleTable rows={data as Record<string, unknown>[]} emptyTitle="لا توجد بيانات" moneyColumns={["debit", "credit", "balance"]} />;
  const object = data as Record<string, unknown>;
  return <div className="space-y-4">{Object.entries(object).map(([key, value]) => Array.isArray(value)
    ? <Card key={key} className="border-none shadow-sm"><CardHeader><CardTitle>{key}</CardTitle></CardHeader><CardContent className="p-0"><SimpleTable rows={value as Record<string, unknown>[]} emptyTitle="لا توجد بيانات" moneyColumns={["debit", "credit", "balance", "amount", "total_amount", "net_salary"]} /></CardContent></Card>
    : value && typeof value === "object"
      ? <Card key={key} className="border-none shadow-sm"><CardHeader><CardTitle>{key}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">{Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => <AccountingStatCard key={childKey} label={childKey} value={reportStatValue(childKey, childValue)} />)}</CardContent></Card>
      : <AccountingStatCard key={key} label={key} value={reportStatValue(key, value)} />)}</div>;
}

function AccountingSettingsPage() {
  const { canManageSettings } = useAccountingCapabilities();
  const { data: settings, loading, message, setMessage, load } = useLoad(() => getAccountingSettings(), []);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { getAccountingAccounts().then((r) => setAccounts(r.data || [])); }, []);
  useEffect(() => { if (settings) setForm(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v || "")]))); }, [settings]);
  const save = async () => { const r = await updateAccountingSettings(form as Partial<import("@/types/accounting").AccountingSettings>); if (r.error) setMessage(r.error); else { setMessage("تم حفظ الإعدادات."); load(); } };
  const init = async () => { const r = await initializeAccountingDefaults(); if (r.error) setMessage(r.error); else { setMessage("تمت التهيئة."); getAccountingAccounts().then((a) => setAccounts(a.data || [])); load(); } };
  const accountFields = [["default_cash_account_id", "حساب النقدية"], ["default_bank_account_id", "حساب البنك"], ["default_accounts_receivable_id", "الذمم المدينة"], ["default_accounts_payable_id", "الذمم الدائنة"], ["default_sales_revenue_id", "إيرادات المبيعات"], ["default_vat_payable_id", "ضريبة مستحقة"], ["default_vat_receivable_id", "ضريبة قابلة للاسترداد"], ["default_salary_expense_id", "مصروف الرواتب"], ["default_salary_payable_id", "رواتب مستحقة"], ["default_employee_advances_id", "سلف الموظفين"], ["default_asset_account_id", "الأصول الثابتة"], ["default_depreciation_expense_id", "مصروف الإهلاك"], ["default_accumulated_depreciation_id", "مجمع الإهلاك"]];
  if (loading) return <AccountingLoading />;
  if (!canManageSettings) return <AccountingEmptyState title="صلاحية القراءة فقط" description="إعدادات المحاسبة متاحة لمدير المالية أو المدير فقط." />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="إعدادات المحاسبة" description="الحسابات الافتراضية والترقيم والفترة المالية." actions={<><Button variant="outline" onClick={init}>تهيئة دليل الحسابات</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ الإعدادات</Button></>} /><Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-2">{accountFields.map(([key, label]) => <div key={key} className="space-y-2"><Label>{label}</Label><SelectField value={form[key] || ""} onChange={(value) => setForm((p) => ({ ...p, [key]: value }))}><option value="">اختر الحساب</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}</SelectField></div>)}<div className="space-y-2"><Label>بداية السنة المالية</Label><Input type="number" min={1} max={12} value={form.fiscal_year_start_month || "1"} onChange={(e) => setForm((p) => ({ ...p, fiscal_year_start_month: e.target.value }))} /></div>{["invoice_prefix", "expense_prefix", "journal_prefix", "payment_prefix"].map((key) => <div key={key} className="space-y-2"><Label>{key}</Label><Input value={form[key] || ""} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} /></div>)}</CardContent></Card></div>;
}

function SimpleTable({
  rows,
  columns,
  emptyTitle,
  loading,
  moneyColumns = [],
}: {
  rows: object[];
  columns?: Array<[string, string]>;
  emptyTitle: string;
  loading?: boolean;
  moneyColumns?: string[];
}) {
  const displayRows = rows as Record<string, unknown>[];
  const keys = columns || (displayRows[0] ? Object.keys(displayRows[0]).slice(0, 8).map((key) => [key, key] as [string, string]) : []);
  if (loading) return <AccountingLoading />;
  if (!displayRows.length) return <Card className="border-none shadow-sm"><CardContent className="p-6"><AccountingEmptyState title={emptyTitle} /></CardContent></Card>;
  const valueFor = (row: Record<string, unknown>, key: string): unknown => key.includes(".") ? key.split(".").reduce<unknown>((acc, item) => (acc as Record<string, unknown> | null)?.[item], row) : row[key];
  return <Card className="border-none shadow-sm"><CardContent className="p-0"><Table><TableHeader><TableRow>{keys.map(([key, label]) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{displayRows.map((row, index) => <TableRow key={String(row.id || index)}>{keys.map(([key]) => <TableCell key={key}>{moneyColumns.includes(key) ? <MoneyAmount value={valueFor(row, key)} /> : String(valueFor(row, key) ?? "-")}</TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>;
}
