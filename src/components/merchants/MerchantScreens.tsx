"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CreditCard,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  RefreshCcw,
  ShoppingCart,
  Smartphone,
  Upload,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  collectMerchantCash,
  createMerchantRequest,
  getMerchantDashboard,
  getMerchantCollections,
  getMerchantRequests,
  getMerchantSims,
  getSimPackages,
  merchantRecordSale,
} from "@/lib/services/merchants";
import type { MerchantCashCollection, MerchantDashboardData, MerchantSimRequest } from "@/types/merchants";
import type { SimPackage, SimUnit } from "@/types/field-agents";

type Message = { tone: "success" | "error"; text: string } | null;

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}
function formatMoney(value: unknown) {
  const n = Number(value || 0);
  return `${Number.isFinite(n) ? n.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

function commissionPreview(pkg: SimPackage | null, tier: "agent" | "merchant") {
  if (!pkg) return "";
  const type = tier === "agent" ? pkg.agent_commission_type : pkg.merchant_commission_type;
  const value = tier === "agent" ? pkg.agent_commission_value : pkg.merchant_commission_value;
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
  { name: "الرئيسية", href: "/merchant", icon: LayoutDashboard },
  { name: "شرائحي", href: "/merchant/sims", icon: Smartphone },
  { name: "تسجيل بيع", href: "/merchant/sell", icon: ShoppingCart },
  { name: "طلب شرائح", href: "/merchant/requests", icon: Package },
  { name: "حسابي", href: "/merchant/balance", icon: Wallet },
];

function MerchantShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
            <p className="text-sm font-semibold text-brand">بوابة التاجر</p>
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

export function MerchantKioskScreen() {
  const [data, setData] = useState<MerchantDashboardData | null>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getMerchantDashboard().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setData(result.data);
    });
  }, []);

  return (
    <MerchantShell title={data ? data.merchant.business_name : "الرئيسية"} subtitle="ملخص نشاطك.">
      <MessageBanner message={message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">شرائح في المحل</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{data?.stock.in_hand ?? 0}</p>
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
            <p className="text-sm text-slate-500">المبلغ المستحق عليك للمندوب</p>
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
          <Link href="/merchant/sell">
            <ShoppingCart className="ml-2 h-4 w-4" />
            تسجيل بيع
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/merchant/requests">
            <Package className="ml-2 h-4 w-4" />
            طلب شرائح
          </Link>
        </Button>
      </div>
    </MerchantShell>
  );
}

export function MerchantSimListScreen() {
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getMerchantSims({ status: "with_merchant" }).then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setSims(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MerchantShell title="شرائحي" subtitle="الشرائح المتوفرة لديك للبيع.">
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
            <p className="text-sm text-slate-400">لا توجد شرائح لديك.</p>
          ) : (
            sims.map((sim) => (
              <div key={sim.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span dir="ltr" className="font-medium">
                  {sim.iccid}
                </span>
                <span className="text-slate-500">{sim.provider || "virgin"} · {sim.sim_type}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </MerchantShell>
  );
}

export function MerchantSellScreen() {
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [packages, setPackages] = useState<SimPackage[]>([]);
  const [simId, setSimId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [customer, setCustomer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    Promise.all([
      getMerchantSims({ status: "with_merchant" }),
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

  const selectedSim = useMemo(() => sims.find((sim) => sim.id === simId) || null, [sims, simId]);
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
    const result = await merchantRecordSale({
      sim_unit_id: simId,
      package_id: packageId,
      customer_name: customer.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم تسجيل البيع بنجاح." });
    setSimId("");
    setPackageId("");
    setCustomer("");
    load();
  };

  return (
    <MerchantShell title="تسجيل بيع" subtitle="اختر الشريحة ثم الباقة التي باعها المحل للعميل.">
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">بيانات البيع</CardTitle>
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
                <SelectValue placeholder="اختر شريحة" />
              </SelectTrigger>
              <SelectContent>
                {sims.map((sim) => (
                  <SelectItem key={sim.id} value={sim.id}>
                    {sim.iccid} · {sim.provider || "virgin"} · {sim.sim_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الباقة</Label>
            {!selectedSim ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                اختر الشريحة أولا حتى تظهر الباقات المتاحة لنفس المزود.
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
                        <span className="text-xs text-slate-500">عمولتك {commissionPreview(pkg, "merchant")}</span>
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
              سيتم تسجيل البيع بسعر {formatMoney(selectedPackage.sale_price)} واحتساب عمولة التاجر {commissionPreview(selectedPackage, "merchant")}.
            </div>
          ) : null}
          <Button onClick={submit} disabled={submitting} className="w-full">
            تأكيد البيع
          </Button>
        </CardContent>
      </Card>
    </MerchantShell>
  );
}

export function MerchantRequestScreen() {
  const [requests, setRequests] = useState<MerchantSimRequest[]>([]);
  const [quantity, setQuantity] = useState("");
  const [simType, setSimType] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getMerchantRequests().then((result) => {
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
    const result = await createMerchantRequest({
      quantity: Number(quantity || 0),
      sim_type: simType.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم إرسال الطلب للمندوب." });
    setQuantity("");
    setSimType("");
    setNotes("");
    load();
  };

  return (
    <MerchantShell title="طلب شرائح" subtitle="اطلب شرائح جديدة من مندوبك.">
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
    </MerchantShell>
  );
}

export function MerchantBalanceScreen() {
  const [data, setData] = useState<MerchantDashboardData | null>(null);
  const [collections, setCollections] = useState<MerchantCashCollection[]>([]);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    getMerchantDashboard().then(async (result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else {
        setData(result.data);
        if (result.data?.merchant.id) {
          const collectionResult = await getMerchantCollections(result.data.merchant.id);
          if (collectionResult.error) setMessage({ tone: "error", text: collectionResult.error.message });
          else setCollections(rows(collectionResult.data));
        }
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const needsProof = paymentMethod === "visa" || paymentMethod === "electronic" || paymentMethod === "bank_transfer";

  const submitPayment = async () => {
    setSubmitting(true);
    setMessage(null);
    if (!data?.merchant.id) {
      setMessage({ tone: "error", text: "تعذر تحديد حساب التاجر." });
      setSubmitting(false);
      return;
    }
    if (needsProof && !proof) {
      setMessage({ tone: "error", text: "ارفع صورة إثبات الدفع." });
      setSubmitting(false);
      return;
    }
    const body = new FormData();
    body.set("merchant_id", data.merchant.id);
    body.set("amount", String(Number(amount || 0)));
    body.set("payment_method", paymentMethod);
    body.set("collection_date", new Date().toISOString().slice(0, 10));
    if (notes.trim()) body.set("notes", notes.trim());
    if (proof) body.set("payment_proof", proof);
    const result = await collectMerchantCash(body);
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم إرسال الدفع للمراجعة." });
    setAmount("");
    setNotes("");
    setProof(null);
    load();
  };

  return (
    <MerchantShell title="حسابي" subtitle="المستحقات والمدفوعات والعمولات.">
      <MessageBanner message={message} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">إجمالي المستحق</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{formatMoney(data?.balance.total_owed)}</p>
            <p className="mt-1 text-xs text-slate-400">من أسعار الباقات المباعة</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">المدفوع للمندوب</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{formatMoney(data?.balance.total_collected)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">دفعات قيد التأكيد</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{formatMoney(data?.balance.pending_payments)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">المتبقي عليك</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{formatMoney(data?.balance.outstanding)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            تسجيل دفع للمندوب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>طريقة الدفع</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "cash")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="visa">فيزا</SelectItem>
                  <SelectItem value="electronic">دفع إلكتروني</SelectItem>
                  <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>ملاحظات (اختياري)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {needsProof ? (
            <div className="space-y-2">
              <Label>صورة إثبات الدفع</Label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                <span>{proof ? proof.name : "ارفع صورة التحويل أو الدفع"}</span>
                <Upload className="h-4 w-4" />
                <Input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          ) : null}
          <Button onClick={submitPayment} disabled={submitting} className="w-full">
            إرسال الدفع
          </Button>
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4" />
            سجل المدفوعات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {collections.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد مدفوعات بعد.</p>
          ) : (
            collections.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">{formatMoney(item.amount)}</p>
                  <p className="text-xs text-slate-500">
                    {paymentMethodLabels[item.payment_method] || item.payment_method} · {new Date(item.collection_date).toLocaleDateString("ar-SA")}
                  </p>
                  {item.payment_proof_url ? (
                    <a href={item.payment_proof_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand">
                      عرض إثبات الدفع
                    </a>
                  ) : null}
                  {item.rejection_reason ? <p className="mt-1 text-xs text-red-600">{item.rejection_reason}</p> : null}
                </div>
                <Badge
                  className={cn(
                    "w-fit border-0",
                    item.status === "confirmed"
                      ? "bg-emerald-100 text-emerald-700"
                      : item.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                  )}
                >
                  {paymentStatusLabels[item.status] || item.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </MerchantShell>
  );
}
