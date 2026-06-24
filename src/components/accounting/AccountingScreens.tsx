"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Banknote,
  BookOpen,
  CheckCircle,
  FilePlus2,
  Landmark,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import {
  AccountingEmptyState,
  AccountingLoading,
  AccountingPageHeader,
  AccountingStatCard,
  AccountingStatusBadge,
  ExportCsvButton,
  MoneyAmount,
} from "@/components/accounting/AccountingPrimitives";
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
  getAccountingAccounts,
  getAccountingDashboard,
  getAccountingReport,
  getAccountingSalesCompanies,
  getAccountingSettings,
  getCostCenters,
  getCustomers,
  getExpense,
  getExpenses,
  getInvoice,
  getInvoices,
  getJournalEntries,
  getJournalEntry,
  getPayments,
  getVendors,
  initializeAccountingDefaults,
  issueInvoice,
  payExpense,
  postJournalEntry,
  postPayment,
  recordInvoicePayment,
  rejectExpense,
  reverseJournalEntry,
  updateAccountingSettings,
} from "@/lib/services/accounting";
import type { AccountingAccount, AccountingCostCenter, AccountingCustomer, AccountingSalesCompanyLink, AccountingVendor } from "@/types/accounting";
import { useRoleContext } from "@/providers/RoleProvider";

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
  | "reports"
  | "settings";

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
    canManage: ["Admin", "Finance_Manager", "Accountant"].includes(String(role)),
    canPost: ["Admin", "Finance_Manager"].includes(String(role)),
    canManageSettings: ["Admin", "Finance_Manager"].includes(String(role)),
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
  if (view === "reports") return <ReportsIndexPage />;
  if (view === "settings") return <AccountingSettingsPage />;
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
              <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الحساب</TableHead><TableHead>النوع</TableHead><TableHead>الرصيد الطبيعي</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((account) => <TableRow key={account.id}><TableCell className="font-mono">{account.code}</TableCell><TableCell className="font-medium">{account.name_ar}<div className="text-xs text-gray-500">{account.name_en}</div></TableCell><TableCell>{accountTypeLabels[account.type] || account.type}</TableCell><TableCell>{account.normal_balance === "debit" ? "Debit" : "Credit"}</TableCell><TableCell><AccountingStatusBadge status={account.is_active ? "active" : "cancelled"} /></TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountDialog({ onDone, onMessage }: { onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", type: "asset", normal_balance: "debit", description: "" });
  const save = async () => {
    const result = await createAccountingAccount(form as Partial<AccountingAccount>);
    if (result.error) onMessage(result.error);
    else {
      setOpen(false);
      setForm({ code: "", name_ar: "", name_en: "", type: "asset", normal_balance: "debit", description: "" });
      onDone();
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}><Plus className="ml-2 h-4 w-4" />إضافة حساب</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة حساب</DialogTitle><DialogDescription>أدخل بيانات الحساب المحاسبي.</DialogDescription></DialogHeader>
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
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", type: "custom" });
  const save = async () => {
    const result = await createCostCenter(form as Partial<AccountingCostCenter>);
    if (result.error) setMessage(result.error);
    else { setOpen(false); setForm({ code: "", name_ar: "", name_en: "", type: "custom" }); load(); }
  };
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="مراكز التكلفة" description="ربط المصروفات والقيود بالأقسام والمواقع والمشاريع وقنوات البيع." actions={canManage ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}><Plus className="ml-2 h-4 w-4" />إضافة مركز تكلفة</DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>إضافة مركز تكلفة</DialogTitle></DialogHeader><div className="grid gap-3 py-4"><Input placeholder="الكود" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} /><Input placeholder="الاسم العربي" value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} /><Input placeholder="الاسم الإنجليزي" value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} /><SelectField value={form.type} onChange={(value) => setForm((p) => ({ ...p, type: value }))}><option value="custom">مخصص</option><option value="department">قسم</option><option value="location">موقع</option><option value="sales_company">شركة مبيعات</option><option value="project">مشروع</option><option value="branch">فرع</option><option value="channel">قناة</option></SelectField></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button></DialogFooter></DialogContent>
        </Dialog>
      ) : null} />
      <SimpleTable loading={loading} rows={data || []} emptyTitle="لا توجد مراكز تكلفة" columns={[["code", "الكود"], ["name_ar", "الاسم"], ["type", "النوع"]]} />
    </div>
  );
}

function PartyPage({ kind }: { kind: "vendors" | "customers" }) {
  const { canManage } = useAccountingCapabilities();
  const isVendor = kind === "vendors";
  const { data, loading, message, setMessage, load } = useLoad(() => isVendor ? getVendors() : getCustomers(), [kind]);
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title={isVendor ? "الموردون" : "العملاء"} description={isVendor ? "ملفات الموردين ومعلومات السداد والضريبة." : "ملفات العملاء وربطهم بشركات المبيعات والفواتير."} actions={canManage ? <PartyDialog kind={kind} onDone={load} onMessage={setMessage} /> : null} />
      <SimpleTable loading={loading} rows={(data || []) as unknown as Record<string, unknown>[]} emptyTitle={isVendor ? "لا يوجد موردون" : "لا يوجد عملاء"} columns={[["name_ar", "الاسم"], ["vat_number", "الرقم الضريبي"], ["commercial_registration", "السجل التجاري"], ["phone", "الجوال"], ["city", "المدينة"]]} />
    </div>
  );
}

function PartyDialog({ kind, onDone, onMessage }: { kind: "vendors" | "customers"; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [salesCompanies, setSalesCompanies] = useState<AccountingSalesCompanyLink[]>([]);
  const [form, setForm] = useState({ name_ar: "", name_en: "", vat_number: "", commercial_registration: "", phone: "", email: "", city: "", bank_name: "", iban: "", sales_company_id: "" });
  useEffect(() => {
    if (kind === "customers" && open) getAccountingSalesCompanies().then((result) => setSalesCompanies(result.data || []));
  }, [kind, open]);
  const save = async () => {
    const result = kind === "vendors" ? await createVendor(form as Partial<AccountingVendor>) : await createCustomer(form as Partial<AccountingCustomer>);
    if (result.error) onMessage(result.error);
    else { setOpen(false); setForm({ name_ar: "", name_en: "", vat_number: "", commercial_registration: "", phone: "", email: "", city: "", bank_name: "", iban: "", sales_company_id: "" }); onDone(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}><Plus className="ml-2 h-4 w-4" />{kind === "vendors" ? "إضافة مورد" : "إضافة عميل"}</DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>{kind === "vendors" ? "إضافة مورد" : "إضافة عميل"}</DialogTitle></DialogHeader><div className="grid gap-3 py-4 sm:grid-cols-2"><Input placeholder="الاسم العربي" value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} /><Input placeholder="الاسم الإنجليزي" value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} /><Input placeholder="الرقم الضريبي" value={form.vat_number} onChange={(e) => setForm((p) => ({ ...p, vat_number: e.target.value }))} /><Input placeholder="السجل التجاري" value={form.commercial_registration} onChange={(e) => setForm((p) => ({ ...p, commercial_registration: e.target.value }))} /><Input placeholder="الجوال" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /><Input placeholder="البريد الإلكتروني" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /><Input placeholder="المدينة" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />{kind === "customers" ? <SelectField value={form.sales_company_id} onChange={(value) => setForm((p) => ({ ...p, sales_company_id: value }))}><option value="">بدون ربط بشركة مبيعات</option>{salesCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</SelectField> : null}{kind === "vendors" ? <><Input placeholder="البنك" value={form.bank_name} onChange={(e) => setForm((p) => ({ ...p, bank_name: e.target.value }))} /><Input placeholder="IBAN" dir="ltr" value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} /></> : null}</div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button></DialogFooter></DialogContent>
    </Dialog>
  );
}

function JournalEntriesPage() {
  const { canManage, canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getJournalEntries(), []);
  const rows = data || [];
  const post = async (id: string) => { const r = await postJournalEntry(id); if (r.error) setMessage(r.error); else load(); };
  const reverse = async (id: string) => { const r = await reverseJournalEntry(id, "عكس من شاشة القيود"); if (r.error) setMessage(r.error); else load(); };
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="القيود اليومية" description="إنشاء ومراجعة وترحيل القيود المحاسبية. القيود المرحلة لا تعدل مباشرة." actions={canManage ? <Button asChild className="bg-brand text-white hover:bg-brand-dark"><Link href="/accounting/journal-entries/new"><FilePlus2 className="ml-2 h-4 w-4" />قيد جديد</Link></Button> : null} />
      <Card className="border-none shadow-sm"><CardContent className="p-0">{loading ? <div className="p-6"><AccountingLoading /></div> : rows.length === 0 ? <div className="p-6"><AccountingEmptyState title="لا توجد قيود يومية" /></div> : <Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الوصف</TableHead><TableHead>المدين</TableHead><TableHead>الدائن</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">الإجراءات</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell className="font-mono">{row.entry_no}</TableCell><TableCell>{row.entry_date}</TableCell><TableCell>{row.description}</TableCell><TableCell><MoneyAmount value={row.total_debit} /></TableCell><TableCell><MoneyAmount value={row.total_credit} /></TableCell><TableCell><AccountingStatusBadge status={row.status} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button asChild variant="outline" size="sm"><Link href={`/accounting/journal-entries/${row.id}`}>عرض</Link></Button>{canPost && ["draft", "pending_approval"].includes(row.status) ? <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => post(row.id)}><CheckCircle className="ml-1 h-4 w-4" />ترحيل</Button> : null}{canPost && row.status === "posted" ? <Button size="sm" variant="outline" onClick={() => reverse(row.id)}><RotateCcw className="ml-1 h-4 w-4" />عكس</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
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
  useEffect(() => { getAccountingAccounts().then((r) => setAccounts(r.data || [])); getCostCenters().then((r) => setCostCenters(r.data || [])); }, []);
  const totals = useMemo(() => ({ debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0), credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0) }), [lines]);
  const submit = async (status: "draft" | "pending_approval") => {
    const result = await createJournalEntry({ ...form, status, lines: lines.map((line) => ({ ...line, debit: Number(line.debit || 0), credit: Number(line.credit || 0), cost_center_id: line.cost_center_id || null })) });
    if (result.error) setMessage(result.error);
    else router.push(`/accounting/journal-entries/${result.data?.id}`);
  };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء قيود محاسبية." />;
  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} />
      <AccountingPageHeader title="قيد يومية جديد" description="أضف سطور المدين والدائن ثم احفظ القيد كمسودة أو أرسله للاعتماد." />
      <Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5"><div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>تاريخ القيد</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm((p) => ({ ...p, entry_date: e.target.value }))} /></div><div className="space-y-2 md:col-span-2"><Label>الوصف</Label><Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div></div><JournalLinesEditor accounts={accounts} costCenters={costCenters} lines={lines} setLines={setLines} /><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 text-sm"><div>إجمالي المدين: <MoneyAmount value={totals.debit} /> · إجمالي الدائن: <MoneyAmount value={totals.credit} /></div><div className={totals.debit === totals.credit ? "text-green-700" : "text-red-700"}>{totals.debit === totals.credit ? "القيد متوازن" : "القيد غير متوازن"}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => submit("draft")}><Save className="ml-2 h-4 w-4" />حفظ مسودة</Button><Button className="bg-brand text-white hover:bg-brand-dark" onClick={() => submit("pending_approval")}>إرسال للاعتماد</Button></div></CardContent></Card>
    </div>
  );
}

function JournalLinesEditor({ accounts, costCenters, lines, setLines }: { accounts: AccountingAccount[]; costCenters: AccountingCostCenter[]; lines: JournalLineDraft[]; setLines: React.Dispatch<React.SetStateAction<JournalLineDraft[]>> }) {
  const patch = (index: number, key: keyof JournalLineDraft, value: string) => setLines(lines.map((line, i) => i === index ? { ...line, [key]: value } : line));
  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div key={index} className="grid gap-3 rounded-lg border border-gray-100 bg-white p-3 md:grid-cols-[1.5fr_1fr_110px_110px_1fr_auto]">
          <SelectField value={line.account_id || ""} onChange={(value) => patch(index, "account_id", value)}><option value="">اختر الحساب</option>{accounts.filter((a) => a.is_active).map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}</SelectField>
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
  const { canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getJournalEntry(id), [id]);
  const post = async () => { const r = await postJournalEntry(id); if (r.error) setMessage(r.error); else load(); };
  const reverse = async () => { const r = await reverseJournalEntry(id, "عكس من صفحة التفاصيل"); if (r.error) setMessage(r.error); else load(); };
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="القيد غير موجود" />;
  const lines = data.lines || [];
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={`قيد ${data.entry_no}`} description={data.description} actions={canPost ? <>{["draft", "pending_approval"].includes(data.status) ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={post}>ترحيل</Button> : null}{data.status === "posted" ? <Button variant="outline" onClick={reverse}>عكس القيد</Button> : null}</> : null} /><Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-4"><AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} /><AccountingStatCard label="التاريخ" value={data.entry_date} /><AccountingStatCard label="إجمالي المدين" value={<MoneyAmount value={data.total_debit} />} /><AccountingStatCard label="إجمالي الدائن" value={<MoneyAmount value={data.total_credit} />} /></CardContent></Card><SimpleTable rows={lines} emptyTitle="لا توجد سطور" columns={[["account.code", "الحساب"], ["description", "الوصف"], ["debit", "مدين"], ["credit", "دائن"]]} moneyColumns={["debit", "credit"]} /></div>;
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
  const [form, setForm] = useState({ expense_date: today(), vendor_id: "", category_account_id: "", payment_account_id: "", cost_center_id: "", description: "", amount_before_vat: "", vat_amount: "", status: "pending_approval" });
  useEffect(() => { getAccountingAccounts().then((r) => setAccounts(r.data || [])); getCostCenters().then((r) => setCostCenters(r.data || [])); getVendors().then((r) => setVendors(r.data || [])); }, []);
  const submit = async () => { const r = await createExpense(form); if (r.error) setMessage(r.error); else router.push(`/accounting/expenses/${r.data?.id}`); };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء مصروفات." />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="مصروف جديد" /><Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-2"><Input type="date" value={form.expense_date} onChange={(e) => setForm((p) => ({ ...p, expense_date: e.target.value }))} /><SelectField value={form.vendor_id} onChange={(v) => setForm((p) => ({ ...p, vendor_id: v }))}><option value="">المورد</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name_ar}</option>)}</SelectField><SelectField value={form.category_account_id} onChange={(v) => setForm((p) => ({ ...p, category_account_id: v }))}><option value="">حساب المصروف</option>{accounts.filter((a) => a.type === "expense").map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}</SelectField><SelectField value={form.cost_center_id} onChange={(v) => setForm((p) => ({ ...p, cost_center_id: v }))}><option value="">مركز التكلفة</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</SelectField><Input placeholder="الوصف" className="md:col-span-2" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /><Input type="number" placeholder="المبلغ قبل الضريبة" value={form.amount_before_vat} onChange={(e) => setForm((p) => ({ ...p, amount_before_vat: e.target.value }))} /><Input type="number" placeholder="ضريبة القيمة المضافة" value={form.vat_amount} onChange={(e) => setForm((p) => ({ ...p, vat_amount: e.target.value }))} /><div className="md:col-span-2 flex justify-end"><Button className="bg-brand text-white hover:bg-brand-dark" onClick={submit}>حفظ المصروف</Button></div></CardContent></Card></div>;
}

function ExpenseDetail({ id }: { id: string }) {
  const { canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getExpense(id), [id]);
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="المصروف غير موجود" />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={`مصروف ${data.expense_no}`} description={data.description} actions={canPost ? <>{["draft", "pending_approval"].includes(data.status) ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={async () => { const r = await approveExpense(id); if (r.error) setMessage(r.error); else load(); }}>اعتماد</Button> : null}{data.status === "approved" ? <Button variant="outline" onClick={async () => { const r = await payExpense(id); if (r.error) setMessage(r.error); else load(); }}>سداد</Button> : null}{["draft", "pending_approval"].includes(data.status) ? <Button variant="outline" className="text-red-700" onClick={async () => { const r = await rejectExpense(id, "مرفوض من شاشة التفاصيل"); if (r.error) setMessage(r.error); else load(); }}>رفض</Button> : null}</> : null} /><div className="grid gap-4 md:grid-cols-4"><AccountingStatCard label="المبلغ" value={<MoneyAmount value={data.total_amount} />} /><AccountingStatCard label="الضريبة" value={<MoneyAmount value={data.vat_amount} />} /><AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} /><AccountingStatCard label="السداد" value={<AccountingStatusBadge status={data.paid_status} />} /></div></div>;
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
  const [form, setForm] = useState({ customer_id: "", invoice_date: today(), due_date: "", notes: "" });
  const [lines, setLines] = useState([{ description_ar: "", quantity: "1", unit_price: "", discount_amount: "", vat_amount: "" }]);
  useEffect(() => { getCustomers().then((r) => setCustomers(r.data || [])); }, []);
  const submit = async () => { const r = await createInvoice({ ...form, lines }); if (r.error) setMessage(r.error); else router.push(`/accounting/invoices/${r.data?.id}`); };
  if (!canManage) return <AccountingEmptyState title="صلاحية القراءة فقط" description="لا يمكن لهذا الدور إنشاء فواتير." />;
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title="فاتورة جديدة" /><Card className="border-none shadow-sm"><CardContent className="space-y-4 p-5"><div className="grid gap-4 md:grid-cols-3"><SelectField value={form.customer_id} onChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}><option value="">العميل</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</SelectField><Input type="date" value={form.invoice_date} onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))} /><Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} /></div><div className="space-y-3">{lines.map((line, i) => <div key={i} className="grid gap-3 rounded-lg border border-gray-100 p-3 md:grid-cols-[1.5fr_90px_120px_120px_120px_auto]"><Input placeholder="الوصف" value={line.description_ar} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, description_ar: e.target.value } : l))} /><Input type="number" placeholder="الكمية" value={line.quantity} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, quantity: e.target.value } : l))} /><Input type="number" placeholder="سعر الوحدة" value={line.unit_price} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, unit_price: e.target.value } : l))} /><Input type="number" placeholder="خصم" value={line.discount_amount} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, discount_amount: e.target.value } : l))} /><Input type="number" placeholder="ضريبة" value={line.vat_amount} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, vat_amount: e.target.value } : l))} /><Button variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>حذف</Button></div>)}</div><Button variant="outline" onClick={() => setLines([...lines, { description_ar: "", quantity: "1", unit_price: "", discount_amount: "", vat_amount: "" }])}>إضافة بند</Button><div className="flex justify-end"><Button className="bg-brand text-white hover:bg-brand-dark" onClick={submit}>حفظ الفاتورة</Button></div></CardContent></Card></div>;
}

function InvoiceDetail({ id }: { id: string }) {
  const { canPost } = useAccountingCapabilities();
  const { data, loading, message, setMessage, load } = useLoad(() => getInvoice(id), [id]);
  const [amount, setAmount] = useState("");
  if (loading) return <AccountingLoading />;
  if (!data) return <AccountingEmptyState title="الفاتورة غير موجودة" />;
  const lines = data.lines || [];
  return <div className="space-y-6"><MessageDialog open={Boolean(message)} onOpenChange={(o) => !o && setMessage("")} description={message} /><AccountingPageHeader title={`فاتورة ${data.invoice_no}`} description={`تاريخ الفاتورة ${data.invoice_date}`} actions={canPost ? <>{data.status === "draft" ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={async () => { const r = await issueInvoice(id); if (r.error) setMessage(r.error); else load(); }}>إصدار</Button> : null}{["issued", "partially_paid"].includes(data.status) ? <div className="flex gap-2"><Input className="w-36" type="number" placeholder="مبلغ السداد" value={amount} onChange={(e) => setAmount(e.target.value)} /><Button variant="outline" onClick={async () => { const r = await recordInvoicePayment(id, { amount: Number(amount || data.balance_due), payment_date: today() }); if (r.error) setMessage(r.error); else { setAmount(""); load(); } }}>تسجيل سداد</Button></div> : null}</> : null} /><div className="grid gap-4 md:grid-cols-4"><AccountingStatCard label="الإجمالي" value={<MoneyAmount value={data.total_amount} />} /><AccountingStatCard label="المدفوع" value={<MoneyAmount value={data.paid_amount} />} /><AccountingStatCard label="المتبقي" value={<MoneyAmount value={data.balance_due} />} /><AccountingStatCard label="الحالة" value={<AccountingStatusBadge status={data.status} />} /></div><SimpleTable rows={lines} emptyTitle="لا توجد بنود" columns={[["description_ar", "الوصف"], ["quantity", "الكمية"], ["unit_price", "سعر الوحدة"], ["vat_amount", "الضريبة"], ["line_total", "الإجمالي"]]} moneyColumns={["unit_price", "vat_amount", "line_total"]} /></div>;
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

function ReportsIndexPage() {
  const reports = [
    ["trial-balance", "ميزان المراجعة", BookOpen],
    ["general-ledger", "دفتر الأستاذ العام", Landmark],
    ["profit-loss", "قائمة الدخل", Receipt],
    ["balance-sheet", "الميزانية العمومية", Banknote],
    ["vat", "تقرير ضريبة القيمة المضافة", Receipt],
    ["payroll-cost", "تكلفة الرواتب", Banknote],
    ["employee-advances", "سلف الموظفين", ArrowRightLeft],
    ["ar-aging", "أعمار الذمم المدينة", Receipt],
    ["ap-aging", "أعمار الذمم الدائنة", Receipt],
    ["expenses", "مصروفات حسب المركز", Receipt],
    ["sales-revenue", "إيرادات المبيعات", Receipt],
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
  };
  return labels[report] || "تقرير مالي";
}

function ReportRenderer({ data }: { data: unknown }) {
  if (!data) return <AccountingEmptyState title="لا توجد بيانات للتقرير" />;
  if (Array.isArray(data)) return <SimpleTable rows={data as Record<string, unknown>[]} emptyTitle="لا توجد بيانات" moneyColumns={["debit", "credit", "balance"]} />;
  const object = data as Record<string, unknown>;
  return <div className="space-y-4">{Object.entries(object).map(([key, value]) => Array.isArray(value) ? <Card key={key} className="border-none shadow-sm"><CardHeader><CardTitle>{key}</CardTitle></CardHeader><CardContent className="p-0"><SimpleTable rows={value as Record<string, unknown>[]} emptyTitle="لا توجد بيانات" moneyColumns={["debit", "credit", "balance", "amount", "total_amount", "net_salary"]} /></CardContent></Card> : <AccountingStatCard key={key} label={key} value={typeof value === "number" ? <MoneyAmount value={value} /> : String(value)} />)}</div>;
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
