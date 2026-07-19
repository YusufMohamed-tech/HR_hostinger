"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  FileDown,
  Megaphone,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Smartphone,
  Users,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  assignPromoterLead,
  createPromoterCampaign,
  createPromoterLead,
  createPromoterOffer,
  createPromoterReferenceValue,
  deletePromoterOffer,
  getPromoterCampaigns,
  getPromoterDashboard,
  getPromoterLeads,
  getPromoterOffers,
  getPromoterReferenceValues,
  getPromoterSettings,
  updatePromoterLeadStatus,
  updatePromoterSettings,
} from "@/lib/services/promoter";
import { recommendOffer } from "@/lib/promoter/recommendation";
import type {
  PromoterCampaign,
  PromoterDashboardData,
  PromoterLead,
  PromoterReferenceKind,
  PromoterReferenceValue,
  PromoterSettings,
  TelecomOffer,
  TelecomOfferTarget,
} from "@/types/promoter";

type Message = { tone: "success" | "error"; text: string } | null;

const targetLabels: Record<TelecomOfferTarget, string> = {
  mobile: "جوال",
  home_internet: "إنترنت منزلي",
  bundle: "باقة مشتركة",
  addon: "إضافة",
};

const statusLabels: Record<string, string> = {
  captured: "تم الالتقاط",
  recommended: "تم الترشيح",
  sent_to_agent: "أرسل للمبيعات",
  converted: "تحول لبيع",
  not_interested: "غير مهتم",
  invalid: "غير صالح",
};

const referenceKindLabels: Record<PromoterReferenceKind, string> = {
  mobile_operator: "مشغل جوال",
  internet_provider: "مزود إنترنت",
  city: "مدينة",
};

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? Math.round(number).toLocaleString("ar-SA") : "0"} ر.س`;
}

function splitList(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function MessageBanner({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      message.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-red-200 bg-red-50 text-red-700"
    }`}>
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
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function CompactList({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-slate-500">لا توجد بيانات.</p> : null}
        {items.slice(0, 8).map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
            <span className="text-slate-700">{item.label || "غير محدد"}</span>
            <Badge variant="outline">{item.count}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PromoterDashboardScreen() {
  const [dashboard, setDashboard] = useState<PromoterDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message>(null);

  const load = async () => {
    setLoading(true);
    const result = await getPromoterDashboard();
    setLoading(false);
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else setDashboard(result.data);
  };

  useEffect(() => {
    load();
  }, []);

  const data = dashboard || {
    leads: 0,
    sentToAgent: 0,
    converted: 0,
    conversionRate: 0,
    estimatedSavings: 0,
    byStatus: [],
    byCity: [],
    byOperator: [],
    byOffer: [],
    byPromoter: [],
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title="لوحة الترويج"
        subtitle="متابعة عملاء الترويج والتحويلات والعروض."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/sales/promoter/offers">العروض</Link></Button>
            <Button asChild><Link href="/promoter">فتح الكشك</Link></Button>
          </>
        }
      />
      <MessageBanner message={message} />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="العملاء" value={loading ? "..." : String(data.leads)} icon={Users} />
        <StatCard label="أرسل للمبيعات" value={String(data.sentToAgent)} icon={Send} />
        <StatCard label="التحويل" value={`${data.conversionRate}%`} icon={BadgeCheck} />
        <StatCard label="التوفير المقترح" value={formatMoney(data.estimatedSavings)} icon={BarChart3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <CompactList title="حسب الحالة" items={data.byStatus} />
        <CompactList title="حسب المدينة" items={data.byCity} />
        <CompactList title="حسب المشغل" items={data.byOperator} />
      </div>
    </div>
  );
}

export function PromoterOffersScreen() {
  const [offers, setOffers] = useState<TelecomOffer[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name_ar: "",
    offer_target: "mobile" as TelecomOfferTarget,
    monthly_price: "100",
    data_gb: "",
    minutes: "",
    sim_count: "",
    priority: "0",
    benefits_ar: "",
    target_operators: "",
    cities: "",
    min_monthly_spend: "",
    max_monthly_spend: "",
    min_sims: "",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const load = async () => {
    const result = await getPromoterOffers({ activeOnly: false });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else setOffers(rows(result.data));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setSubmitting(true);
    setMessage(null);
    const result = await createPromoterOffer({
      name_ar: form.name_ar,
      offer_target: form.offer_target,
      monthly_price: Number(form.monthly_price || 0),
      data_gb: form.data_gb ? Number(form.data_gb) : null,
      minutes: form.minutes ? Number(form.minutes) : null,
      sim_count: form.sim_count ? Number(form.sim_count) : null,
      priority: Number(form.priority || 0),
      benefits_ar: form.benefits_ar,
      benefits_en: [],
      eligibility: {
        offer_target: form.offer_target,
        target_operators: splitList(form.target_operators),
        cities: splitList(form.cities),
        min_monthly_spend: form.min_monthly_spend ? Number(form.min_monthly_spend) : null,
        max_monthly_spend: form.max_monthly_spend ? Number(form.max_monthly_spend) : null,
        min_sims: form.min_sims ? Number(form.min_sims) : null,
        requires_home_internet: form.offer_target === "bundle",
      },
      is_active: true,
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم حفظ العرض." });
    setForm((prev) => ({ ...prev, name_ar: "", benefits_ar: "" }));
    load();
  };

  const deactivate = async (offerId: string) => {
    const result = await deletePromoterOffer(offerId);
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "success", text: "تم تعطيل العرض." });
      load();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle title="عروض الترويج" subtitle="إدارة كتالوج العروض الذي يستخدمه محرك الترشيح." />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">عرض جديد</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2 lg:col-span-2">
            <Label>اسم العرض</Label>
            <Input value={form.name_ar} onChange={(event) => set("name_ar", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>النوع</Label>
            <Select value={form.offer_target} onValueChange={(value) => set("offer_target", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(targetLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>السعر الشهري</Label>
            <Input type="number" value={form.monthly_price} onChange={(event) => set("monthly_price", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>البيانات GB</Label>
            <Input type="number" value={form.data_gb} onChange={(event) => set("data_gb", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الدقائق</Label>
            <Input type="number" value={form.minutes} onChange={(event) => set("minutes", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>عدد الشرائح</Label>
            <Input type="number" value={form.sim_count} onChange={(event) => set("sim_count", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الأولوية</Label>
            <Input type="number" value={form.priority} onChange={(event) => set("priority", event.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label>المشغلون المستهدفون</Label>
            <Input value={form.target_operators} onChange={(event) => set("target_operators", event.target.value)} placeholder="stc, mobily" />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label>المدن</Label>
            <Input value={form.cities} onChange={(event) => set("cities", event.target.value)} placeholder="riyadh, jeddah" />
          </div>
          <div className="space-y-2">
            <Label>أقل إنفاق</Label>
            <Input type="number" value={form.min_monthly_spend} onChange={(event) => set("min_monthly_spend", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>أعلى إنفاق</Label>
            <Input type="number" value={form.max_monthly_spend} onChange={(event) => set("max_monthly_spend", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>أقل شرائح</Label>
            <Input type="number" value={form.min_sims} onChange={(event) => set("min_sims", event.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-4">
            <Label>المزايا</Label>
            <textarea className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand" value={form.benefits_ar} onChange={(event) => set("benefits_ar", event.target.value)} />
          </div>
          <div className="lg:col-span-4">
            <Button onClick={create} disabled={submitting || !form.name_ar.trim()}>
              <Plus className="ml-2 h-4 w-4" />
              حفظ العرض
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">العروض الحالية</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العرض</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>الأولوية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((offer) => (
                <TableRow key={offer.id}>
                  <TableCell className="font-medium">{offer.name_ar}</TableCell>
                  <TableCell>{targetLabels[offer.offer_target]}</TableCell>
                  <TableCell>{formatMoney(offer.monthly_price)}</TableCell>
                  <TableCell>{offer.priority}</TableCell>
                  <TableCell><Badge variant="outline">{offer.is_active ? "نشط" : "معطل"}</Badge></TableCell>
                  <TableCell>{offer.is_active ? <Button size="sm" variant="outline" onClick={() => deactivate(offer.id)}>تعطيل</Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PromoterReferenceScreen() {
  const [items, setItems] = useState<PromoterReferenceValue[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [form, setForm] = useState({ kind: "mobile_operator" as PromoterReferenceKind, code: "", label_ar: "", label_en: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const load = async () => {
    const result = await getPromoterReferenceValues();
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else setItems(rows(result.data));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const result = await createPromoterReferenceValue({ ...form, is_active: true, sort_order: 0 });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "success", text: "تمت إضافة القيمة." });
      setForm((prev) => ({ ...prev, code: "", label_ar: "", label_en: "" }));
      load();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle title="قيم الترويج المرجعية" subtitle="المشغلون ومزودو الإنترنت والمدن المستخدمة في الكشك." />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="grid gap-4 p-5 md:grid-cols-5">
          <div className="space-y-2">
            <Label>النوع</Label>
            <Select value={form.kind} onValueChange={(value) => set("kind", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(referenceKindLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الكود</Label>
            <Input value={form.code} onChange={(event) => set("code", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>العربي</Label>
            <Input value={form.label_ar} onChange={(event) => set("label_ar", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>English</Label>
            <Input value={form.label_en} onChange={(event) => set("label_en", event.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={create} disabled={!form.code.trim() || !form.label_ar.trim()}>إضافة</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{referenceKindLabels[item.kind]}</TableCell>
                  <TableCell className="font-mono">{item.code}</TableCell>
                  <TableCell>{item.label_ar}</TableCell>
                  <TableCell><Badge variant="outline">{item.is_active ? "نشط" : "معطل"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PromoterCampaignsScreen() {
  const [campaigns, setCampaigns] = useState<PromoterCampaign[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [form, setForm] = useState({ name: "", code: "", start_date: "", end_date: "", target_leads: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const load = async () => {
    const result = await getPromoterCampaigns();
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else setCampaigns(rows(result.data));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const result = await createPromoterCampaign({
      ...form,
      target_leads: form.target_leads ? Number(form.target_leads) : null,
      is_active: true,
    });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "success", text: "تم حفظ الحملة." });
      setForm({ name: "", code: "", start_date: "", end_date: "", target_leads: "" });
      load();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle title="حملات الترويج" subtitle="تنظيم العملاء حسب حملة أو فعالية ميدانية." />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="grid gap-4 p-5 md:grid-cols-5">
          <div className="space-y-2 md:col-span-2"><Label>اسم الحملة</Label><Input value={form.name} onChange={(event) => set("name", event.target.value)} /></div>
          <div className="space-y-2"><Label>الكود</Label><Input value={form.code} onChange={(event) => set("code", event.target.value)} /></div>
          <div className="space-y-2"><Label>البداية</Label><Input type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} /></div>
          <div className="space-y-2"><Label>النهاية</Label><Input type="date" value={form.end_date} onChange={(event) => set("end_date", event.target.value)} /></div>
          <div className="space-y-2"><Label>الهدف</Label><Input type="number" value={form.target_leads} onChange={(event) => set("target_leads", event.target.value)} /></div>
          <div className="flex items-end"><Button onClick={create} disabled={!form.name.trim()}>حفظ الحملة</Button></div>
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <Table>
            <TableHeader><TableRow><TableHead>الحملة</TableHead><TableHead>الكود</TableHead><TableHead>الفترة</TableHead><TableHead>الهدف</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell>{campaign.code || "-"}</TableCell>
                  <TableCell>{campaign.start_date || "-"} / {campaign.end_date || "-"}</TableCell>
                  <TableCell>{campaign.target_leads || "-"}</TableCell>
                  <TableCell><Badge variant="outline">{campaign.is_active ? "نشطة" : "معطلة"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PromoterSettingsScreen() {
  const [settings, setSettings] = useState<PromoterSettings | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [form, setForm] = useState({
    savings: "0.6",
    data: "0.2",
    bundle: "0.1",
    priority: "0.1",
    consent_version: "v1",
    consent_text_ar: "",
    consent_text_en: "",
  });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  useEffect(() => {
    getPromoterSettings().then((result) => {
      if (result.error) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      const next = result.data;
      setSettings(next);
      setForm({
        savings: String(next?.weights?.savings ?? 0.6),
        data: String(next?.weights?.data ?? 0.2),
        bundle: String(next?.weights?.bundle ?? 0.1),
        priority: String(next?.weights?.priority ?? 0.1),
        consent_version: next?.consent_version || "v1",
        consent_text_ar: next?.consent_text_ar || "",
        consent_text_en: next?.consent_text_en || "",
      });
    });
  }, []);

  const save = async () => {
    const result = await updatePromoterSettings({
      weights: {
        savings: Number(form.savings),
        data: Number(form.data),
        bundle: Number(form.bundle),
        priority: Number(form.priority),
      },
      consent_version: form.consent_version,
      consent_text_ar: form.consent_text_ar,
      consent_text_en: form.consent_text_en,
    });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setSettings(result.data);
      setMessage({ tone: "success", text: "تم حفظ الإعدادات." });
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle title="إعدادات الترويج" subtitle="أوزان الترشيح ونصوص الموافقة." />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">أوزان الترشيح</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          {(["savings", "data", "bundle", "priority"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label>{key}</Label>
              <Input type="number" step="0.1" min="0" max="1" value={form[key]} onChange={(event) => set(key, event.target.value)} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">الموافقة</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>نسخة الموافقة</Label><Input value={form.consent_version} onChange={(event) => set("consent_version", event.target.value)} /></div>
          <div className="space-y-2"><Label>النص العربي</Label><textarea className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand" value={form.consent_text_ar} onChange={(event) => set("consent_text_ar", event.target.value)} /></div>
          <div className="space-y-2"><Label>English text</Label><textarea className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand" value={form.consent_text_en} onChange={(event) => set("consent_text_en", event.target.value)} /></div>
          <Button onClick={save}><Settings className="ml-2 h-4 w-4" />حفظ الإعدادات</Button>
          {settings?.updated_at ? <p className="text-xs text-slate-500">آخر تحديث: {new Date(settings.updated_at).toLocaleString("ar-SA")}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function PromoterLeadsScreen({ agentQueue = false }: { agentQueue?: boolean }) {
  const [leads, setLeads] = useState<PromoterLead[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [status, setStatus] = useState("all");
  const [agentId, setAgentId] = useState("");

  const load = async () => {
    const result = await getPromoterLeads({ status });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else setLeads(rows(result.data));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const updateStatus = async (leadId: string, nextStatus: string) => {
    const result = await updatePromoterLeadStatus(leadId, { status: nextStatus });
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "success", text: "تم تحديث العميل." });
      load();
    }
  };

  const assign = async (leadId: string) => {
    if (!agentId.trim()) {
      setMessage({ tone: "error", text: "اكتب رقم مستخدم موظف المبيعات." });
      return;
    }
    const result = await assignPromoterLead(leadId, agentId.trim());
    if (result.error) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "success", text: "تم إرسال العميل للمبيعات." });
      load();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title={agentQueue ? "عملاء الترويج" : "إدارة عملاء الترويج"}
        subtitle={agentQueue ? "قائمة العملاء المسندة لك من فريق الترويج." : "متابعة العملاء وتصديرهم وإرسالهم لفريق المبيعات."}
        actions={<Button asChild variant="outline"><Link href="/api/sales/promoter/leads/export"><FileDown className="ml-2 h-4 w-4" />تصدير CSV</Link></Button>}
      />
      <MessageBanner message={message} />
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-end">
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Select value={status} onValueChange={(value) => setStatus(value || "all")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!agentQueue ? (
            <div className="space-y-2">
              <Label>معرف موظف المبيعات</Label>
              <Input className="w-80" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
            </div>
          ) : null}
          <Button variant="outline" onClick={load}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button>
        </CardContent>
      </Card>
      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>المدينة</TableHead>
                <TableHead>المشغل</TableHead>
                <TableHead>التوفير</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.full_name}</TableCell>
                  <TableCell dir="ltr">{lead.mobile}</TableCell>
                  <TableCell>{lead.city || "-"}</TableCell>
                  <TableCell>{lead.current_operator || "-"}</TableCell>
                  <TableCell>{formatMoney(lead.estimated_savings)}</TableCell>
                  <TableCell><Badge variant="outline">{statusLabels[lead.status] || lead.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {!agentQueue ? <Button size="sm" variant="outline" onClick={() => assign(lead.id)}>إرسال</Button> : null}
                      <Button size="sm" variant="outline" onClick={() => updateStatus(lead.id, "converted")}>تحويل</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(lead.id, "not_interested")}>غير مهتم</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {leads.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">لا توجد عملاء.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PromoterKioskScreen() {
  const [offers, setOffers] = useState<TelecomOffer[]>([]);
  const [refs, setRefs] = useState<PromoterReferenceValue[]>([]);
  const [campaigns, setCampaigns] = useState<PromoterCampaign[]>([]);
  const [settings, setSettings] = useState<PromoterSettings | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    mobile: "",
    email: "",
    city: "",
    current_operator: "",
    sim_count: "1",
    monthly_mobile_spend: "",
    home_internet_provider: "",
    monthly_home_spend: "",
    campaign_id: "",
    marketing_consent: false,
    consent_given: false,
    pushed_offer_id: "",
  });
  const set = (key: string, value: string | boolean | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  useEffect(() => {
    Promise.all([
      getPromoterOffers({ activeOnly: true }),
      getPromoterReferenceValues(),
      getPromoterCampaigns({ activeOnly: true }),
      getPromoterSettings(),
    ]).then(([offerResult, refResult, campaignResult, settingsResult]) => {
      if (offerResult.error) setMessage({ tone: "error", text: offerResult.error.message });
      setOffers(rows(offerResult.data));
      setRefs(rows(refResult.data));
      setCampaigns(rows(campaignResult.data));
      setSettings(settingsResult.data);
    });
  }, []);

  const reference = (kind: PromoterReferenceKind) => refs.filter((item) => item.kind === kind && item.is_active);
  const survey = useMemo(() => ({
    city: form.city || null,
    current_operator: form.current_operator || null,
    sim_count: Number(form.sim_count || 0),
    monthly_mobile_spend: Number(form.monthly_mobile_spend || 0),
    home_internet_provider: form.home_internet_provider || null,
    monthly_home_spend: Number(form.monthly_home_spend || 0),
  }), [
    form.city,
    form.current_operator,
    form.home_internet_provider,
    form.monthly_home_spend,
    form.monthly_mobile_spend,
    form.sim_count,
  ]);
  const recommendation = useMemo(() => recommendOffer(survey, offers, settings?.weights), [offers, settings?.weights, survey]);
  const selected = offers.find((offer) => offer.id === form.pushed_offer_id) || recommendation.best?.offer || null;

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    const result = await createPromoterLead({
      ...survey,
      full_name: form.full_name,
      mobile: form.mobile,
      email: form.email,
      campaign_id: form.campaign_id || null,
      pushed_offer_id: form.pushed_offer_id || null,
      consent_given: form.consent_given,
      marketing_consent: form.marketing_consent,
      consent_version: settings?.consent_version || "v1",
      language: "ar",
    });
    setSubmitting(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({ tone: "success", text: "تم تسجيل العميل بنجاح." });
    setForm((prev) => ({
      ...prev,
      full_name: "",
      mobile: "",
      email: "",
      monthly_mobile_spend: "",
      monthly_home_spend: "",
      pushed_offer_id: "",
      consent_given: false,
      marketing_consent: false,
    }));
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand">كشك الترويج</p>
            <h1 className="text-3xl font-bold text-slate-950">ترشيح العرض المناسب للعميل</h1>
          </div>
          <Button asChild variant="outline"><Link href="/sales/promoter"><ArrowUpRight className="ml-2 h-4 w-4" />لوحة الترويج</Link></Button>
        </div>
        <MessageBanner message={message} />
        <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader><CardTitle>بيانات العميل</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label>اسم العميل</Label><Input value={form.full_name} onChange={(event) => set("full_name", event.target.value)} /></div>
              <div className="space-y-2"><Label>الجوال</Label><Input dir="ltr" value={form.mobile} onChange={(event) => set("mobile", event.target.value)} /></div>
              <div className="space-y-2"><Label>البريد</Label><Input dir="ltr" value={form.email} onChange={(event) => set("email", event.target.value)} /></div>
              <div className="space-y-2">
                <Label>المدينة</Label>
                <Select value={form.city || "none"} onValueChange={(value) => set("city", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">غير محدد</SelectItem>
                    {reference("city").map((item) => <SelectItem key={item.id} value={item.code}>{item.label_ar}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>المشغل الحالي</Label>
                <Select value={form.current_operator || "none"} onValueChange={(value) => set("current_operator", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">غير محدد</SelectItem>
                    {reference("mobile_operator").map((item) => <SelectItem key={item.id} value={item.code}>{item.label_ar}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>عدد الشرائح</Label><Input type="number" value={form.sim_count} onChange={(event) => set("sim_count", event.target.value)} /></div>
              <div className="space-y-2"><Label>إنفاق الجوال شهريا</Label><Input type="number" value={form.monthly_mobile_spend} onChange={(event) => set("monthly_mobile_spend", event.target.value)} /></div>
              <div className="space-y-2">
                <Label>مزود الإنترنت المنزلي</Label>
                <Select value={form.home_internet_provider || "none"} onValueChange={(value) => set("home_internet_provider", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">لا يوجد</SelectItem>
                    {reference("internet_provider").map((item) => <SelectItem key={item.id} value={item.code}>{item.label_ar}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>إنفاق الإنترنت شهريا</Label><Input type="number" value={form.monthly_home_spend} onChange={(event) => set("monthly_home_spend", event.target.value)} /></div>
              <div className="space-y-2">
                <Label>الحملة</Label>
                <Select value={form.campaign_id || "none"} onValueChange={(value) => set("campaign_id", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون حملة</SelectItem>
                    {campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm md:col-span-2">
                <input type="checkbox" checked={form.marketing_consent} onChange={(event) => set("marketing_consent", event.target.checked)} />
                موافقة العميل على التواصل التسويقي.
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm md:col-span-2">
                <input type="checkbox" checked={form.consent_given} onChange={(event) => set("consent_given", event.target.checked)} />
                {settings?.consent_text_ar || "أوافق على تسجيل بيانات العميل لغرض متابعة الطلب وترشيح العرض المناسب."}
              </label>
            </CardContent>
          </Card>
          <div className="space-y-5">
            <Card className="border border-slate-200 shadow-sm">
              <CardHeader><CardTitle>العرض المرشح</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {selected ? (
                  <>
                    <div className="rounded-xl bg-brand/10 p-4">
                      <p className="text-lg font-bold text-slate-950">{selected.name_ar}</p>
                      <p className="mt-1 text-sm text-slate-600">{targetLabels[selected.offer_target]} - {formatMoney(selected.monthly_price)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border border-slate-200 p-3"><Smartphone className="mb-2 h-4 w-4 text-brand" />{selected.data_gb || 0} GB</div>
                      <div className="rounded-lg border border-slate-200 p-3"><Wifi className="mb-2 h-4 w-4 text-brand" />{formatMoney(recommendation.best?.estimatedSavings || 0)}</div>
                    </div>
                  </>
                ) : <p className="text-sm text-slate-500">أدخل بيانات الإنفاق لظهور الترشيح.</p>}
                <Select value={form.pushed_offer_id || "auto"} onValueChange={(value) => set("pushed_offer_id", value === "auto" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="العرض اليدوي" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">ترشيح تلقائي</SelectItem>
                    {offers.map((offer) => <SelectItem key={offer.id} value={offer.id}>{offer.name_ar}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button className="w-full" onClick={submit} disabled={submitting || !form.full_name.trim() || !form.mobile.trim() || !form.consent_given}>
                  <CheckCircle2 className="ml-2 h-4 w-4" />
                  تسجيل العميل
                </Button>
              </CardContent>
            </Card>
            <Card className="border border-slate-200 shadow-sm">
              <CardHeader><CardTitle>بدائل</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {recommendation.alternatives.map((item) => (
                  <button key={item.offer.id} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-right text-sm hover:border-brand" onClick={() => set("pushed_offer_id", item.offer.id)}>
                    <span className="font-medium">{item.offer.name_ar}</span>
                    <span className="block text-slate-500">{formatMoney(item.offer.monthly_price)} - توفير {formatMoney(item.estimatedSavings)}</span>
                  </button>
                ))}
                {recommendation.alternatives.length === 0 ? <p className="text-sm text-slate-500">لا توجد بدائل مناسبة الآن.</p> : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PromoterAdminHomeScreen() {
  return (
    <div className="space-y-6">
      <PageTitle title="إدارة الترويج" subtitle="العروض والعملاء والحملات وإعدادات الترشيح." />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["/sales/promoter/dashboard", "لوحة الأداء", BarChart3],
          ["/sales/promoter/offers", "العروض", Megaphone],
          ["/sales/promoter/reference", "القيم المرجعية", Settings],
          ["/sales/promoter/leads", "العملاء", Users],
          ["/sales/promoter/campaigns", "الحملات", BadgeCheck],
          ["/promoter", "فتح الكشك", Smartphone],
        ].map(([href, label, Icon]) => (
          <Link key={String(href)} href={String(href)} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand">
            {React.createElement(Icon as React.ElementType, { className: "h-6 w-6 text-brand" })}
            <p className="mt-4 font-semibold text-slate-950">{String(label)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
