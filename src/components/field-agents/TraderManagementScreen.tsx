"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgePercent,
  Banknote,
  MapPin,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  Smartphone,
  Store,
  TrendingUp,
  UserRound,
  Upload,
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
import { getFieldAgents, getSimUnits } from "@/lib/services/field-agents";
import {
  createMerchant,
  getMerchantCollections,
  getMerchantCommissions,
  getMerchants,
  getResellerRanking,
} from "@/lib/services/merchants";
import type { FieldAgent, SimUnit } from "@/types/field-agents";
import type { Merchant, MerchantCashCollection, MerchantCommission, ResellerRanking } from "@/types/merchants";

type Message = { tone: "success" | "error"; text: string } | null;

type TraderRow = {
  merchant: Merchant;
  agentName: string;
  inHand: number;
  soldTotal: number;
  soldValue: number;
  confirmedPayments: number;
  pendingPayments: number;
  outstanding: number;
  unpaidCommission: number;
  lastPayment: MerchantCashCollection | null;
};

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

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

function CreateTraderDialog({ agents, onDone }: { agents: FieldAgent[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radiusMeters, setRadiusMeters] = useState("100");
  const [placePhoto, setPlacePhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    agent_id: "",
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

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const setMapCoordinates = useCallback((latitude: string, longitude: string) => {
    setForm((prev) => ({ ...prev, latitude, longitude }));
  }, []);
  const selectedAgentName = agents.find((agent) => agent.id === form.agent_id)?.full_name || "";

  const reset = () => {
    setForm({
      agent_id: "",
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
    setRadiusMeters("100");
    setPlacePhoto(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    if (!form.agent_id) {
      setError("اختر المندوب المسؤول عن التاجر.");
      setSubmitting(false);
      return;
    }
    if (form.password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
      setSubmitting(false);
      return;
    }

    const payload = new FormData();
    payload.set("agent_id", form.agent_id);
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
    reset();
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="ml-2 h-4 w-4" />
        تاجر جديد
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة تاجر</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>المندوب المسؤول</Label>
            <Select value={form.agent_id} onValueChange={(value) => set("agent_id", value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المندوب">{selectedAgentName || undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.full_name} · {agent.region || "بدون منطقة"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>البريد الإلكتروني</Label>
            <Input dir="ltr" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input dir="ltr" type="text" value={form.password} onChange={(event) => set("password", event.target.value)} placeholder="8 أحرف على الأقل" />
          </div>
          <div className="space-y-2">
            <Label>اسم التاجر</Label>
            <Input value={form.business_name} onChange={(event) => set("business_name", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>اسم المالك</Label>
            <Input value={form.owner_name} onChange={(event) => set("owner_name", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المدينة</Label>
            <Input value={form.city} onChange={(event) => set("city", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المنطقة</Label>
            <Input value={form.region} onChange={(event) => set("region", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>رقم الجوال</Label>
            <Input dir="ltr" value={form.phone} onChange={(event) => set("phone", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>العنوان / وصف الموقع</Label>
            <Input value={form.location} onChange={(event) => set("location", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>خط العرض</Label>
            <Input dir="ltr" type="number" value={form.latitude} onChange={(event) => set("latitude", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>خط الطول</Label>
            <Input dir="ltr" type="number" value={form.longitude} onChange={(event) => set("longitude", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>النطاق (متر)</Label>
            <Input dir="ltr" type="number" min="10" value={radiusMeters} onChange={(event) => setRadiusMeters(event.target.value)} />
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
                onChange={(event) => setPlacePhoto(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={submitting || agents.length === 0}>
            حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TraderManagementScreen() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [agents, setAgents] = useState<FieldAgent[]>([]);
  const [sims, setSims] = useState<SimUnit[]>([]);
  const [collections, setCollections] = useState<MerchantCashCollection[]>([]);
  const [commissions, setCommissions] = useState<MerchantCommission[]>([]);
  const [ranking, setRanking] = useState<ResellerRanking[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    setMessage(null);
    Promise.all([getMerchants(), getFieldAgents(), getSimUnits(), getResellerRanking()]).then(
      async ([merchantResult, agentResult, simResult, rankingResult]) => {
        if (merchantResult.error) setMessage({ tone: "error", text: merchantResult.error.message });
        if (agentResult.error) setMessage({ tone: "error", text: agentResult.error.message });
        if (simResult.error) setMessage({ tone: "error", text: simResult.error.message });
        if (rankingResult.error) setMessage({ tone: "error", text: rankingResult.error.message });

        const merchantRows = rows(merchantResult.data);
        setMerchants(merchantRows);
        setAgents(rows(agentResult.data));
        setSims(rows(simResult.data));
        setRanking(rows(rankingResult.data));

        const collectionResults = await Promise.all(merchantRows.map((merchant) => getMerchantCollections(merchant.id)));
        const commissionResults = await Promise.all(merchantRows.map((merchant) => getMerchantCommissions({ merchant_id: merchant.id })));
        setCollections(collectionResults.flatMap((result) => rows(result.data)));
        setCommissions(commissionResults.flatMap((result) => rows(result.data)));
      }
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const agentName = useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.full_name || "مندوب غير معروف",
    [agents]
  );

  const traderRows = useMemo<TraderRow[]>(() => {
    return merchants.map((merchant) => {
      const merchantCollections = collections.filter((item) => item.merchant_id === merchant.id);
      const merchantCommissions = commissions.filter((item) => item.merchant_id === merchant.id);
      const soldSims = sims.filter((sim) => sim.sold_by_merchant_id === merchant.id && sim.status === "sold");
      const rank = ranking.find((item) => item.merchant_id === merchant.id);
      const soldValue = rank?.sold_value ?? soldSims.reduce((sum, sim) => sum + Number(sim.sold_price || 0), 0);
      const confirmedPayments = merchantCollections
        .filter((item) => item.status === "confirmed")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const pendingPayments = merchantCollections
        .filter((item) => item.status === "pending")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const lastPayment = merchantCollections
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
      return {
        merchant,
        agentName: agentName(merchant.agent_id),
        inHand: sims.filter((sim) => sim.current_merchant_id === merchant.id && sim.status === "with_merchant").length,
        soldTotal: rank?.sold_total ?? soldSims.length,
        soldValue,
        confirmedPayments,
        pendingPayments,
        outstanding: soldValue - confirmedPayments,
        unpaidCommission: merchantCommissions
          .filter((item) => !item.is_paid)
          .reduce((sum, item) => sum + Number(item.commission_amount || 0), 0),
        lastPayment,
      };
    });
  }, [agentName, collections, commissions, merchants, ranking, sims]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return traderRows;
    return traderRows.filter(({ merchant, agentName: ownerAgent }) =>
      [
        merchant.business_name,
        merchant.owner_name,
        merchant.phone,
        merchant.city,
        merchant.region,
        merchant.location,
        ownerAgent,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [search, traderRows]);

  const totals = useMemo(
    () => ({
      traders: traderRows.length,
      active: traderRows.filter((row) => row.merchant.status === "active").length,
      inHand: traderRows.reduce((sum, row) => sum + row.inHand, 0),
      sold: traderRows.reduce((sum, row) => sum + row.soldTotal, 0),
      soldValue: traderRows.reduce((sum, row) => sum + row.soldValue, 0),
      outstanding: traderRows.reduce((sum, row) => sum + row.outstanding, 0),
      pending: traderRows.reduce((sum, row) => sum + row.pendingPayments, 0),
    }),
    [traderRows]
  );

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">التجار</h1>
          <p className="mt-1 text-sm text-slate-500">كل التجار المرتبطين بمناديب الميدان، مع المبيعات والرصيد والمدفوعات.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateTraderDialog agents={agents} onDone={load} />
          <Button variant="outline" onClick={load}>
            <RefreshCcw className="ml-2 h-4 w-4" />
            تحديث
          </Button>
        </div>
      </div>

      <MessageBanner message={message} />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="عدد التجار" value={String(totals.traders)} hint={`${totals.active} نشط`} />
        <StatCard label="شرائح مع التجار" value={String(totals.inHand)} />
        <StatCard label="المبيعات" value={String(totals.sold)} hint={formatMoney(totals.soldValue)} />
        <StatCard label="الرصيد المتبقي" value={formatMoney(totals.outstanding)} hint={`قيد التأكيد ${formatMoney(totals.pending)}`} />
      </div>

      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث باسم التاجر، المالك، المدينة، المنطقة، أو المندوب"
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="p-6 text-center text-sm text-slate-400">لا توجد بيانات تجار مطابقة.</CardContent>
          </Card>
        ) : (
          filtered.map((row) => (
            <Card key={row.merchant.id} className="border border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex gap-3">
                    {row.merchant.place_photo_url ? (
                      <div
                        className="h-16 w-16 shrink-0 rounded-lg bg-cover bg-center"
                        style={{ backgroundImage: `url(${row.merchant.place_photo_url})` }}
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <Store className="h-6 w-6" />
                      </div>
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{row.merchant.business_name}</CardTitle>
                        {row.merchant.status === "active" ? (
                          <Badge className="border-0 bg-emerald-100 text-emerald-700">نشط</Badge>
                        ) : (
                          <Badge className="border-0 bg-red-100 text-red-700">موقوف</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3.5 w-3.5" />
                          {row.merchant.owner_name || "بدون مالك"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          <span dir="ltr">{row.merchant.phone || "-"}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {[row.merchant.city, row.merchant.region, row.merchant.location].filter(Boolean).join(" · ") || "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    المندوب المسؤول: <span className="font-semibold text-slate-950">{row.agentName}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Smartphone className="h-4 w-4" />
                      الشرائح
                    </p>
                    <p className="mt-1 text-lg font-bold text-slate-950">{row.inHand} معه · {row.soldTotal} مباعة</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <TrendingUp className="h-4 w-4" />
                      قيمة المبيعات
                    </p>
                    <p className="mt-1 text-lg font-bold text-slate-950">{formatMoney(row.soldValue)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Banknote className="h-4 w-4" />
                      المدفوع / المتبقي
                    </p>
                    <p className="mt-1 text-lg font-bold text-slate-950">{formatMoney(row.confirmedPayments)} / {formatMoney(row.outstanding)}</p>
                    {row.pendingPayments > 0 ? <p className="mt-1 text-xs text-blue-600">قيد التأكيد {formatMoney(row.pendingPayments)}</p> : null}
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <BadgePercent className="h-4 w-4" />
                      عمولات غير مدفوعة
                    </p>
                    <p className="mt-1 text-lg font-bold text-amber-600">{formatMoney(row.unpaidCommission)}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-semibold text-slate-950">آخر دفع</p>
                    {row.lastPayment ? (
                      <p className="mt-1 text-slate-500">
                        {formatMoney(row.lastPayment.amount)} · {paymentMethodLabels[row.lastPayment.payment_method] || row.lastPayment.payment_method} ·{" "}
                        {paymentStatusLabels[row.lastPayment.status] || row.lastPayment.status}
                      </p>
                    ) : (
                      <p className="mt-1 text-slate-400">لا يوجد دفع بعد.</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-semibold text-slate-950">إحداثيات الخريطة</p>
                    {row.merchant.latitude != null && row.merchant.longitude != null ? (
                      <p className="mt-1 text-slate-500" dir="ltr">
                        {row.merchant.latitude}, {row.merchant.longitude}
                      </p>
                    ) : (
                      <p className="mt-1 text-slate-400">لم يتم تسجيل الإحداثيات.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
