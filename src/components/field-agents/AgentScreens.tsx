"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  Check,
  CreditCard,
  Eye,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Plus,
  RefreshCcw,
  ReceiptText,
  Send,
  ShoppingCart,
  Smartphone,
  Store,
  Upload,
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
import { LocationMapPicker } from "@/components/locations/LocationMapPicker";
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
  confirmMerchantPayment,
  createMerchant,
  getMerchantCollections,
  getMerchantCommissions,
  getMerchantRequests,
  getMerchantSims,
  getMerchants,
  getResellerRanking,
  getSimPackages,
  previewSimsForMerchant,
  reviewMerchantRequest,
} from "@/lib/services/merchants";
import type {
  AgentCommission,
  AgentDashboardData,
  AgentSimRequest,
  SimPackage,
  SimUnit,
} from "@/types/field-agents";
import type { Merchant, MerchantCashCollection, MerchantCommission, MerchantSimRequest, ResellerRanking } from "@/types/merchants";

type Message = { tone: "success" | "error"; text: string } | null;

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

function formatSimLabel(sim: SimUnit | null | undefined) {
  if (!sim) return "";
  return [sim.iccid || "شريحة بدون رقم", sim.provider || "virgin", sim.sim_type].filter(Boolean).join(" · ");
}

function commissionPreview(pkg: SimPackage | null, tier: "agent" | "merchant") {
  if (!pkg) return "";
  const type = tier === "agent"
    ? pkg.direct_agent_commission_type || pkg.agent_commission_type
    : pkg.merchant_commission_type;
  const value = tier === "agent"
    ? pkg.direct_agent_commission_value ?? pkg.agent_commission_value
    : pkg.merchant_commission_value;
  const amount = type === "flat" ? value : (Number(pkg.sale_price || 0) * value) / 100;
  return formatMoney(amount);
}

const paymentMethodLabels: Record<string, string> = {
  cash: "نقدي",
  bank_transfer: "تحويل بنكي",
  visa: "فيزا",
  electronic: "دفع إلكتروني",
};

const paymentStatusLabels: Record<string, string> = {
  pending: "قيد التأكيد",
  confirmed: "مؤكد",
  rejected: "مرفوض",
};

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

const navItems = [
  { name: "الرئيسية", href: "/agent", icon: LayoutDashboard },
  { name: "شرائحي", href: "/agent/sims", icon: Smartphone },
  { name: "المنتجات", href: "/agent/products", icon: Package },
  { name: "تسجيل مبيعة", href: "/agent/sell", icon: ShoppingCart },
  { name: "التجار", href: "/agent/merchants", icon: Store },
  { name: "طلب شرائح", href: "/agent/requests", icon: Package },
  { name: "رصيدي", href: "/agent/balance", icon: Wallet },
  { name: "عمولاتي", href: "/agent/commissions", icon: BadgePercent },
];

export function AgentShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
            <p className="text-sm text-slate-500">إجمالي الشرائح المباعة</p>
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
                  <span className="text-slate-500">{sim.provider || "virgin"}</span>
                  <span className="text-slate-500">{sim.sim_type}</span>
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
  const [packages, setPackages] = useState<SimPackage[]>([]);
  const [simId, setSimId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [customer, setCustomer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getSimUnits({ status: "with_agent" }),
      getSimPackages({ status: "active" }),
    ]).then(([simResult, packageResult]) => {
      if (simResult.error) setMessage({ tone: "error", text: simResult.error.message });
      else setSims(rows(simResult.data));
      if (packageResult.error) setMessage({ tone: "error", text: packageResult.error.message });
      else setPackages(rows(packageResult.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedSim = useMemo(() => sims.find((s) => s.id === simId) || null, [sims, simId]);
  const availablePackages = useMemo(() => {
    const provider = selectedSim?.provider || "virgin";
    return packages.filter((pkg) => pkg.provider === provider && pkg.status === "active");
  }, [packages, selectedSim]);
  const selectedPackage = useMemo(
    () => availablePackages.find((pkg) => pkg.id === packageId) || null,
    [availablePackages, packageId]
  );

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    if (!simId) {
      setMessage({ tone: "error", text: "اختر شريحة." });
      setSubmitting(false);
      return;
    }
    if (!packageId) {
      setMessage({ tone: "error", text: "اختر الباقة." });
      setSubmitting(false);
      return;
    }
    const result = await recordSale({
      sim_unit_id: simId,
      package_id: packageId,
      customer_name: customer.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم تسجيل المبيعة بنجاح." });
    setSimId("");
    setPackageId("");
    setCustomer("");
    load();
  };

  return (
    <AgentShell title="تسجيل مبيعة" subtitle="اختر الشريحة والباقة، والسعر والعمولة يحسبان من النظام.">
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">بيانات المبيعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>الشريحة</Label>
            <Select
              value={simId}
              onValueChange={(v) => {
                setSimId(v ?? "");
                setPackageId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر شريحة">{formatSimLabel(selectedSim) || undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sims.map((sim) => (
                  <SelectItem key={sim.id} value={sim.id}>
                    {formatSimLabel(sim)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الباقة</Label>
            {!selectedSim ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                اختر الشريحة أولا حتى تظهر الباقات المتاحة.
              </p>
            ) : availablePackages.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                لا توجد باقات فعالة لهذا المزود.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {availablePackages.map((pkg) => {
                  const active = packageId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setPackageId(pkg.id)}
                      className={cn(
                        "rounded-lg border p-3 text-right transition",
                        active ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-slate-200 bg-white hover:border-brand/40"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{pkg.package_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {pkg.internet_allowance || "-"} إنترنت · {pkg.minutes_allowance || "-"} مكالمات
                          </p>
                        </div>
                        <Badge className="border-0 bg-red-100 text-red-700">{pkg.provider}</Badge>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <span className="text-xl font-bold text-brand">{formatMoney(pkg.sale_price)}</span>
                        <span className="text-xs text-slate-500">عمولتك {commissionPreview(pkg, "agent")}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>اسم العميل (اختياري)</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          {selectedPackage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              سيتم تسجيل البيع بسعر {formatMoney(selectedPackage.sale_price)} واحتساب عمولتك {commissionPreview(selectedPackage, "agent")}.
            </div>
          ) : null}
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
            <p className="text-sm text-slate-500">المستحق للشركة</p>
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
                  <span className="mr-2 text-slate-400">
                    من {formatMoney(c.sale_price)} ({c.commission_type === "flat" ? formatMoney(c.commission_rate) : `${c.commission_rate}%`})
                  </span>
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
  const [radiusMeters, setRadiusMeters] = useState("100");
  const [form, setForm] = useState({
    email: "",
    password: "",
    business_name: "",
    owner_name: "",
    city: "",
    region: "",
    phone: "",
    location: "",
    latitude: "",
    longitude: "",
  });
  const [placePhoto, setPlacePhoto] = useState<File | null>(null);
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const setMapCoordinates = useCallback((latitude: string, longitude: string) => {
    setForm((prev) => ({ ...prev, latitude, longitude }));
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (form.password.length < 12 || !/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) {
      setError("كلمة المرور يجب أن تكون 12 حرفًا وتحتوي على حرف كبير وصغير ورقم.");
      setSubmitting(false);
      return;
    }
    const payload = new FormData();
    payload.set("email", form.email.trim());
    payload.set("password", form.password);
    payload.set("business_name", form.business_name.trim());
    payload.set("sim_price", "0");
    payload.set("commission_rate", "0");
    if (form.owner_name.trim()) payload.set("owner_name", form.owner_name.trim());
    if (form.city.trim()) payload.set("city", form.city.trim());
    if (form.region.trim()) payload.set("region", form.region.trim());
    if (form.phone.trim()) payload.set("phone", form.phone.trim());
    if (form.location.trim()) payload.set("location", form.location.trim());
    if (form.latitude.trim()) payload.set("latitude", form.latitude.trim());
    if (form.longitude.trim()) payload.set("longitude", form.longitude.trim());
    if (placePhoto) payload.set("place_photo", placePhoto);
    const result = await createMerchant(payload);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ email: "", password: "", business_name: "", owner_name: "", city: "", region: "", phone: "", location: "", latitude: "", longitude: "" });
    setRadiusMeters("100");
    setPlacePhoto(null);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="ml-2 h-4 w-4" />
        تاجر جديد
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto">
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
            <Input dir="ltr" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="12 حرفًا + كبير وصغير ورقم" />
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
            <Label>المدينة</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المنطقة</Label>
            <Input value={form.region} onChange={(e) => set("region", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الجوال</Label>
            <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>العنوان / وصف الموقع</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>النطاق (متر)</Label>
            <Input dir="ltr" type="number" min="10" value={radiusMeters} onChange={(e) => setRadiusMeters(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>خط العرض</Label>
            <Input dir="ltr" type="number" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>خط الطول</Label>
            <Input dir="ltr" type="number" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
          </div>
          <div className="space-y-3 md:col-span-2">
            <Label className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              حدد موقع التاجر على الخريطة
            </Label>
            <LocationMapPicker
              latitude={form.latitude}
              longitude={form.longitude}
              radiusMeters={radiusMeters}
              onChange={setMapCoordinates}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>صورة المكان</Label>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
              <span>{placePhoto ? placePhoto.name : "ارفع صورة واجهة المحل أو المكان"}</span>
              <Upload className="h-4 w-4" />
              <Input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setPlacePhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          سيُنشأ حساب دخول للتاجر بدور merchant تلقائيًا. أسعار الباقات وعمولات التاجر تدار من حساب مدير المناديب.
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
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [provider, setProvider] = useState("virgin");
  const [simType, setSimType] = useState("");
  const [preview, setPreview] = useState<SimUnit[]>([]);

  const selectedMerchantName = merchants.find((merchant) => merchant.id === merchantId)?.business_name || "";

  const loadPreview = async () => {
    setPreviewing(true);
    setError(null);
    setPreview([]);
    if (!merchantId || Number(quantity || 0) <= 0) {
      setError("اختر تاجرا وأدخل الكمية.");
      setPreviewing(false);
      return;
    }
    const result = await previewSimsForMerchant({
      merchant_id: merchantId,
      quantity: Number(quantity || 0),
      provider,
      sim_type: simType.trim() || undefined,
    });
    setPreviewing(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setPreview(rows(result.data?.sims));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!merchantId || Number(quantity || 0) <= 0) {
      setError("اختر تاجرا وأدخل الكمية.");
      setSubmitting(false);
      return;
    }
    const result = await assignSimsToMerchant({
      merchant_id: merchantId,
      quantity: Number(quantity || 0),
      provider,
      sim_type: simType.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setMerchantId("");
    setQuantity("");
    setProvider("virgin");
    setSimType("");
    setPreview([]);
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
            <Select
              value={merchantId}
              onValueChange={(v) => {
                setMerchantId(v ?? "");
                setPreview([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر التاجر">{selectedMerchantName || undefined}</SelectValue>
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
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>الكمية</Label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setPreview([]);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>المزود</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v ?? "virgin");
                  setPreview([]);
                }}
              >
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
              <Input
                value={simType}
                onChange={(e) => {
                  setSimType(e.target.value);
                  setPreview([]);
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="text-slate-500">المتاح في يدك حاليا: {stockSims.length} شريحة</span>
            <Button variant="outline" size="sm" onClick={loadPreview} disabled={previewing}>
              <Eye className="ml-2 h-4 w-4" />
              معاينة
            </Button>
          </div>
          {preview.length > 0 ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {preview.map((sim) => (
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
  const [merchantSims, setMerchantSims] = useState<SimUnit[]>([]);
  const [requests, setRequests] = useState<MerchantSimRequest[]>([]);
  const [collections, setCollections] = useState<MerchantCashCollection[]>([]);
  const [merchantCommissions, setMerchantCommissions] = useState<MerchantCommission[]>([]);
  const [ranking, setRanking] = useState<ResellerRanking[]>([]);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getMerchants(),
      getSimUnits({ status: "with_agent" }),
      getMerchantRequests({ status: "pending" }),
      getResellerRanking(),
    ]).then(async ([merchantResult, simResult, requestResult, rankingResult]) => {
      if (merchantResult.error) setMessage({ tone: "error", text: merchantResult.error.message });
      const merchantRows = rows(merchantResult.data);
      setMerchants(merchantRows);
      setStockSims(rows(simResult.data));
      setRequests(rows(requestResult.data));
      setRanking(rows(rankingResult.data));
      const [simResults, collectionResults, commissionResults] = await Promise.all([
        Promise.all(merchantRows.map((merchant) => getMerchantSims({ merchant_id: merchant.id }))),
        Promise.all(merchantRows.map((merchant) => getMerchantCollections(merchant.id))),
        Promise.all(merchantRows.map((merchant) => getMerchantCommissions({ merchant_id: merchant.id }))),
      ]);
      setMerchantSims(simResults.flatMap((result) => rows(result.data)));
      setCollections(collectionResults.flatMap((result) => rows(result.data)));
      setMerchantCommissions(commissionResults.flatMap((result) => rows(result.data)));
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

  const updatePayment = async (id: string, status: "confirmed" | "rejected") => {
    const collection = collections.find((item) => item.id === id);
    const result = await confirmMerchantPayment(id, {
      status,
      expected_version: collection?.version || 1,
      rejection_reason: status === "rejected" ? "رفض من المندوب" : undefined,
    });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else load();
  };

  const merchantName = (id: string) => merchants.find((m) => m.id === id)?.business_name || "تاجر";
  const pendingCollections = useMemo(
    () => collections.filter((collection) => collection.status === "pending"),
    [collections]
  );
  const merchantRows = useMemo(() => {
    return merchants.map((merchant) => {
      const simsForMerchant = merchantSims.filter(
        (sim) => sim.current_merchant_id === merchant.id || sim.sold_by_merchant_id === merchant.id
      );
      const merchantCollections = collections.filter((collection) => collection.merchant_id === merchant.id);
      const commissionsForMerchant = merchantCommissions.filter((commission) => commission.merchant_id === merchant.id);
      const rank = ranking.find((item) => item.merchant_id === merchant.id);
      const inHand = simsForMerchant.filter((sim) => sim.status === "with_merchant").length;
      const soldSims = simsForMerchant.filter((sim) => sim.status === "sold" || sim.sold_by_merchant_id === merchant.id);
      const soldTotal = rank?.sold_total ?? soldSims.length;
      const soldValue = rank?.sold_value ?? soldSims.reduce((sum, sim) => sum + Number(sim.sold_price || 0), 0);
      const confirmedPayments = merchantCollections
        .filter((collection) => collection.status === "confirmed")
        .reduce((sum, collection) => sum + Number(collection.amount || 0), 0);
      const pendingPayments = merchantCollections
        .filter((collection) => collection.status === "pending")
        .reduce((sum, collection) => sum + Number(collection.amount || 0), 0);
      const unpaidCommission = commissionsForMerchant
        .filter((commission) => !commission.is_paid)
        .reduce((sum, commission) => sum + Number(commission.commission_amount || 0), 0);

      return {
        merchant,
        deliveredTotal: simsForMerchant.length,
        inHand,
        soldTotal,
        soldValue,
        confirmedPayments,
        pendingPayments,
        outstanding: soldValue - confirmedPayments,
        unpaidCommission,
      };
    });
  }, [collections, merchantCommissions, merchantSims, merchants, ranking]);

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

      {pendingCollections.length > 0 ? (
        <Card className="border border-blue-200 bg-blue-50/40 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              مدفوعات التجار قيد التأكيد
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingCollections.map((collection) => {
              const canConfirmHere = collection.payment_method === "cash";
              return (
                <div key={collection.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {merchantName(collection.merchant_id)} · {formatMoney(collection.amount)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {paymentMethodLabels[collection.payment_method] || collection.payment_method} · {paymentStatusLabels[collection.status]}
                    </p>
                    {collection.payment_proof_url ? (
                      <a href={collection.payment_proof_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand">
                        <ReceiptText className="h-3 w-3" />
                        عرض صورة الدفع
                      </a>
                    ) : null}
                    {!canConfirmHere ? <p className="mt-1 text-xs text-blue-700">تأكيد هذا الدفع من مدير المناديب.</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updatePayment(collection.id, "confirmed")} disabled={!canConfirmHere}>
                      <Check className="ml-1 h-4 w-4" />
                      تأكيد
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updatePayment(collection.id, "rejected")} disabled={!canConfirmHere}>
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
        <CardContent className="space-y-3">
          {merchantRows.length === 0 ? (
            <p className="text-sm text-slate-400">لا يوجد تجار بعد.</p>
          ) : (
            merchantRows.map((row) => {
              const m = row.merchant;
              return (
                <div key={m.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-3">
                      {m.place_photo_url ? (
                        <div
                          className="h-14 w-14 shrink-0 rounded-lg bg-cover bg-center"
                          style={{ backgroundImage: `url(${m.place_photo_url})` }}
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                          <Store className="h-5 w-5" />
                        </div>
                      )}
                      <div>
                        <span className="font-medium">{m.business_name}</span>
                        <p className="mt-1 text-xs text-slate-500">
                          {m.owner_name || "بدون مالك"} · {m.city || "-"} · {m.region || "-"}
                        </p>
                        {m.location ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                            <MapPin className="h-3 w-3" />
                            {m.location}
                          </p>
                        ) : null}
                      </div>
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

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">المسلّم / الموجود</p>
                      <p className="mt-1 font-bold text-slate-950">{row.deliveredTotal} / {row.inHand}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">المباع</p>
                      <p className="mt-1 font-bold text-slate-950">{row.soldTotal} شريحة</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">قيمة المبيعات</p>
                      <p className="mt-1 font-bold text-slate-950">{formatMoney(row.soldValue)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">المدفوع / المتبقي</p>
                      <p className="mt-1 font-bold text-slate-950">{formatMoney(row.confirmedPayments)} / {formatMoney(row.outstanding)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2 lg:col-span-2">
                      <p className="text-xs text-slate-500">مدفوعات قيد التأكيد</p>
                      <p className="mt-1 font-bold text-blue-700">{formatMoney(row.pendingPayments)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2 lg:col-span-2">
                      <p className="text-xs text-slate-500">عمولات التاجر غير المدفوعة</p>
                      <p className="mt-1 font-bold text-amber-600">{formatMoney(row.unpaidCommission)}</p>
                    </div>
                  </div>
                </div>
              );
            })
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
