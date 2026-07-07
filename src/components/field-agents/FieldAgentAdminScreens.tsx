"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgePercent,
  Check,
  CreditCard,
  Eye,
  FileDown,
  FileImage,
  History,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Send,
  SlidersHorizontal,
  Smartphone,
  Store,
  Upload,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  assignSims,
  collectCash,
  confirmSimBoxImport,
  createFieldAgent,
  getCashCollections,
  getCommissions,
  getFieldAgent,
  getFieldAgents,
  getAgentSales,
  getSimImportBatches,
  getSimRequests,
  getSimTransfers,
  getSimUnits,
  getStockOverview,
  importSims,
  markCommissionPaid,
  previewSimBoxImport,
  reviewSimRequest,
  updateFieldAgent,
} from "@/lib/services/field-agents";
import {
  confirmMerchantPayment,
  createSimPackage,
  getMerchantCollections,
  getMerchants,
  getResellerRanking,
  getSimPackages,
  updateSimPackage,
} from "@/lib/services/merchants";
import {
  extractBarcodeWithZxing,
  extractTextWithTesseract,
  parseSimBoxText,
} from "@/lib/sim-box-local-ocr";
import type {
  AgentCashCollection,
  AgentCommission,
  AgentSaleRecord,
  AgentSalesResponse,
  AgentSimRequest,
  FieldAgent,
  SimBoxPreviewResult,
  SimImportBatch,
  SimPackage,
  SimTransfer,
  SimUnit,
  StockOverview,
} from "@/types/field-agents";
import type { Merchant, MerchantCashCollection, ResellerRanking } from "@/types/merchants";

type Message = { tone: "success" | "error"; text: string } | null;

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const paymentMethodLabels: Record<string, string> = {
  cash: "نقدي",
  bank_transfer: "تحويل بنكي",
  visa: "فيزا",
  electronic: "دفع إلكتروني",
};

const simStatusLabels: Record<string, string> = {
  in_stock: "في المخزون",
  with_agent: "مع المندوب",
  with_merchant: "مع التاجر",
  sold: "مباعة",
  returned: "مرتجعة",
};

function MessageBanner({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        message.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {message.text}
    </div>
  );
}

function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function statusBadge(status: string, labels: Record<string, string>) {
  const tone =
    status === "sold" || status === "approved" || status === "delivered"
      ? "bg-emerald-100 text-emerald-700"
      : status === "rejected" || status === "returned"
        ? "bg-red-100 text-red-700"
        : status === "with_agent" || status === "with_merchant" || status === "pending"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
  return <Badge className={`border-0 ${tone}`}>{labels[status] || status}</Badge>;
}

function DetailTile({ label, value, dir }: { label: string; value: unknown; dir?: "rtl" | "ltr" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950" dir={dir}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </p>
    </div>
  );
}

const agentDetailTabClass =
  "h-12 flex-none gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-800 shadow-sm transition-colors data-active:border-[#58ad42] data-active:bg-[#58ad42] data-active:text-white data-active:shadow-sm";

const agentDetailTabCountClass =
  "inline-flex h-7 min-w-9 items-center justify-center rounded border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-700";

// ---------------------------------------------------------------------------
// Create agent dialog
// ---------------------------------------------------------------------------
function CreateAgentDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    national_id: "",
    region: "",
    commission_rate: "0",
    sim_price: "0",
    max_sim_capacity: "",
  });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (form.password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
      setSubmitting(false);
      return;
    }
    const payload: Record<string, unknown> = {
      email: form.email.trim(),
      password: form.password,
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      national_id: form.national_id.trim(),
      commission_rate: Number(form.commission_rate || 0),
      sim_price: Number(form.sim_price || 0),
    };
    if (form.region.trim()) payload.region = form.region.trim();
    if (form.max_sim_capacity.trim()) payload.max_sim_capacity = Number(form.max_sim_capacity);
    const result = await createFieldAgent(payload);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ email: "", password: "", full_name: "", phone: "", national_id: "", region: "", commission_rate: "0", sim_price: "0", max_sim_capacity: "" });
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="ml-2 h-4 w-4" />
        مندوب جديد
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة مندوب ميداني</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>البريد الإلكتروني (تسجيل الدخول)</Label>
            <Input dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input dir="ltr" type="text" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="8 أحرف على الأقل" />
          </div>
          <div className="space-y-2">
            <Label>الاسم الكامل</Label>
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الجوال</Label>
            <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>رقم الهوية</Label>
            <Input dir="ltr" value={form.national_id} onChange={(e) => set("national_id", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المنطقة</Label>
            <Input value={form.region} onChange={(e) => set("region", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>نسبة العمولة %</Label>
            <Input type="number" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>سعر الشريحة على المندوب</Label>
            <Input type="number" value={form.sim_price} onChange={(e) => set("sim_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الحد الأقصى للشرائح</Label>
            <Input type="number" value={form.max_sim_capacity} onChange={(e) => set("max_sim_capacity", e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          سيتم إنشاء حساب دخول جديد للمندوب بدور field_agent تلقائيًا.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={submitting}>
            حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Agent list
// ---------------------------------------------------------------------------
export function AgentListScreen() {
  const [agents, setAgents] = useState<FieldAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    setLoading(true);
    getFieldAgents().then((result) => {
      setLoading(false);
      if (result.error) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setAgents(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6" dir="rtl">
      <PageTitle
        title="المندوبون الميدانيون"
        subtitle="إدارة مندوبي توزيع الشرائح ومتابعة أدائهم."
        actions={
          <>
            <Button variant="outline" onClick={load}>
              <RefreshCcw className="ml-2 h-4 w-4" />
              تحديث
            </Button>
            <CreateAgentDialog onCreated={load} />
          </>
        }
      />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">قائمة المندوبين</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>المنطقة</TableHead>
                <TableHead>سعر الشريحة</TableHead>
                <TableHead>العمولة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-400">
                    جارِ التحميل...
                  </TableCell>
                </TableRow>
              ) : agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-400">
                    لا يوجد مندوبون بعد.
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.full_name}</TableCell>
                    <TableCell dir="ltr">{agent.phone}</TableCell>
                    <TableCell>{agent.region || "—"}</TableCell>
                    <TableCell>{formatMoney(agent.sim_price)}</TableCell>
                    <TableCell>{agent.commission_rate}%</TableCell>
                    <TableCell>
                      {agent.status === "active" ? (
                        <Badge className="border-0 bg-emerald-100 text-emerald-700">نشط</Badge>
                      ) : (
                        <Badge className="border-0 bg-red-100 text-red-700">موقوف</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/sales/agents/${agent.id}`}>
                          التفاصيل
                          <ArrowRight className="mr-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collect cash dialog
// ---------------------------------------------------------------------------
function CollectCashDialog({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    payment_method: "cash",
    collection_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await collectCash({
      agent_id: agentId,
      amount: Number(form.amount || 0),
      payment_method: form.payment_method,
      collection_date: form.collection_date,
      notes: form.notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ amount: "", payment_method: "cash", collection_date: new Date().toISOString().slice(0, 10), notes: "" });
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Wallet className="ml-2 h-4 w-4" />
        تحصيل نقدية
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تسجيل تحصيل نقدي</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>المبلغ</Label>
            <Input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>طريقة الدفع</Label>
            <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v ?? "cash")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">نقدي</SelectItem>
                <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>التاريخ</Label>
            <Input type="date" value={form.collection_date} onChange={(e) => set("collection_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={submitting}>
              حفظ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditAgentTermsDialog({ agent, onDone }: { agent: FieldAgent; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    sim_price: String(agent.sim_price ?? 0),
    commission_rate: String(agent.commission_rate ?? 0),
    max_sim_capacity: agent.max_sim_capacity == null ? "" : String(agent.max_sim_capacity),
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      sim_price: String(agent.sim_price ?? 0),
      commission_rate: String(agent.commission_rate ?? 0),
      max_sim_capacity: agent.max_sim_capacity == null ? "" : String(agent.max_sim_capacity),
    });
    setError(null);
  }, [agent, open]);

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await updateFieldAgent(agent.id, {
      sim_price: Number(form.sim_price || 0),
      commission_rate: Number(form.commission_rate || 0),
      max_sim_capacity: form.max_sim_capacity.trim() ? Number(form.max_sim_capacity) : null,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <SlidersHorizontal className="ml-2 h-4 w-4" />
        شروط المندوب
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل شروط المندوب</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>سعر الشريحة على المندوب</Label>
            <Input type="number" value={form.sim_price} onChange={(e) => set("sim_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>نسبة عمولة المندوب %</Label>
            <Input type="number" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الحد الأقصى للشرائح</Label>
            <Input type="number" value={form.max_sim_capacity} onChange={(e) => set("max_sim_capacity", e.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={submitting}>
              حفظ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------
export function AgentDetailScreen({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<FieldAgent | null>(null);
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [collections, setCollections] = useState<AgentCashCollection[]>([]);
  const [commissions, setCommissions] = useState<AgentCommission[]>([]);
  const [salesData, setSalesData] = useState<AgentSalesResponse | null>(null);
  const [salesSearch, setSalesSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<AgentSaleRecord | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getFieldAgent(agentId),
      getAgentSales(agentId),
      getSimUnits({ agent_id: agentId }),
      getCashCollections(agentId),
      getCommissions({ agent_id: agentId }),
    ]).then(([agentResult, salesResult, simResult, collectionResult, commissionResult]) => {
      if (agentResult.error) setMessage({ tone: "error", text: agentResult.error.message });
      if (salesResult.error) setMessage({ tone: "error", text: salesResult.error.message });
      setAgent(agentResult.data);
      setSalesData(salesResult.data);
      setSims(rows(simResult.data));
      setCollections(rows(collectionResult.data));
      setCommissions(rows(commissionResult.data));
    });
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const soldDebt = useMemo(
    () => salesData?.summary.total_value ?? sims.filter((s) => s.status === "sold").reduce((sum, sim) => sum + Number(sim.sold_price || 0), 0),
    [salesData?.summary.total_value, sims]
  );
  const collected = useMemo(() => collections.reduce((sum, c) => sum + Number(c.amount || 0), 0), [collections]);
  const inHand = useMemo(() => sims.filter((s) => s.status === "with_agent").length, [sims]);
  const sales = rows(salesData?.sales);
  const salesSummary = salesData?.summary;
  const filteredSales = useMemo(() => {
    const q = salesSearch.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((sale) =>
      [
        sale.customer_name,
        sale.customer_national_id,
        sale.customer_absher_mobile,
        sale.customer_email,
        sale.sim_iccid,
        sale.package_name,
        sale.package_reference,
        sale.merchant_name,
        sale.merchant_owner_name,
        sale.device_serial,
        sale.city_district,
        sale.national_address,
        sale.supervisor_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [sales, salesSearch]);

  const toggleStatus = async () => {
    if (!agent) return;
    const result = await updateFieldAgent(agent.id, {
      status: agent.status === "active" ? "suspended" : "active",
    });
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    load();
  };

  if (!agent) {
    return (
      <div className="space-y-6" dir="rtl">
        <MessageBanner message={message} />
        <p className="text-slate-400">جارِ التحميل...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageTitle
        title={agent.full_name}
        subtitle={`${agent.region || "بدون منطقة"} · سعر الشريحة ${formatMoney(agent.sim_price)} · عمولة ${agent.commission_rate}%`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/sales/agents">
                <ArrowRight className="ml-2 h-4 w-4" />
                رجوع
              </Link>
            </Button>
            <CollectCashDialog agentId={agent.id} onDone={load} />
            <EditAgentTermsDialog agent={agent} onDone={load} />
            <Button variant={agent.status === "active" ? "destructive" : "default"} onClick={toggleStatus}>
              {agent.status === "active" ? "إيقاف" : "تفعيل"}
            </Button>
          </>
        }
      />
      <MessageBanner message={message} />
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="شرائح في اليد" value={String(inHand)} />
        <StatCard label="إجمالي المبيعات" value={String(salesSummary?.total_count ?? sales.length)} hint={formatMoney(soldDebt)} />
        <StatCard label="بيع مباشر" value={String(salesSummary?.direct_count ?? sales.filter((sale) => sale.seller_type === "agent").length)} hint={formatMoney(salesSummary?.direct_value)} />
        <StatCard label="بيع عبر التجار" value={String(salesSummary?.merchant_count ?? sales.filter((sale) => sale.seller_type === "merchant").length)} hint={formatMoney(salesSummary?.merchant_value)} />
        <StatCard label="عمولة المندوب" value={formatMoney(salesSummary?.agent_commission_amount)} hint={`المحصل: ${formatMoney(collected)}`} />
      </div>

      <Tabs defaultValue="sales" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-end gap-3 rounded-none bg-transparent p-0 shadow-none">
          <TabsTrigger value="sales" className={agentDetailTabClass}>
            <span className={agentDetailTabCountClass}>
              {salesSummary?.total_count ?? sales.length}
            </span>
            المبيعات
            <CreditCard className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="sims" className={agentDetailTabClass}>
            <span className={agentDetailTabCountClass}>
              {sims.length}
            </span>
            الشرائح
            <Smartphone className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="collections" className={agentDetailTabClass}>
            <span className={agentDetailTabCountClass}>
              {collections.length}
            </span>
            التحصيلات
            <Wallet className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="commissions" className={agentDetailTabClass}>
            <span className={agentDetailTabCountClass}>
              {commissions.length}
            </span>
            العمولات
            <BadgePercent className="h-4 w-4" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader className="gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                مبيعات المندوب
              </CardTitle>
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={salesSearch}
                  onChange={(event) => setSalesSearch(event.target.value)}
                  placeholder="بحث بالعميل، التاجر، الشريحة، الباقة، الجهاز، أو العنوان"
                  className="pr-9"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العميل</TableHead>
                    <TableHead>قناة البيع</TableHead>
                    <TableHead className="hidden lg:table-cell">التاجر</TableHead>
                    <TableHead>الباقة / الشريحة</TableHead>
                    <TableHead className="hidden md:table-cell">التاريخ</TableHead>
                    <TableHead>قيمة البيع</TableHead>
                    <TableHead className="hidden xl:table-cell">عمولة المندوب</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-14 text-center text-slate-400">
                        لا توجد مبيعات لهذا المندوب.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSales.map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell>
                          <div className="font-semibold text-slate-950">
                            {sale.customer_name || "عميل بدون اسم"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400" dir="ltr">
                            {sale.customer_absher_mobile || sale.customer_national_id || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {sale.seller_type === "merchant" ? (
                            <Badge className="border-0 bg-blue-100 text-blue-700">
                              <Store className="ml-1 h-3.5 w-3.5" />
                              تاجر
                            </Badge>
                          ) : (
                            <Badge className="border-0 bg-emerald-100 text-emerald-700">
                              <UserRound className="ml-1 h-3.5 w-3.5" />
                              مباشر
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {sale.merchant_name || (sale.seller_type === "agent" ? "بيع مباشر" : "—")}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{sale.package_name || sale.package_reference || "—"}</div>
                          <div className="mt-1 text-xs text-slate-400" dir="ltr">
                            {sale.sim_iccid || sale.sim_unit_id}
                          </div>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs text-slate-500 md:table-cell" dir="ltr">
                          {formatDateTime(sale.sold_at)}
                        </TableCell>
                        <TableCell className="font-bold text-emerald-700">{formatMoney(sale.sale_price)}</TableCell>
                        <TableCell className="hidden font-semibold text-amber-700 xl:table-cell">
                          {formatMoney(sale.agent_commission_amount)}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setSelectedSale(sale)}>
                            <Eye className="ml-2 h-4 w-4" />
                            تفاصيل
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sims">
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">الشرائح</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kit Code / ICCID</TableHead>
                    <TableHead>المزود</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الباقة</TableHead>
                    <TableHead>سعر البيع</TableHead>
                    <TableHead>العميل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-400">
                        لا توجد شرائح.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sims.map((sim) => (
                      <TableRow key={sim.id}>
                        <TableCell dir="ltr">
                          <div className="font-medium">{sim.kit_code || sim.iccid}</div>
                          {sim.kit_code && sim.kit_code !== sim.iccid ? (
                            <div className="text-xs text-slate-400">{sim.iccid}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{sim.provider || "virgin"}</TableCell>
                        <TableCell>{sim.sim_type}</TableCell>
                        <TableCell>{statusBadge(sim.status, simStatusLabels)}</TableCell>
                        <TableCell>{sim.sold_package_name || "—"}</TableCell>
                        <TableCell>{sim.sold_price ? formatMoney(sim.sold_price) : "—"}</TableCell>
                        <TableCell>{sim.customer_name || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collections">
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">التحصيلات النقدية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {collections.length === 0 ? (
                <p className="text-sm text-slate-400">لا توجد تحصيلات.</p>
              ) : (
                collections.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                    <span>{c.collection_date}</span>
                    <span className="font-semibold">{formatMoney(c.amount)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">العمولات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {commissions.length === 0 ? (
                <p className="text-sm text-slate-400">لا توجد عمولات.</p>
              ) : (
                commissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                    <span>{formatMoney(c.commission_amount)}</span>
                    {c.is_paid ? (
                      <Badge className="border-0 bg-emerald-100 text-emerald-700">مدفوعة</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const result = await markCommissionPaid(c.id);
                          if (result.error) setMessage({ tone: "error", text: result.error.message });
                          else load();
                        }}
                      >
                        تعليم كمدفوعة
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedSale)} onOpenChange={(open) => !open && setSelectedSale(null)}>
        {selectedSale ? (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>تفاصيل بيع {selectedSale.customer_name || "عميل بدون اسم"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <DetailTile label="قناة البيع" value={selectedSale.seller_type === "merchant" ? "بيع عبر تاجر" : "بيع مباشر من المندوب"} />
                <DetailTile label="قيمة البيع" value={formatMoney(selectedSale.sale_price)} />
                <DetailTile label="التاريخ" value={formatDateTime(selectedSale.sold_at)} dir="ltr" />
                <DetailTile label="الباقة" value={selectedSale.package_name || selectedSale.package_reference} />
                <DetailTile label="عمولة المندوب" value={formatMoney(selectedSale.agent_commission_amount)} />
                <DetailTile label="عمولة التاجر" value={formatMoney(selectedSale.merchant_commission_amount)} />
                <DetailTile label="عمولة البيع المباشر" value={formatMoney(selectedSale.direct_agent_commission_amount)} />
                <DetailTile label="إجمالي العمولة" value={formatMoney(selectedSale.total_commission_amount)} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <DetailTile label="اسم العميل" value={selectedSale.customer_name} />
                <DetailTile label="هوية العميل" value={selectedSale.customer_national_id} dir="ltr" />
                <DetailTile label="جوال أبشر" value={selectedSale.customer_absher_mobile} dir="ltr" />
                <DetailTile label="البريد الإلكتروني" value={selectedSale.customer_email} dir="ltr" />
                <DetailTile label="تاريخ الميلاد هجري" value={selectedSale.customer_birth_date_hijri} dir="ltr" />
                <DetailTile label="انتهاء الهوية هجري" value={selectedSale.customer_id_expiry_hijri} dir="ltr" />
                <DetailTile label="الجنسية" value={selectedSale.customer_nationality} />
                <DetailTile label="المدينة / الحي" value={selectedSale.city_district} />
                <DetailTile label="العنوان الوطني" value={selectedSale.national_address} dir="ltr" />
                <DetailTile label="سيريال الجهاز" value={selectedSale.device_serial} dir="ltr" />
                <DetailTile label="مرجع الباقة" value={selectedSale.package_reference} />
                <DetailTile label="اسم المسوق" value={selectedSale.marketer_name} />
                <DetailTile label="المشرف" value={selectedSale.supervisor_name} />
                <DetailTile label="ICCID" value={selectedSale.sim_iccid || selectedSale.sim_unit_id} dir="ltr" />
                <DetailTile label="مزود الشريحة" value={selectedSale.sim_provider || selectedSale.package_provider} />
                <DetailTile label="نوع الشريحة" value={selectedSale.sim_type} />
                <DetailTile label="التاجر" value={selectedSale.merchant_name} />
                <DetailTile label="مالك التاجر" value={selectedSale.merchant_owner_name} />
                <DetailTile label="جوال التاجر" value={selectedSale.merchant_phone} dir="ltr" />
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import SIMs dialog
// ---------------------------------------------------------------------------
type ParsedSim = { iccid: string; sim_type: string; provider: string };

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pickColumn(headers: string[], candidates: string[]) {
  return headers.find((header) => candidates.some((candidate) => header.includes(candidate)));
}

function ImportSimsDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSim[]>([]);
  const [fileName, setFileName] = useState("");
  const [defaultType, setDefaultType] = useState("prepaid");
  const [defaultProvider, setDefaultProvider] = useState("virgin");

  const reset = () => {
    setParsed([]);
    setFileName("");
    setError(null);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) {
        setError("الملف لا يحتوي على أوراق عمل.");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (rows.length === 0) {
        setError("الملف فارغ.");
        return;
      }

      const headerMap = new Map<string, string>();
      Object.keys(rows[0]).forEach((key) => headerMap.set(normalizeHeader(key), key));
      const headers = Array.from(headerMap.keys());

      const iccidKey = headerMap.get(pickColumn(headers, ["iccid", "رقم", "الشريحة", "sim", "serial"]) || "");
      const typeKey = headerMap.get(pickColumn(headers, ["type", "نوع"]) || "");
      const providerKey = headerMap.get(pickColumn(headers, ["provider", "مزود", "شركة"]) || "");
      const rawKeys = Object.keys(rows[0]);

      const result: ParsedSim[] = [];
      for (const rowData of rows) {
        // Fall back to positional column A when headers are unlabeled.
        const iccidRaw = iccidKey ? rowData[iccidKey] : rowData[rawKeys[0]];
        const typeRaw = typeKey ? rowData[typeKey] : "";
        const providerRaw = providerKey ? rowData[providerKey] : "";
        const iccid = String(iccidRaw ?? "").trim();
        if (!iccid) continue;
        result.push({
          iccid,
          sim_type: String(typeRaw ?? "").trim() || defaultType,
          provider: String(providerRaw ?? "").trim().toLowerCase() || defaultProvider,
        });
      }

      if (result.length === 0) {
        setError("لم يتم العثور على أرقام ICCID في الملف. تأكد من عمود ICCID.");
        return;
      }
      setParsed(result);
    } catch {
      setError("تعذر قراءة الملف. تأكد من أنه ملف Excel أو CSV صالح.");
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["ICCID", "provider", "type"],
      ["8996000000000000001", "virgin", "prepaid"],
      ["8996000000000000002", "virgin", "prepaid"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "SIMs");
    XLSX.writeFile(workbook, "sim-import-template.xlsx");
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (parsed.length === 0) {
      setError("ارفع ملف Excel يحتوي على الشرائح أولًا.");
      setSubmitting(false);
      return;
    }
    const result = await importSims({
      sims: parsed.map((sim) => ({ iccid: sim.iccid, provider: sim.provider, sim_type: sim.sim_type, price: 0 })),
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    reset();
    onDone();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="ml-2 h-4 w-4" />
        استيراد شرائح
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>استيراد شرائح من Excel</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm text-slate-700">
            <p className="mb-2 font-semibold text-slate-900">تعليمات الملف:</p>
            <ul className="list-disc space-y-1 pr-5 text-xs leading-6">
              <li>
                استخدم أعمدة بالعناوين: <span className="font-mono">ICCID</span> ،{" "}
                <span className="font-mono">provider</span> ، و<span className="font-mono">type</span> (اختياري).
              </li>
              <li>عمود ICCID إلزامي — يحتوي رقم الشريحة (18-22 رقمًا).</li>
              <li>عمود provider يربط الشريحة بمزود الباقات؛ إذا تُرك فارغًا يُستخدم Virgin.</li>
              <li>إذا لم يوجد عمود type يُستخدم النوع الافتراضي المحدد أدناه.</li>
              <li>السعر لا يُستورد مع الشريحة؛ السعر والعمولات تُحسب من الباقة عند البيع.</li>
            </ul>
            <Button variant="outline" size="sm" className="mt-3" onClick={downloadTemplate}>
              <FileDown className="ml-2 h-4 w-4" />
              تنزيل نموذج Excel
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>المزود الافتراضي</Label>
              <Select value={defaultProvider} onValueChange={(v) => setDefaultProvider(v ?? "virgin")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="virgin">Virgin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>النوع الافتراضي</Label>
              <Select value={defaultType} onValueChange={(v) => setDefaultType(v ?? "prepaid")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">مدفوعة مسبقًا</SelectItem>
                  <SelectItem value="postpaid">فوترة</SelectItem>
                  <SelectItem value="data">بيانات</SelectItem>
                  <SelectItem value="corporate">شركات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>ملف Excel / CSV</Label>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {parsed.length > 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              تم التعرف على <span className="font-bold">{parsed.length}</span> شريحة من{" "}
              <span className="font-mono">{fileName}</span>.
              <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                {parsed.slice(0, 5).map((sim, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600" dir="ltr">
                    <span>{sim.iccid}</span>
                    <span>{sim.provider} · {sim.sim_type}</span>
                  </div>
                ))}
                {parsed.length > 5 ? <p className="text-xs text-slate-400">…والمزيد</p> : null}
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={submitting || parsed.length === 0}>
              استيراد {parsed.length > 0 ? `(${parsed.length})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SIM box OCR import dialog
// ---------------------------------------------------------------------------
type SimBoxImportForm = {
  provider: string;
  order_number: string;
  batch_number: string;
  barcode_text: string;
  first_kitcode: string;
  last_kitcode: string;
  quantity: string;
  dealer_box_number: string;
  dealer_box_total: string;
  assigned_agent_id: string;
  duplicateStrategy: "fail" | "skip";
};

const emptySimBoxForm: SimBoxImportForm = {
  provider: "virgin",
  order_number: "",
  batch_number: "",
  barcode_text: "",
  first_kitcode: "",
  last_kitcode: "",
  quantity: "",
  dealer_box_number: "",
  dealer_box_total: "",
  assigned_agent_id: "",
  duplicateStrategy: "fail",
};

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function SimBoxImportDialog({ agents, onDone }: { agents: FieldAgent[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [preview, setPreview] = useState<SimBoxPreviewResult | null>(null);
  const [form, setForm] = useState<SimBoxImportForm>(emptySimBoxForm);
  const [reading, setReading] = useState(false);
  const [validatingPreview, setValidatingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [imagePath, setImagePath] = useState("");
  const [rawOcrText, setRawOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [localWarnings, setLocalWarnings] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const setField = <K extends keyof SimBoxImportForm>(key: K, value: SimBoxImportForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (["provider", "first_kitcode", "last_kitcode", "quantity"].includes(String(key))) {
      setPreview(null);
    }
  };

  const reset = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl("");
    setImageFile(null);
    setPreview(null);
    setForm(emptySimBoxForm);
    setMessage(null);
    setImagePath("");
    setRawOcrText("");
    setOcrConfidence(null);
    setLocalWarnings([]);
    setReading(false);
    setValidatingPreview(false);
    setSubmitting(false);
  };

  const selectImage = (file: File | null) => {
    setMessage(null);
    setPreview(null);
    setImagePath("");
    setRawOcrText("");
    setOcrConfidence(null);
    setLocalWarnings([]);
    setImageFile(file);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return file ? URL.createObjectURL(file) : "";
    });
  };

  const requestServerPreview = async (
    nextForm: SimBoxImportForm,
    options?: {
      uploadImage?: boolean;
      rawText?: string;
      confidence?: number | null;
      warnings?: string[];
    }
  ) => {
    setValidatingPreview(true);
    setMessage(null);
    if (!imageFile) {
      setMessage({ tone: "error", text: "اختر صورة العلبة أولا أو أدخل البيانات يدويا ثم أعد المحاولة." });
      setValidatingPreview(false);
      return false;
    }
    const body = new FormData();
    if (options?.uploadImage || !imagePath) body.append("image", imageFile);
    else body.append("image_path", imagePath);
    body.append("provider", nextForm.provider.trim());
    body.append("order_number", nextForm.order_number.trim());
    body.append("batch_number", nextForm.batch_number.trim());
    body.append("barcode_text", nextForm.barcode_text.trim());
    body.append("first_kitcode", nextForm.first_kitcode.trim());
    body.append("last_kitcode", nextForm.last_kitcode.trim());
    body.append("quantity", nextForm.quantity.trim());
    body.append("dealer_box_number", nextForm.dealer_box_number.trim());
    body.append("dealer_box_total", nextForm.dealer_box_total.trim());
    body.append("raw_ocr_text", options?.rawText ?? rawOcrText);
    if (options?.confidence != null) body.append("confidence", String(options.confidence));
    else if (ocrConfidence != null) body.append("confidence", String(ocrConfidence));
    body.append("raw_notes", JSON.stringify(options?.warnings ?? localWarnings));

    const result = await previewSimBoxImport(body);
    setValidatingPreview(false);
    if (result.error || !result.data) {
      setMessage({ tone: "error", text: result.error?.message || "تعذر تحديث معاينة الاستيراد." });
      return false;
    }

    const extracted = result.data.extracted;
    setPreview(result.data);
    setImagePath(result.data.image_path || imagePath);
    setForm((current) => ({
      ...current,
      provider: extracted.provider || current.provider || "virgin",
      order_number: extracted.order_number || current.order_number,
      batch_number: extracted.batch_number || current.batch_number,
      barcode_text: extracted.barcode_text || current.barcode_text,
      first_kitcode: extracted.first_kitcode || current.first_kitcode,
      last_kitcode: extracted.last_kitcode || current.last_kitcode,
      quantity: extracted.quantity ? String(extracted.quantity) : current.quantity,
      dealer_box_number: extracted.dealer_box_number ? String(extracted.dealer_box_number) : current.dealer_box_number,
      dealer_box_total: extracted.dealer_box_total ? String(extracted.dealer_box_total) : current.dealer_box_total,
    }));
    setMessage({ tone: "success", text: `تم توليد ${result.data.generation.generated_count} Kit Code للمراجعة.` });
    return true;
  };

  const readBox = async () => {
    if (!imageFile) {
      setMessage({ tone: "error", text: "اختر صورة العلبة أولا." });
      return;
    }
    setReading(true);
    setMessage(null);
    setPreview(null);

    try {
      const [ocrResult, barcodeText] = await Promise.all([
        extractTextWithTesseract(imageFile),
        extractBarcodeWithZxing(imageFile),
      ]);
      const parsed = parseSimBoxText(ocrResult.text);
      const warnings = [...parsed.raw_notes];
      if (!barcodeText) warnings.push("Barcode could not be read; please verify the text fields manually.");
      if (ocrResult.confidence != null && ocrResult.confidence < 65) {
        warnings.push("OCR confidence is low; review all fields before importing.");
      }

      const nextForm: SimBoxImportForm = {
        ...form,
        provider: parsed.provider || form.provider || "virgin",
        order_number: parsed.order_number || form.order_number,
        batch_number: parsed.batch_number || form.batch_number,
        barcode_text: barcodeText || parsed.barcode_text || form.barcode_text,
        first_kitcode: parsed.first_kitcode || form.first_kitcode,
        last_kitcode: parsed.last_kitcode || form.last_kitcode,
        quantity: parsed.quantity ? String(parsed.quantity) : form.quantity,
        dealer_box_number: parsed.dealer_box_number ? String(parsed.dealer_box_number) : form.dealer_box_number,
        dealer_box_total: parsed.dealer_box_total ? String(parsed.dealer_box_total) : form.dealer_box_total,
      };
      setRawOcrText(ocrResult.text);
      setOcrConfidence(ocrResult.confidence ?? null);
      setLocalWarnings(warnings);
      setForm(nextForm);
      await requestServerPreview(nextForm, {
        uploadImage: !imagePath,
        rawText: ocrResult.text,
        confidence: ocrResult.confidence ?? null,
        warnings,
      });
    } catch {
      setMessage({ tone: "error", text: "تعذر تشغيل OCR المحلي. يمكنك إدخال البيانات يدويا ثم تحديث المعاينة." });
    } finally {
      setReading(false);
    }
  };

  const duplicateSet = useMemo(
    () => new Set(preview?.validation.duplicate_kit_codes || []),
    [preview?.validation.duplicate_kit_codes]
  );
  const previewRows = useMemo(
    () =>
      (preview?.generation.kit_codes || []).map((kitCode, index) => ({
        sequence: index + 1,
        kitCode,
        duplicate: duplicateSet.has(kitCode),
      })),
    [duplicateSet, preview?.generation.kit_codes]
  );
  const hasBlockingDuplicates =
    (preview?.validation.duplicate_count || 0) > 0 && form.duplicateStrategy !== "skip";
  const canConfirm = Boolean(
    preview &&
      !submitting &&
      !reading &&
      !validatingPreview &&
      preview.validation.errors.length === 0 &&
      !hasBlockingDuplicates &&
      form.provider.trim() &&
      form.first_kitcode.trim() &&
      form.last_kitcode.trim() &&
      Number(form.quantity || 0) > 0
  );

  const submit = async () => {
    if (!preview) {
      setMessage({ tone: "error", text: "اقرأ بيانات العلبة قبل الحفظ." });
      return;
    }
    if (!canConfirm) {
      setMessage({ tone: "error", text: "راجع الأخطاء أو التكرارات قبل الحفظ." });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const result = await confirmSimBoxImport({
      provider: form.provider.trim(),
      order_number: optionalText(form.order_number),
      batch_number: optionalText(form.batch_number),
      barcode_text: optionalText(form.barcode_text),
      first_kitcode: form.first_kitcode.trim(),
      last_kitcode: form.last_kitcode.trim(),
      quantity: Number(form.quantity),
      dealer_box_number: optionalNumber(form.dealer_box_number),
      dealer_box_total: optionalNumber(form.dealer_box_total),
      step: preview.generation.step,
      image_path: imagePath || preview.image_path,
      extracted_json: preview.extracted,
      assigned_agent_id: form.assigned_agent_id || null,
      import_duplicate_strategy: form.duplicateStrategy,
    });
    setSubmitting(false);
    if (result.error || !result.data) {
      setMessage({ tone: "error", text: result.error?.message || "تعذر حفظ دفعة الاستيراد." });
      return;
    }
    setMessage({
      tone: "success",
      text: `تم حفظ ${result.data.inserted_count} شريحة. التكرارات المتخطاة: ${result.data.skipped_duplicates.length}.`,
    });
    onDone();
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <FileImage className="ml-2 h-4 w-4" />
        استيراد علبة OCR
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>استيراد علبة شرائح من صورة</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <Label className="mb-2 block">صورة العلبة</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept="image/*" onChange={(event) => selectImage(event.target.files?.[0] ?? null)} />
                <Button type="button" onClick={readBox} disabled={!imageFile || reading} className="shrink-0">
                  {reading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Upload className="ml-2 h-4 w-4" />}
                  قراءة محلية
                </Button>
              </div>
              {imagePreviewUrl ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreviewUrl} alt="SIM box" className="max-h-72 w-full object-contain" />
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">النتيجة</span>
                {preview ? (
                  <Badge className="border-0 bg-blue-100 text-blue-700">
                    {preview.generation.generated_count} Kit Code
                  </Badge>
                ) : null}
              </div>
              {preview ? (
                <div className="mt-3 grid gap-2 text-xs text-slate-600">
                  {ocrConfidence != null ? (
                    <div className="flex justify-between gap-2">
                      <span>ثقة OCR</span>
                      <span dir="ltr">{Math.round(ocrConfidence)}%</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-2">
                    <span>الخطوة</span>
                    <span dir="ltr">{preview.generation.step}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>التكرارات</span>
                    <span dir="ltr">{preview.validation.duplicate_count}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>مسار الصورة</span>
                    <span dir="ltr" className="max-w-44 truncate">
                      {preview.image_path}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">لم تتم القراءة بعد.</p>
              )}
            </div>

            {rawOcrText || localWarnings.length > 0 ? (
              <details className="rounded-lg border border-slate-200 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-900">نص OCR الخام</summary>
                {localWarnings.length > 0 ? (
                  <ul className="mt-3 list-disc space-y-1 pr-5 text-xs text-amber-700">
                    {localWarnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {rawOcrText ? (
                  <pre dir="ltr" className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                    {rawOcrText}
                  </pre>
                ) : null}
              </details>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>المزود</Label>
                <Input dir="ltr" value={form.provider} onChange={(event) => setField("provider", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>رقم الطلب</Label>
                <Input dir="ltr" value={form.order_number} onChange={(event) => setField("order_number", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>رقم الدفعة</Label>
                <Input dir="ltr" value={form.batch_number} onChange={(event) => setField("batch_number", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>أول Kit Code</Label>
                <Input dir="ltr" value={form.first_kitcode} onChange={(event) => setField("first_kitcode", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>آخر Kit Code</Label>
                <Input dir="ltr" value={form.last_kitcode} onChange={(event) => setField("last_kitcode", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>الكمية</Label>
                <Input dir="ltr" type="number" min="1" value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>رقم العلبة</Label>
                <Input dir="ltr" type="number" min="1" value={form.dealer_box_number} onChange={(event) => setField("dealer_box_number", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>إجمالي العلب</Label>
                <Input dir="ltr" type="number" min="1" value={form.dealer_box_total} onChange={(event) => setField("dealer_box_total", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>التسليم المباشر</Label>
                <Select value={form.assigned_agent_id || "none"} onValueChange={(value) => setField("assigned_agent_id", value === "none" ? "" : value ?? "")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">المخزون</SelectItem>
                    {agents
                      .filter((agent) => agent.status === "active")
                      .map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.full_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>النص المقروء من الباركود</Label>
                <Input dir="ltr" value={form.barcode_text} onChange={(event) => setField("barcode_text", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>التكرارات</Label>
                <Select value={form.duplicateStrategy} onValueChange={(value) => setField("duplicateStrategy", (value as "fail" | "skip") ?? "fail")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fail">إيقاف الحفظ</SelectItem>
                    <SelectItem value="skip">تخطي المتكرر</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                onClick={() => requestServerPreview(form, { uploadImage: !imagePath })}
                disabled={validatingPreview || reading || !form.first_kitcode.trim() || !form.last_kitcode.trim() || !form.quantity.trim()}
              >
                {validatingPreview ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="ml-2 h-4 w-4" />}
                تحديث المعاينة
              </Button>
            </div>

            {preview?.validation.errors.length ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  أخطاء المراجعة
                </div>
                <ul className="list-disc space-y-1 pr-5">
                  {preview.validation.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview?.validation.warnings.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  تنبيهات
                </div>
                <ul className="list-disc space-y-1 pr-5">
                  {preview.validation.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {message ? <MessageBanner message={message} /> : null}

            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">Kit Codes</span>
                {previewRows.length > 0 ? <span className="text-xs text-slate-500">{previewRows.length}</span> : null}
              </div>
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">#</TableHead>
                      <TableHead>Kit Code</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-slate-400">
                          لا توجد أرقام مولدة.
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewRows.map((item) => (
                        <TableRow key={`${item.sequence}-${item.kitCode}`}>
                          <TableCell dir="ltr">{item.sequence}</TableCell>
                          <TableCell dir="ltr" className="font-medium">
                            {item.kitCode}
                          </TableCell>
                          <TableCell>
                            {item.duplicate ? (
                              <Badge className="border-0 bg-red-100 text-red-700">متكرر</Badge>
                            ) : (
                              <Badge className="border-0 bg-emerald-100 text-emerald-700">جديد</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={submit} disabled={!canConfirm}>
                {submitting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Check className="ml-2 h-4 w-4" />}
                حفظ الدفعة
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Package terms
// ---------------------------------------------------------------------------
function commissionTypeLabel(type: string) {
  return type === "flat" ? "مبلغ ثابت" : "نسبة";
}

function commissionAmount(type: string, value: string, salePrice: string) {
  const numericValue = Number(value || 0);
  const price = Number(salePrice || 0);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return type === "percentage" ? (price * numericValue) / 100 : numericValue;
}

function commissionSplitWarning(form: {
  sale_price: string;
  total_commission_type: string;
  total_commission_value: string;
  agent_chain_commission_type: string;
  agent_chain_commission_value: string;
  merchant_commission_type: string;
  merchant_commission_value: string;
}) {
  const total = commissionAmount(form.total_commission_type, form.total_commission_value, form.sale_price);
  const split =
    commissionAmount(form.agent_chain_commission_type, form.agent_chain_commission_value, form.sale_price) +
    commissionAmount(form.merchant_commission_type, form.merchant_commission_value, form.sale_price);
  return Math.abs(total - split) > 0.01
    ? `تنبيه: مجموع عمولة بيع التاجر (${formatMoney(split)}) لا يساوي إجمالي العمولة (${formatMoney(total)}). يمكن الحفظ إذا كان ذلك مقصودا.`
    : "";
}

function CommissionTypeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "flat")}>
      <SelectTrigger>
        <SelectValue>{commissionTypeLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="flat">مبلغ ثابت</SelectItem>
        <SelectItem value="percentage">نسبة</SelectItem>
      </SelectContent>
    </Select>
  );
}

function PackageTermsDialog({ pkg, onDone }: { pkg: SimPackage; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    provider: pkg.provider || "virgin",
    package_name: pkg.package_name || "",
    internet_allowance: pkg.internet_allowance || "",
    minutes_allowance: pkg.minutes_allowance || "",
    validity: pkg.validity || "",
    sale_price: String(pkg.sale_price ?? 0),
    base_price: String(pkg.base_price ?? 0),
    tax_included: String(pkg.tax_included ?? true),
    commission_currency: pkg.commission_currency || "SAR",
    total_commission_type: pkg.total_commission_type || "flat",
    total_commission_value: String(pkg.total_commission_value ?? 15),
    agent_chain_commission_type: pkg.agent_chain_commission_type || pkg.agent_commission_type || "flat",
    agent_chain_commission_value: String(pkg.agent_chain_commission_value ?? pkg.agent_commission_value ?? 5),
    merchant_commission_type: pkg.merchant_commission_type || "flat",
    merchant_commission_value: String(pkg.merchant_commission_value ?? 10),
    direct_agent_commission_type: pkg.direct_agent_commission_type || "flat",
    direct_agent_commission_value: String(pkg.direct_agent_commission_value ?? pkg.total_commission_value ?? 15),
    commission_notes: pkg.commission_notes || "",
    status: pkg.status || "active",
  });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const warning = commissionSplitWarning(form);

  useEffect(() => {
    if (!open) return;
    setForm({
      provider: pkg.provider || "virgin",
      package_name: pkg.package_name || "",
      internet_allowance: pkg.internet_allowance || "",
      minutes_allowance: pkg.minutes_allowance || "",
      validity: pkg.validity || "",
      sale_price: String(pkg.sale_price ?? 0),
      base_price: String(pkg.base_price ?? 0),
      tax_included: String(pkg.tax_included ?? true),
      commission_currency: pkg.commission_currency || "SAR",
      total_commission_type: pkg.total_commission_type || "flat",
      total_commission_value: String(pkg.total_commission_value ?? 15),
      agent_chain_commission_type: pkg.agent_chain_commission_type || pkg.agent_commission_type || "flat",
      agent_chain_commission_value: String(pkg.agent_chain_commission_value ?? pkg.agent_commission_value ?? 5),
      merchant_commission_type: pkg.merchant_commission_type || "flat",
      merchant_commission_value: String(pkg.merchant_commission_value ?? 10),
      direct_agent_commission_type: pkg.direct_agent_commission_type || "flat",
      direct_agent_commission_value: String(pkg.direct_agent_commission_value ?? pkg.total_commission_value ?? 15),
      commission_notes: pkg.commission_notes || "",
      status: pkg.status || "active",
    });
    setError(null);
  }, [open, pkg]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!form.package_name.trim()) {
      setError("اسم الباقة مطلوب.");
      setSubmitting(false);
      return;
    }
    if (!form.commission_currency.trim()) {
      setError("العملة مطلوبة.");
      setSubmitting(false);
      return;
    }
    const numericKeys = [
      "sale_price",
      "base_price",
      "total_commission_value",
      "agent_chain_commission_value",
      "merchant_commission_value",
      "direct_agent_commission_value",
    ];
    if (numericKeys.some((key) => !Number.isFinite(Number(form[key as keyof typeof form] || 0)) || Number(form[key as keyof typeof form] || 0) < 0)) {
      setError("قيم الأسعار والعمولات يجب أن تكون أرقاما موجبة أو صفرا.");
      setSubmitting(false);
      return;
    }
    const result = await updateSimPackage(pkg.id, {
      provider: form.provider.trim() || "virgin",
      package_name: form.package_name.trim(),
      internet_allowance: form.internet_allowance.trim() || null,
      minutes_allowance: form.minutes_allowance.trim() || null,
      validity: form.validity.trim() || null,
      sale_price: Number(form.sale_price || 0),
      base_price: Number(form.base_price || 0),
      tax_included: form.tax_included === "true",
      commission_currency: form.commission_currency.trim() || "SAR",
      total_commission_type: form.total_commission_type,
      total_commission_value: Number(form.total_commission_value || 0),
      agent_chain_commission_type: form.agent_chain_commission_type,
      agent_chain_commission_value: Number(form.agent_chain_commission_value || 0),
      agent_commission_type: form.agent_chain_commission_type,
      agent_commission_value: Number(form.agent_chain_commission_value || 0),
      merchant_commission_type: form.merchant_commission_type,
      merchant_commission_value: Number(form.merchant_commission_value || 0),
      direct_agent_commission_type: form.direct_agent_commission_type,
      direct_agent_commission_value: Number(form.direct_agent_commission_value || 0),
      commission_notes: form.commission_notes.trim() || null,
      status: form.status,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal className="ml-2 h-4 w-4" />
        تعديل
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل الباقة</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>المزود</Label>
              <Input value={form.provider} onChange={(e) => set("provider", e.target.value)} placeholder="virgin" />
            </div>
            <div className="space-y-2">
              <Label>اسم الباقة</Label>
              <Input value={form.package_name} onChange={(e) => set("package_name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>الإنترنت</Label>
              <Input value={form.internet_allowance} onChange={(e) => set("internet_allowance", e.target.value)} placeholder="مثال: 56 GB" />
            </div>
            <div className="space-y-2">
              <Label>المكالمات</Label>
              <Input value={form.minutes_allowance} onChange={(e) => set("minutes_allowance", e.target.value)} placeholder="مثال: لا محدود" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>الصلاحية</Label>
              <Input value={form.validity} onChange={(e) => set("validity", e.target.value)} placeholder="مثال: 30 يوم" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>سعر البيع</Label>
            <Input type="number" value={form.sale_price} onChange={(e) => set("sale_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>السعر المرجعي</Label>
            <Input type="number" value={form.base_price} onChange={(e) => set("base_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الضريبة</Label>
            <Select value={form.tax_included} onValueChange={(v) => set("tax_included", v ?? "true")}>
              <SelectTrigger>
                <SelectValue>{form.tax_included === "true" ? "شامل الضريبة" : "غير شامل الضريبة"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">شامل الضريبة</SelectItem>
                <SelectItem value="false">غير شامل الضريبة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v ?? "active")}>
              <SelectTrigger>
                <SelectValue>{form.status === "active" ? "فعالة" : "غير فعالة"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">فعالة</SelectItem>
                <SelectItem value="inactive">غير فعالة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <div className="mb-4">
              <p className="text-sm font-semibold text-emerald-950">إعدادات العمولة</p>
              <p className="mt-1 text-xs text-emerald-700">
                عند بيع التاجر: المندوب يحصل على 5 ريال والتاجر يحصل على 10 ريال افتراضيا. عند تفعيل المندوب بنفسه يحصل على 15 ريال كاملة.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>إجمالي العمولة</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.total_commission_type} onChange={(value) => set("total_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.total_commission_value} onChange={(e) => set("total_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة المندوب عند بيع التاجر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.agent_chain_commission_type} onChange={(value) => set("agent_chain_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.agent_chain_commission_value} onChange={(e) => set("agent_chain_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة التاجر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.merchant_commission_type} onChange={(value) => set("merchant_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.merchant_commission_value} onChange={(e) => set("merchant_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة المندوب عند التفعيل المباشر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.direct_agent_commission_type} onChange={(value) => set("direct_agent_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.direct_agent_commission_value} onChange={(e) => set("direct_agent_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>العملة</Label>
                <Input value={form.commission_currency} onChange={(e) => set("commission_currency", e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>ملاحظات العمولة</Label>
                <textarea
                  value={form.commission_notes}
                  onChange={(e) => set("commission_notes", e.target.value)}
                  className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>
            {warning ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{warning}</p> : null}
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={submitting}>
            حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreatePackageDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    package_name: "",
    internet_allowance: "",
    minutes_allowance: "",
    validity: "",
    sale_price: "",
    base_price: "",
    commission_currency: "SAR",
    total_commission_type: "flat",
    total_commission_value: "15",
    agent_chain_commission_type: "flat",
    agent_chain_commission_value: "5",
    merchant_commission_type: "flat",
    merchant_commission_value: "10",
    direct_agent_commission_type: "flat",
    direct_agent_commission_value: "15",
    commission_notes: "",
  });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const warning = commissionSplitWarning(form);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!form.package_name.trim()) {
      setError("اسم الباقة مطلوب.");
      setSubmitting(false);
      return;
    }
    if (!form.commission_currency.trim()) {
      setError("العملة مطلوبة.");
      setSubmitting(false);
      return;
    }
    const numericKeys = [
      "sale_price",
      "base_price",
      "total_commission_value",
      "agent_chain_commission_value",
      "merchant_commission_value",
      "direct_agent_commission_value",
    ];
    if (numericKeys.some((key) => !Number.isFinite(Number(form[key as keyof typeof form] || 0)) || Number(form[key as keyof typeof form] || 0) < 0)) {
      setError("قيم الأسعار والعمولات يجب أن تكون أرقاما موجبة أو صفرا.");
      setSubmitting(false);
      return;
    }
    const result = await createSimPackage({
      provider: "virgin",
      package_name: form.package_name.trim(),
      internet_allowance: form.internet_allowance.trim() || null,
      minutes_allowance: form.minutes_allowance.trim() || null,
      validity: form.validity.trim() || null,
      sale_price: Number(form.sale_price || 0),
      base_price: Number(form.base_price || 0),
      tax_included: true,
      commission_currency: form.commission_currency.trim() || "SAR",
      total_commission_type: form.total_commission_type,
      total_commission_value: Number(form.total_commission_value || 0),
      agent_chain_commission_type: form.agent_chain_commission_type,
      agent_chain_commission_value: Number(form.agent_chain_commission_value || 0),
      agent_commission_type: form.agent_chain_commission_type,
      agent_commission_value: Number(form.agent_chain_commission_value || 0),
      merchant_commission_type: form.merchant_commission_type,
      merchant_commission_value: Number(form.merchant_commission_value || 0),
      direct_agent_commission_type: form.direct_agent_commission_type,
      direct_agent_commission_value: Number(form.direct_agent_commission_value || 0),
      commission_notes: form.commission_notes.trim() || null,
      status: "active",
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({
      package_name: "",
      internet_allowance: "",
      minutes_allowance: "",
      validity: "",
      sale_price: "",
      base_price: "",
      commission_currency: "SAR",
      total_commission_type: "flat",
      total_commission_value: "15",
      agent_chain_commission_type: "flat",
      agent_chain_commission_value: "5",
      merchant_commission_type: "flat",
      merchant_commission_value: "10",
      direct_agent_commission_type: "flat",
      direct_agent_commission_value: "15",
      commission_notes: "",
    });
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus className="ml-2 h-4 w-4" />
        باقة جديدة
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة باقة Virgin</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>اسم الباقة</Label>
            <Input value={form.package_name} onChange={(e) => set("package_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الإنترنت</Label>
            <Input value={form.internet_allowance} onChange={(e) => set("internet_allowance", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المكالمات</Label>
            <Input value={form.minutes_allowance} onChange={(e) => set("minutes_allowance", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>سعر البيع</Label>
            <Input type="number" value={form.sale_price} onChange={(e) => set("sale_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>السعر المرجعي</Label>
            <Input type="number" value={form.base_price} onChange={(e) => set("base_price", e.target.value)} />
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 sm:col-span-2">
            <div className="mb-4">
              <p className="text-sm font-semibold text-emerald-950">إعدادات العمولة</p>
              <p className="mt-1 text-xs text-emerald-700">
                عند بيع التاجر: المندوب يحصل على 5 ريال والتاجر يحصل على 10 ريال افتراضيا. عند تفعيل المندوب بنفسه يحصل على 15 ريال كاملة.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>إجمالي العمولة</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.total_commission_type} onChange={(value) => set("total_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.total_commission_value} onChange={(e) => set("total_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة المندوب عند بيع التاجر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.agent_chain_commission_type} onChange={(value) => set("agent_chain_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.agent_chain_commission_value} onChange={(e) => set("agent_chain_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة التاجر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.merchant_commission_type} onChange={(value) => set("merchant_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.merchant_commission_value} onChange={(e) => set("merchant_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>عمولة المندوب عند التفعيل المباشر</Label>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <CommissionTypeSelect value={form.direct_agent_commission_type} onChange={(value) => set("direct_agent_commission_type", value)} />
                  <Input type="number" min={0} step="0.01" value={form.direct_agent_commission_value} onChange={(e) => set("direct_agent_commission_value", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>العملة</Label>
                <Input value={form.commission_currency} onChange={(e) => set("commission_currency", e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>ملاحظات العمولة</Label>
                <textarea
                  value={form.commission_notes}
                  onChange={(e) => set("commission_notes", e.target.value)}
                  className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>
            {warning ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{warning}</p> : null}
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={submitting}>
            حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PackageManagementPanel({ packages, onDone }: { packages: SimPackage[]; onDone: () => void }) {
  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgePercent className="h-4 w-4" />
          الباقات والعمولات
        </CardTitle>
        <CreatePackageDialog onDone={onDone} />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {packages.length === 0 ? (
          <p className="text-sm text-slate-400 md:col-span-3">لا توجد باقات بعد.</p>
        ) : (
          packages.map((pkg) => (
            <div key={pkg.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-950">{pkg.package_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {pkg.internet_allowance || "-"} إنترنت · {pkg.minutes_allowance || "-"} مكالمات
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    الصلاحية: {pkg.validity || "-"}
                  </p>
                </div>
                {statusBadge(pkg.status, { active: "فعالة", inactive: "غير فعالة" })}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <span>السعر: {formatMoney(pkg.sale_price)}</span>
                <span>المرجعي: {formatMoney(pkg.base_price)}</span>
                <span>المزود: {pkg.provider}</span>
                <span>{pkg.tax_included ? "شامل الضريبة" : "غير شامل الضريبة"}</span>
                <span>الإجمالي: {pkg.total_commission_value}{pkg.total_commission_type === "percentage" ? "%" : ` ${pkg.commission_currency || "SAR"}`}</span>
                <span>مندوب/تاجر: {pkg.agent_chain_commission_value ?? pkg.agent_commission_value}{(pkg.agent_chain_commission_type || pkg.agent_commission_type) === "percentage" ? "%" : ` ${pkg.commission_currency || "SAR"}`}</span>
                <span>التاجر: {pkg.merchant_commission_value}{pkg.merchant_commission_type === "percentage" ? "%" : ` ${pkg.commission_currency || "SAR"}`}</span>
                <span>تفعيل مباشر: {pkg.direct_agent_commission_value}{pkg.direct_agent_commission_type === "percentage" ? "%" : ` ${pkg.commission_currency || "SAR"}`}</span>
              </div>
              <div className="mt-3">
                <PackageTermsDialog pkg={pkg} onDone={onDone} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assign SIMs dialog
// ---------------------------------------------------------------------------
function AssignSimsDialog({
  agents,
  stockSims,
  onDone,
}: {
  agents: FieldAgent[];
  stockSims: SimUnit[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [provider, setProvider] = useState("virgin");
  const [simType, setSimType] = useState("");

  const selectedAgentName = agents.find((agent) => agent.id === agentId)?.full_name || "";
  const requestedQuantity = Number(quantity || 0);
  const previewSims = useMemo(() => {
    if (!requestedQuantity || requestedQuantity <= 0) return [];
    return stockSims
      .filter((sim) => (sim.provider || "virgin") === provider)
      .filter((sim) => (simType.trim() ? sim.sim_type === simType.trim() : true))
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, requestedQuantity);
  }, [provider, requestedQuantity, simType, stockSims]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!agentId || requestedQuantity <= 0) {
      setError("اختر مندوبا واكتب عدد الشرائح.");
      setSubmitting(false);
      return;
    }
    if (previewSims.length < requestedQuantity) {
      setError("لا يوجد عدد كاف من الشرائح في المخزون بهذا الفلتر.");
      setSubmitting(false);
      return;
    }
    const result = await assignSims({
      agent_id: agentId,
      quantity: requestedQuantity,
      provider,
      sim_type: simType.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setAgentId("");
    setQuantity("");
    setProvider("virgin");
    setSimType("");
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Send className="ml-2 h-4 w-4" />
        تسليم للمندوب
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تسليم شرائح لمندوب</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>المندوب</Label>
            <Select value={agentId} onValueChange={(v) => setAgentId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المندوب">{selectedAgentName || undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents
                  .filter((a) => a.status === "active")
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>عدد الشرائح</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>المزود</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v ?? "virgin")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="virgin">Virgin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>النوع (اختياري)</Label>
              <Input value={simType} onChange={(e) => setSimType(e.target.value)} placeholder="prepaid" />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span>المتاح في المخزون: {stockSims.length} شريحة</span>
              <span className="inline-flex items-center gap-1 font-medium text-slate-900">
                <Eye className="h-4 w-4" />
                سيتم اختيار {previewSims.length} شريحة
              </span>
            </div>
          </div>
          {previewSims.length > 0 ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {previewSims.map((sim) => (
                <div key={sim.id} className="flex items-center justify-between rounded-md p-2 text-sm">
                  <span dir="ltr" className="font-medium">
                    {sim.iccid}
                  </span>
                  <span className="text-slate-400">
                    {sim.provider || "virgin"} · {sim.sim_type}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={submitting}>
              تسليم
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stock management
// ---------------------------------------------------------------------------
export function StockManagementScreen() {
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [agents, setAgents] = useState<FieldAgent[]>([]);
  const [requests, setRequests] = useState<AgentSimRequest[]>([]);
  const [transfers, setTransfers] = useState<SimTransfer[]>([]);
  const [packages, setPackages] = useState<SimPackage[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantCollections, setMerchantCollections] = useState<MerchantCashCollection[]>([]);
  const [ranking, setRanking] = useState<ResellerRanking[]>([]);
  const [importBatches, setImportBatches] = useState<SimImportBatch[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getStockOverview(),
      getSimUnits(),
      getFieldAgents(),
      getSimRequests({ status: "pending" }),
      getSimTransfers(),
      getSimPackages(),
      getMerchants(),
      getResellerRanking(),
      getSimImportBatches(),
    ]).then(async ([overviewResult, simResult, agentResult, requestResult, transferResult, packageResult, merchantResult, rankingResult, batchResult]) => {
      if (overviewResult.error) setMessage({ tone: "error", text: overviewResult.error.message });
      setOverview(overviewResult.data);
      setSims(rows(simResult.data));
      setAgents(rows(agentResult.data));
      setRequests(rows(requestResult.data));
      setTransfers(rows(transferResult.data).slice(0, 20));
      setPackages(rows(packageResult.data));
      setImportBatches(rows(batchResult.data).slice(0, 8));
      const merchantRows = rows(merchantResult.data);
      setMerchants(merchantRows);
      setRanking(rows(rankingResult.data));
      const collectionResults = await Promise.all(merchantRows.map((merchant) => getMerchantCollections(merchant.id)));
      setMerchantCollections(collectionResults.flatMap((result) => rows(result.data)));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stockSims = useMemo(() => sims.filter((s) => s.status === "in_stock"), [sims]);
  const filteredSims = useMemo(
    () => (statusFilter === "all" ? sims : sims.filter((s) => s.status === statusFilter)),
    [sims, statusFilter]
  );

  const review = async (id: string, status: "approved" | "rejected") => {
    const result = await reviewSimRequest(id, { status });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else load();
  };

  const updateMerchantPayment = async (id: string, status: "confirmed" | "rejected") => {
    const result = await confirmMerchantPayment(id, {
      status,
      rejection_reason: status === "rejected" ? "رفض من مدير المناديب" : undefined,
    });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else load();
  };

  const agentName = (id: string | null) =>
    id ? agents.find((agent) => agent.id === id)?.full_name || "مندوب" : "المخزون";
  const merchantName = (id: string) => merchants.find((merchant) => merchant.id === id)?.business_name || "تاجر";
  const pendingMerchantCollections = useMemo(
    () => merchantCollections.filter((collection) => collection.status === "pending"),
    [merchantCollections]
  );

  return (
    <div className="space-y-6" dir="rtl">
      <PageTitle
        title="إدارة المخزون"
        subtitle="مخزون الشرائح والتسليم للمندوبين ومتابعة الطلبات."
        actions={
          <>
            <SimBoxImportDialog agents={agents} onDone={load} />
            <ImportSimsDialog onDone={load} />
            <AssignSimsDialog agents={agents} stockSims={stockSims} onDone={load} />
          </>
        }
      />
      <MessageBanner message={message} />
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="في المخزون" value={String(overview?.in_stock ?? 0)} hint={formatMoney(overview?.total_value_in_stock)} />
        <StatCard label="مع المندوبين" value={String(overview?.with_agents ?? 0)} />
        <StatCard label="مع التجار" value={String(overview?.with_merchants ?? 0)} />
        <StatCard label="مباعة" value={String(overview?.sold ?? 0)} />
        <StatCard label="مرتجعة" value={String(overview?.returned ?? 0)} />
      </div>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            دفعات استيراد العلب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {importBatches.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد دفعات OCR محفوظة بعد.</p>
          ) : (
            importBatches.map((batch) => (
              <div key={batch.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 text-sm lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <p className="font-medium text-slate-950">
                    {batch.provider} · {batch.batch_number || batch.order_number || batch.id.slice(0, 8)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" dir="ltr">
                    {batch.first_kitcode} → {batch.last_kitcode}
                  </p>
                </div>
                <div className="text-slate-600">
                  {batch.imported_count} شريحة · {batch.duplicate_count} متكرر
                </div>
                <div className="text-slate-500">
                  {agentName(batch.assigned_agent_id)} · {new Date(batch.created_at).toLocaleDateString("ar-SA")}
                </div>
                {statusBadge(batch.status, { confirmed: "مؤكدة", draft: "مسودة", cancelled: "ملغاة", failed: "فشلت" })}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <PackageManagementPanel packages={packages} onDone={load} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border border-blue-200 bg-blue-50/40 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              مدفوعات التجار قيد التأكيد
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingMerchantCollections.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد مدفوعات معلقة.</p>
            ) : (
              pendingMerchantCollections.map((collection) => (
                <div key={collection.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {merchantName(collection.merchant_id)} · {formatMoney(collection.amount)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {paymentMethodLabels[collection.payment_method] || collection.payment_method} · {new Date(collection.collection_date).toLocaleDateString("ar-SA")}
                    </p>
                    {collection.payment_proof_url ? (
                      <a href={collection.payment_proof_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand">
                        عرض إثبات الدفع
                      </a>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMerchantPayment(collection.id, "confirmed")}>
                      <Check className="ml-1 h-4 w-4" />
                      تأكيد
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateMerchantPayment(collection.id, "rejected")}>
                      <X className="ml-1 h-4 w-4" />
                      رفض
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">أفضل التجار مبيعا</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ranking.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد مبيعات تجار بعد.</p>
            ) : (
              ranking.slice(0, 10).map((row, index) => (
                <div key={row.merchant_id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                  <span className="font-medium">
                    {index + 1}. {row.business_name}
                  </span>
                  <span className="text-slate-500">
                    {row.sold_total} مبيعة · {formatMoney(row.sold_value)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {requests.length > 0 ? (
        <Card className="border border-amber-200 bg-amber-50/40 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">طلبات شرائح قيد المراجعة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {requests.map((req) => {
              const agent = agents.find((a) => a.id === req.agent_id);
              return (
                <div key={req.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div>
                    <span className="font-medium">{agent?.full_name || "مندوب"}</span>
                    <span className="mr-2 text-slate-500">
                      {req.quantity} شريحة {req.sim_type ? `· ${req.sim_type}` : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => review(req.id, "approved")}>
                      <Check className="ml-1 h-4 w-4" />
                      اعتماد
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => review(req.id, "rejected")}>
                      <X className="ml-1 h-4 w-4" />
                      رفض
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">الشرائح</CardTitle>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="in_stock">في المخزون</SelectItem>
              <SelectItem value="with_agent">مع المندوب</SelectItem>
              <SelectItem value="with_merchant">مع التاجر</SelectItem>
              <SelectItem value="sold">مباعة</SelectItem>
              <SelectItem value="returned">مرتجعة</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kit Code / ICCID</TableHead>
                <TableHead>المزود</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الباقة المباعة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-400">
                    لا توجد شرائح.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSims.slice(0, 100).map((sim) => (
                  <TableRow key={sim.id}>
                    <TableCell dir="ltr">
                      <div className="font-medium">{sim.kit_code || sim.iccid}</div>
                      {sim.kit_code && sim.kit_code !== sim.iccid ? (
                        <div className="text-xs text-slate-400">{sim.iccid}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{sim.provider || "virgin"}</TableCell>
                    <TableCell>{sim.sim_type}</TableCell>
                    <TableCell>{sim.sold_package_name || "—"}</TableCell>
                    <TableCell>{statusBadge(sim.status, simStatusLabels)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">آخر الحركات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {transfers.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد حركات.</p>
          ) : (
            transfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span>{transferTypeLabel(t.transfer_type)}</span>
                <span className="text-slate-400">{new Date(t.transfer_date).toLocaleDateString("ar-SA")}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function transferTypeLabel(type: string) {
  const labels: Record<string, string> = {
    assign_to_agent: "تسليم لمندوب",
    return_to_stock: "إرجاع للمخزون",
    sold: "بيع",
    initial_import: "استيراد",
  };
  return labels[type] || type;
}
