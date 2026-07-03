"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  LayoutDashboard,
  Package,
  RefreshCcw,
  ShoppingCart,
  Smartphone,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createSimRequest,
  getAgentDashboard,
  getCommissions,
  getSimRequests,
  getSimUnits,
  recordSale,
} from "@/lib/services/field-agents";
import type {
  AgentCommission,
  AgentDashboardData,
  AgentSimRequest,
  SimUnit,
} from "@/types/field-agents";

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

const navItems = [
  { name: "الرئيسية", href: "/agent", icon: LayoutDashboard },
  { name: "شرائحي", href: "/agent/sims", icon: Smartphone },
  { name: "تسجيل مبيعة", href: "/agent/sell", icon: ShoppingCart },
  { name: "طلب شرائح", href: "/agent/requests", icon: Package },
  { name: "رصيدي", href: "/agent/balance", icon: Wallet },
  { name: "عمولاتي", href: "/agent/commissions", icon: BadgePercent },
];

function AgentShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-sm font-semibold text-brand">كشك المندوب</p>
          <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
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
