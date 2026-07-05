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
  Search,
  ShoppingCart,
  Smartphone,
  Upload,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function formatSimLabel(sim: SimUnit | null | undefined) {
  if (!sim) return "";
  return [sim.iccid || "شريحة بدون رقم", sim.provider || "virgin", sim.sim_type].filter(Boolean).join(" · ");
}

function commissionPreview(pkg: SimPackage | null, tier: "agent" | "merchant") {
  if (!pkg) return "";
  const type = tier === "agent" ? pkg.agent_commission_type : pkg.merchant_commission_type;
  const value = tier === "agent" ? pkg.agent_commission_value : pkg.merchant_commission_value;
  const amount = type === "flat" ? value : (Number(pkg.sale_price || 0) * value) / 100;
  return formatMoney(amount);
}

function discountLabel(pkg: SimPackage) {
  const base = Number(pkg.base_price || 0);
  const sale = Number(pkg.sale_price || 0);
  if (!base || sale >= base) return "";
  return `%${Math.round(((base - sale) / base) * 100)}`;
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
  const [simSearch, setSimSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
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

  const activePackages = useMemo(
    () => packages.filter((pkg) => pkg.status === "active"),
    [packages]
  );
  const selectedPackage = useMemo(() => packages.find((pkg) => pkg.id === packageId) || null, [packages, packageId]);
  const selectedSim = useMemo(() => sims.find((sim) => sim.id === simId) || null, [sims, simId]);
  const packageSims = useMemo(() => {
    if (!selectedPackage) return [];
    return sims.filter((sim) => (sim.provider || "virgin") === (selectedPackage.provider || "virgin"));
  }, [selectedPackage, sims]);
  const filteredSims = useMemo(() => {
    const q = simSearch.trim().toLowerCase();
    if (!q) return packageSims;
    return packageSims.filter((sim) =>
      [sim.iccid, sim.sim_type, sim.provider]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [packageSims, simSearch]);

  const openSale = (pkg: SimPackage) => {
    setPackageId(pkg.id);
    setSimId("");
    setSimSearch("");
    setCustomer("");
    setMessage(null);
    setSaleOpen(true);
  };

  const closeSale = () => {
    if (submitting) return;
    setSaleOpen(false);
    setPackageId("");
    setSimId("");
    setSimSearch("");
  };

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
    setSimSearch("");
    setCustomer("");
    setSaleOpen(false);
    load();
  };

  return (
    <MerchantShell title="الباقات" subtitle="اختر الباقة ثم اربطها بالشريحة التي تم بيعها.">
      <MessageBanner message={message} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#e30613] px-5 py-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm opacity-90">فيرجن</p>
              <h2 className="mt-2 text-2xl font-bold">ابحث عن خطتك المثالية</h2>
            </div>
            <div className="rounded-lg border border-white/50 px-3 py-2 text-sm font-bold">
              Virgin
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700">مكالمات وبيانات</span>
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700">لا محدود</span>
            <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-medium text-emerald-700">خصومات</span>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCcw className="ml-2 h-4 w-4" />
              تحديث
            </Button>
          </div>

          <p className="text-sm font-semibold text-slate-700">{activePackages.length} باقة</p>

          {activePackages.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">لا توجد باقات فعالة.</p>
          ) : (
            <div className="space-y-3">
              {activePackages.map((pkg) => {
                const pkgDiscount = discountLabel(pkg);
                const providerSims = sims.filter((sim) => (sim.provider || "virgin") === (pkg.provider || "virgin"));
                const canSell = providerSims.length > 0;

                return (
                  <div key={pkg.id} className="relative rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
                    {pkgDiscount ? (
                      <div className="absolute left-4 top-0 rounded-b-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-600">
                        {pkgDiscount}
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-[#e30613] text-[10px] font-bold leading-tight text-white">
                          <span>Virgin</span>
                          <span>mobile</span>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-950">{pkg.package_name}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            مدمجة | مسبقة الدفع
                          </p>
                        </div>
                      </div>
                      <Badge className="border-0 bg-slate-100 text-slate-600">{pkg.provider || "virgin"}</Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 divide-x-reverse text-center">
                      <div>
                        <p className="font-bold text-slate-950">{pkg.internet_allowance || "-"}</p>
                        <p className="mt-1 text-xs text-slate-400">إنترنت</p>
                      </div>
                      <div>
                        <p className="font-bold text-slate-950">{pkg.minutes_allowance || "-"}</p>
                        <p className="mt-1 text-xs text-slate-400">مكالمة</p>
                      </div>
                      <div>
                        <p className="font-bold text-slate-950">{pkg.validity || "-"}</p>
                        <p className="mt-1 text-xs text-slate-400">صلاحية</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-w-28 border-teal-500 text-teal-700 hover:bg-teal-50 hover:text-teal-800"
                        onClick={() => openSale(pkg)}
                        disabled={!canSell}
                      >
                        شراء
                      </Button>
                      <div className="text-left">
                        <div className="flex items-baseline justify-end gap-2">
                          <span className="text-lg font-bold text-teal-600">{formatMoney(pkg.sale_price)}</span>
                          {Number(pkg.base_price || 0) > Number(pkg.sale_price || 0) ? (
                            <span className="text-sm text-slate-400 line-through">{formatMoney(pkg.base_price)}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {pkg.tax_included ? "شامل الضريبة" : "غير شامل الضريبة"}
                        </p>
                        <p className="mt-1 text-xs text-emerald-600">عمولتك {commissionPreview(pkg, "merchant")}</p>
                        {!canSell ? <p className="mt-1 text-xs text-rose-500">لا توجد شرائح متاحة لهذا المزود</p> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={saleOpen} onOpenChange={(next) => (next ? setSaleOpen(true) : closeSale())}>
        <DialogContent dir="rtl" className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedPackage ? `بيع ${selectedPackage.package_name}` : "تسجيل بيع"}</DialogTitle>
          </DialogHeader>

          {selectedPackage ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-950">{selectedPackage.package_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedPackage.internet_allowance || "-"} إنترنت · {selectedPackage.minutes_allowance || "-"} مكالمات
                  </p>
                </div>
                <span className="font-bold text-teal-600">{formatMoney(selectedPackage.sale_price)}</span>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>ابحث برقم الشريحة ICCID</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                dir="ltr"
                value={simSearch}
                onChange={(event) => setSimSearch(event.target.value)}
                placeholder="اكتب رقم الشريحة..."
                className="pr-9 text-left"
              />
            </div>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {filteredSims.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">لا توجد شرائح مطابقة.</p>
            ) : (
              filteredSims.map((sim) => {
                const active = simId === sim.id;
                return (
                  <button
                    key={sim.id}
                    type="button"
                    onClick={() => setSimId(sim.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition",
                      active ? "border-teal-500 bg-teal-50 ring-2 ring-teal-100" : "border-slate-200 bg-white hover:border-teal-300"
                    )}
                  >
                    <span className="text-slate-500">{sim.sim_type}</span>
                    <span dir="ltr" className="font-semibold text-slate-950">{sim.iccid}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="space-y-2">
            <Label>اسم العميل (اختياري)</Label>
            <Input value={customer} onChange={(event) => setCustomer(event.target.value)} />
          </div>

          {selectedPackage && selectedSim ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              سيتم بيع {formatSimLabel(selectedSim)} على باقة {selectedPackage.package_name} بسعر {formatMoney(selectedPackage.sale_price)}.
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeSale} disabled={submitting}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={submitting || !selectedPackage || !selectedSim}>
              تأكيد البيع
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
