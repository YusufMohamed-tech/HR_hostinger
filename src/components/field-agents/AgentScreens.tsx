"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  Check,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  RefreshCcw,
  Send,
  ShoppingCart,
  Smartphone,
  Store,
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
import { cn } from "@/lib/utils";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  createSimRequest,
  getAgentDashboard,
  getCommissions,
  getSimRequests,
  getSimUnits,
  recordSale,
} from "@/lib/services/field-agents";
import {
  assignSimsToMerchant,
  collectMerchantCash,
  createMerchant,
  getMerchantRequests,
  getMerchants,
  getResellerRanking,
  reviewMerchantRequest,
} from "@/lib/services/merchants";
import type {
  AgentCommission,
  AgentDashboardData,
  AgentSimRequest,
  SimUnit,
} from "@/types/field-agents";
import type { Merchant, MerchantSimRequest, ResellerRanking } from "@/types/merchants";

type Message = { tone: "success" | "error"; text: string } | null;

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? Math.round(number).toLocaleString("ar-SA") : "0"} ر.س`;
}

const requestStatusLabels: Record<string, string> = {
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  delivered: "تم التسليم",
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

import {
  assignSimsToMerchant,
  collectMerchantCash,
  createMerchant,
  getMerchantRequests,
  getMerchants,
  getResellerRanking,
  reviewMerchantRequest,
} from "@/lib/services/merchants";
import type {
  AgentCommission,
  AgentDashboardData,
  AgentSimRequest,
  SimUnit,
} from "@/types/field-agents";
import type { Merchant, MerchantSimRequest, ResellerRanking } from "@/types/merchants";

const navItems = [
  { name: "الرئيسية", href: "/agent", icon: LayoutDashboard },
  { name: "شرائحي", href: "/agent/sims", icon: Smartphone },
  { name: "تسجيل مبيعة", href: "/agent/sell", icon: ShoppingCart },
  { name: "التجار", href: "/agent/merchants", icon: Store },
  { name: "طلب شرائح", href: "/agent/requests", icon: Package },
  { name: "رصيدي", href: "/agent/balance", icon: Wallet },
  { name: "عمولاتي", href: "/agent/commissions", icon: BadgePercent },
];

function AgentShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useRoleContext();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand">كشك المندوب</p>
            <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="ml-2 h-4 w-4" />
            تسجيل الخروج
          </Button>
        </div>
        <nav className="flex flex-wrap gap-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand/40"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export function AgentKioskScreen() {
  const [data, setData] = useState<AgentDashboardData | null>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getAgentDashboard().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setData(result.data);
    });
  }, []);

  return (
    <AgentShell title={data ? `مرحبًا ${data.agent.full_name}` : "الرئيسية"} subtitle="ملخص نشاطك اليومي.">
      <MessageBanner message={message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">شرائح في اليد</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{data?.stock.in_hand ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">قيمة {formatMoney(data?.stock.in_hand_value)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">إجمالي المبيعات</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{data?.stock.sold_total ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">المبلغ المتبقي عليك</p>
            <p className="mt-1 text-3xl font-bold text-amber-600">{formatMoney(data?.balance.outstanding)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">عمولات غير مدفوعة</p>
            <p className="mt-1 text-3xl font-bold text-emerald-600">{formatMoney(data?.unpaid_commission)}</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/agent/sell">
            <ShoppingCart className="ml-2 h-4 w-4" />
            تسجيل مبيعة
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/agent/requests">
            <Package className="ml-2 h-4 w-4" />
            طلب شرائح
          </Link>
        </Button>
      </div>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// My SIMs
// ---------------------------------------------------------------------------
export function AgentSimListScreen() {
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getSimUnits({ status: "with_agent" }).then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setSims(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AgentShell title="شرائحي" subtitle="الشرائح المتوفرة معك حاليًا.">
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{sims.length} شريحة</CardTitle>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCcw className="ml-2 h-4 w-4" />
            تحديث
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {sims.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد شرائح معك.</p>
          ) : (
            sims.map((sim) => (
              <div key={sim.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span dir="ltr" className="font-medium">
                  {sim.iccid}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">{sim.sim_type}</span>
                  <span className="font-semibold">{formatMoney(sim.price)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// Sell
// ---------------------------------------------------------------------------
export function AgentSellScreen() {
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [simId, setSimId] = useState("");
  const [price, setPrice] = useState("");
  const [customer, setCustomer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getSimUnits({ status: "with_agent" }).then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setSims(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedSim = useMemo(() => sims.find((s) => s.id === simId) || null, [sims, simId]);

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    if (!simId) {
      setMessage({ tone: "error", text: "اختر شريحة." });
      setSubmitting(false);
      return;
    }
    const result = await recordSale({
      sim_unit_id: simId,
      sold_price: Number(price || 0),
      customer_name: customer.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم تسجيل المبيعة بنجاح." });
    setSimId("");
    setPrice("");
    setCustomer("");
    load();
  };

  return (
    <AgentShell title="تسجيل مبيعة" subtitle="اختر الشريحة وأدخل بيانات البيع.">
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">بيانات المبيعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>الشريحة</Label>
            <Select value={simId} onValueChange={(v) => setSimId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر شريحة" />
              </SelectTrigger>
              <SelectContent>
                {sims.map((sim) => (
                  <SelectItem key={sim.id} value={sim.id}>
                    {sim.iccid} · {sim.sim_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>سعر البيع {selectedSim ? `(السعر المرجعي ${formatMoney(selectedSim.price)})` : ""}</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>اسم العميل (اختياري)</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          <Button onClick={submit} disabled={submitting} className="w-full">
            تأكيد البيع
          </Button>
        </CardContent>
      </Card>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
export function AgentRequestScreen() {
  const [requests, setRequests] = useState<AgentSimRequest[]>([]);
  const [quantity, setQuantity] = useState("");
  const [simType, setSimType] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getSimRequests().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setRequests(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    const result = await createSimRequest({
      quantity: Number(quantity || 0),
      sim_type: simType.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم إرسال الطلب." });
    setQuantity("");
    setSimType("");
    setNotes("");
    load();
  };

  return (
    <AgentShell title="طلب شرائح" subtitle="اطلب مخزونًا جديدًا وتابع حالة طلباتك.">
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">طلب جديد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>الكمية</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>النوع (اختياري)</Label>
              <Input value={simType} onChange={(e) => setSimType(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button onClick={submit} disabled={submitting} className="w-full">
            إرسال الطلب
          </Button>
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">طلباتي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد طلبات.</p>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span>
                  {req.quantity} شريحة {req.sim_type ? `· ${req.sim_type}` : ""}
                </span>
                <Badge
                  className={cn(
                    "border-0",
                    req.status === "approved" || req.status === "delivered"
                      ? "bg-emerald-100 text-emerald-700"
                      : req.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  )}
                >
                  {requestStatusLabels[req.status] || req.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------
export function AgentBalanceScreen() {
  const [data, setData] = useState<AgentDashboardData | null>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getAgentDashboard().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setData(result.data);
    });
  }, []);

  return (
    <AgentShell title="رصيدي" subtitle="ملخص المبالغ المستحقة والمحصّلة.">
      <MessageBanner message={message} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">قيمة المبيعات</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{formatMoney(data?.balance.total_sold_value)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">المحصّل</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{formatMoney(data?.balance.total_collected)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">المتبقي عليك</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{formatMoney(data?.balance.outstanding)}</p>
          </CardContent>
        </Card>
      </div>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------
export function AgentCommissionsScreen() {
  const [commissions, setCommissions] = useState<AgentCommission[]>([]);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getCommissions().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setCommissions(rows(result.data));
    });
  }, []);

  const total = useMemo(() => commissions.reduce((sum, c) => sum + Number(c.commission_amount || 0), 0), [commissions]);
  const unpaid = useMemo(
    () => commissions.filter((c) => !c.is_paid).reduce((sum, c) => sum + Number(c.commission_amount || 0), 0),
    [commissions]
  );

  return (
    <AgentShell title="عمولاتي" subtitle="تفاصيل العمولات لكل عملية بيع.">
      <MessageBanner message={message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">إجمالي العمولات</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{formatMoney(total)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">غير مدفوعة</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{formatMoney(unpaid)}</p>
          </CardContent>
        </Card>
      </div>
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">السجل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {commissions.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد عمولات.</p>
          ) : (
            commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <span className="font-semibold">{formatMoney(c.commission_amount)}</span>
                  <span className="mr-2 text-slate-400">من {formatMoney(c.sale_price)} ({c.commission_rate}%)</span>
                </div>
                {c.is_paid ? (
                  <Badge className="border-0 bg-emerald-100 text-emerald-700">مدفوعة</Badge>
                ) : (
                  <Badge className="border-0 bg-amber-100 text-amber-700">معلقة</Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AgentShell>
  );
}

// ---------------------------------------------------------------------------
// Merchants management (agent side)
// ---------------------------------------------------------------------------
function CreateMerchantDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    business_name: "",
    owner_name: "",
    phone: "",
    location: "",
    sim_price: "0",
    commission_rate: "0",
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
      business_name: form.business_name.trim(),
      sim_price: Number(form.sim_price || 0),
      commission_rate: Number(form.commission_rate || 0),
    };
    if (form.owner_name.trim()) payload.owner_name = form.owner_name.trim();
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (form.location.trim()) payload.location = form.location.trim();
    const result = await createMerchant(payload);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ email: "", password: "", business_name: "", owner_name: "", phone: "", location: "", sim_price: "0", commission_rate: "0" });
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="ml-2 h-4 w-4" />
        تاجر جديد
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة تاجر (محل صغير)</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>البريد الإلكتروني (دخول)</Label>
            <Input dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input dir="ltr" type="text" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="8 أحرف على الأقل" />
          </div>
          <div className="space-y-2">
            <Label>اسم المحل</Label>
            <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>اسم المالك</Label>
            <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الجوال</Label>
            <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الموقع</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>سعر الشريحة (يدفعه لك)</Label>
            <Input type="number" value={form.sim_price} onChange={(e) => set("sim_price", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>نسبة عمولته %</Label>
            <Input type="number" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-400">سيُنشأ حساب دخول للتاجر بدور merchant تلقائيًا.</p>
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

function AssignToMerchantDialog({
  merchants,
  stockSims,
  onDone,
}: {
  merchants: Merchant[];
  stockSims: SimUnit[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!merchantId || selectedIds.length === 0) {
      setError("اختر تاجرًا وشريحة واحدة على الأقل.");
      setSubmitting(false);
      return;
    }
    const result = await assignSimsToMerchant({ merchant_id: merchantId, sim_ids: selectedIds });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setSelected({});
    setMerchantId("");
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Send className="ml-2 h-4 w-4" />
        تسليم شرائح لتاجر
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تسليم شرائح لتاجر</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>التاجر</Label>
            <Select value={merchantId} onValueChange={(v) => setMerchantId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر التاجر" />
              </SelectTrigger>
              <SelectContent>
                {merchants
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.business_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {stockSims.length === 0 ? (
              <p className="p-2 text-sm text-slate-400">لا توجد شرائح في يدك.</p>
            ) : (
              stockSims.map((sim) => (
                <label key={sim.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={!!selected[sim.id]} onChange={() => toggle(sim.id)} />
                  <span dir="ltr" className="flex-1">
                    {sim.iccid}
                  </span>
                  <span className="text-slate-400">{sim.sim_type}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-sm text-slate-500">تم اختيار {selectedIds.length} شريحة.</p>
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

function CollectFromMerchantDialog({ merchantId, onDone }: { merchantId: string; onDone: () => void }) {
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
    const result = await collectMerchantCash({
      merchant_id: merchantId,
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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Wallet className="ml-2 h-4 w-4" />
        تحصيل
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تحصيل نقدية من التاجر</DialogTitle>
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

export function AgentMerchantsScreen() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [stockSims, setStockSims] = useState<SimUnit[]>([]);
  const [requests, setRequests] = useState<MerchantSimRequest[]>([]);
  const [ranking, setRanking] = useState<ResellerRanking[]>([]);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getMerchants(),
      getSimUnits({ status: "with_agent" }),
      getMerchantRequests({ status: "pending" }),
      getResellerRanking(),
    ]).then(([merchantResult, simResult, requestResult, rankingResult]) => {
      if (merchantResult.error) setMessage({ tone: "error", text: merchantResult.error.message });
      setMerchants(rows(merchantResult.data));
      setStockSims(rows(simResult.data));
      setRequests(rows(requestResult.data));
      setRanking(rows(rankingResult.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (id: string, status: "approved" | "rejected") => {
    const result = await reviewMerchantRequest(id, { status });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else load();
  };

  const merchantName = (id: string) => merchants.find((m) => m.id === id)?.business_name || "تاجر";

  return (
    <AgentShell title="التجار" subtitle="محلاتك الصغيرة: إنشاء، تسليم شرائح، وتحصيل.">
      <MessageBanner message={message} />
      <div className="flex flex-wrap gap-2">
        <CreateMerchantDialog onCreated={load} />
        <AssignToMerchantDialog merchants={merchants} stockSims={stockSims} onDone={load} />
        <Button variant="outline" onClick={load}>
          <RefreshCcw className="ml-2 h-4 w-4" />
          تحديث
        </Button>
      </div>

      {requests.length > 0 ? (
        <Card className="border border-amber-200 bg-amber-50/40 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">طلبات شرائح من التجار</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div>
                  <span className="font-medium">{merchantName(req.merchant_id)}</span>
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
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">التجار ({merchants.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {merchants.length === 0 ? (
            <p className="text-sm text-slate-400">لا يوجد تجار بعد.</p>
          ) : (
            merchants.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <span className="font-medium">{m.business_name}</span>
                  <span className="mr-2 text-slate-400">
                    سعر {formatMoney(m.sim_price)} · عمولة {m.commission_rate}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "active" ? (
                    <Badge className="border-0 bg-emerald-100 text-emerald-700">نشط</Badge>
                  ) : (
                    <Badge className="border-0 bg-red-100 text-red-700">موقوف</Badge>
                  )}
                  <CollectFromMerchantDialog merchantId={m.id} onDone={load} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">أفضل التجار مبيعًا</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ranking.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد بيانات بعد.</p>
          ) : (
            ranking.slice(0, 10).map((r, i) => (
              <div key={r.merchant_id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span className="font-medium">
                  {i + 1}. {r.business_name}
                </span>
                <span className="text-slate-500">
                  {r.sold_total} مبيعة · {formatMoney(r.sold_value)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AgentShell>
  );
}
