"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, CalendarDays, Gauge, PackageCheck, Save, Settings2, Target, Timer, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import {
  getSalesDashboard,
  updateSalesDashboardSettings,
  type SalesChartPoint,
  type SalesDashboardAgent,
  type SalesDashboardData,
  type SalesDashboardReport,
  type SalesDashboardSettings,
} from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { PageSkeleton } from "@/components/Skeletons";

function formatMoney(value: number) {
  return formatCurrency(value, 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value || 0)));
}

function formatAxisMoney(value: number) {
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(1))}م`;
  if (value >= 1000) return `${Math.round(value / 1000)}ك`;
  return String(Math.round(value));
}

function formatDateEnglish(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
}

function metricTone(value: number, positiveIsGood = true) {
  if (value === 0) return "text-slate-700";
  const good = positiveIsGood ? value > 0 : value < 0;
  return good ? "text-brand-dark" : "text-red-600";
}

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function defaultDraft(settings?: SalesDashboardSettings | null): SalesDashboardSettings {
  return {
    company_id: settings?.company_id || null,
    channel_title: settings?.channel_title || "Modern Trade Western Channel",
    partner_label: settings?.partner_label || "chessboard_company",
    monthly_target: settings?.monthly_target || 2270,
    working_days: settings?.working_days || 30,
    focus_1_label: settings?.focus_1_label || "Yalla 20",
    focus_1_query: settings?.focus_1_query || "Yalla 20",
    focus_2_label: settings?.focus_2_label || "Yalla 30",
    focus_2_query: settings?.focus_2_query || "Yalla 30",
    focus_3_label: settings?.focus_3_label || "Above the Yalla 30",
    focus_3_query: settings?.focus_3_query || "above:30",
  };
}

export default function SalesDashboardPage() {
  const [dashboard, setDashboard] = useState<SalesDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<SalesDashboardSettings>(defaultDraft());

  const loadDashboard = async (companyId?: string, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    const result = await getSalesDashboard(companyId);
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر تحميل لوحة المبيعات.");
    } else {
      setDashboard(result.data);
      setSelectedCompanyId(result.data.selectedCompanyId || "");
      setSettingsDraft(defaultDraft(result.data.dashboardSettings));
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = dashboard?.stats ?? { today: 0, week: 0, month: 0, activeAgents: 0 };
  const leaderboard = useMemo(() => dashboard?.leaderboard ?? [], [dashboard]);
  const report = dashboard?.report ?? null;
  const companies = useMemo(() => dashboard?.companies ?? [], [dashboard?.companies]);
  const canManageSettings = Boolean(dashboard?.canManageSettings);
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies]);

  const setDraft = (key: keyof SalesDashboardSettings, value: string | number | null) => {
    setSettingsDraft((previous) => ({ ...previous, [key]: value }));
  };

  const handleCompanyChange = (companyId: string | null) => {
    if (!companyId) return;
    setSelectedCompanyId(companyId);
    loadDashboard(companyId, true);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    const result = await updateSalesDashboardSettings({
      ...settingsDraft,
      company_id: selectedCompanyId || settingsDraft.company_id || null,
      monthly_target: Number(settingsDraft.monthly_target || 0),
      working_days: Number(settingsDraft.working_days || 30),
    });
    setSavingSettings(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage("تم حفظ إعدادات لوحة المبيعات بنجاح.");
    loadDashboard(selectedCompanyId, true);
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">لوحة المبيعات</h1>
          <p className="mt-2 text-gray-500">تقرير يومي لمتابعة الهدف، التفعيل، الفجوة، واتجاه المبيعات.</p>
        </div>
        {companies.length > 1 && (
          <div className="w-full lg:w-72">
            <Label className="mb-1 block text-xs text-gray-500">الشركة</Label>
            <Select value={selectedCompanyId} onValueChange={handleCompanyChange} disabled={refreshing}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الشركة">
                  {(value: string | null) => value ? companyNameById.get(value) || "اختر الشركة" : "اختر الشركة"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {report && <SalesPerformanceReport report={report} />}

      {canManageSettings && (
        <SalesDashboardSettingsPanel
          settings={settingsDraft}
          onChange={setDraft}
          onSave={saveSettings}
          saving={savingSettings || refreshing}
        />
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="مبيعات اليوم" value={formatMoney(stats.today)} icon={TrendingUp} />
        <StatCard title="مبيعات الأسبوع" value={formatMoney(stats.week)} icon={CalendarDays} />
        <StatCard title="مبيعات الشهر" value={formatMoney(stats.month)} icon={BarChart3} />
        <StatCard title="البائعون النشطون" value={String(stats.activeAgents)} icon={Users} />
      </div>

      <SalesChartCard
        title="مبيعات الشهور"
        description="إجمالي المبيعات مجمعة شهريًا من بداية السنة الحالية."
        data={dashboard?.monthlySales ?? []}
        xInterval={0}
      />

      <SalesChartCard
        title="مبيعات آخر 30 يوم"
        description="إجمالي المبيعات اليومية خلال آخر 30 يوم."
        data={dashboard?.dailySales ?? []}
        xInterval={2}
      />

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>البائع</TableHead>
                <TableHead>اليوم</TableHead>
                <TableHead>الأسبوع</TableHead>
                <TableHead>الشهر</TableHead>
                <TableHead>التقرير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((agent: SalesDashboardAgent) => (
                <TableRow key={agent.user_id}>
                  <TableCell>
                    <p className="font-semibold">{agent.full_name}</p>
                    <p className="text-xs text-gray-500">{agent.email}</p>
                  </TableCell>
                  <TableCell>{formatMoney(agent.today)}</TableCell>
                  <TableCell>{formatMoney(agent.week)}</TableCell>
                  <TableCell className="font-semibold text-brand-dark">{formatMoney(agent.month)}</TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sales/reports?agent=${agent.user_id}`}>عرض التقرير</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SalesPerformanceReport({ report }: { report: SalesDashboardReport }) {
  const metrics = report.metrics;
  const companyName = report.company?.name || "Sales";
  const companyCode = report.company?.code || companyName;
  const targetProgress = boundedPercent(metrics.actualPercent);
  const expectedProgress = boundedPercent(metrics.expectedPercent);
  const latestDay = report.trend.at(-1);
  const kpis = [
    { title: "الوكيل", subtitle: "Partner", value: metrics.partner, icon: Users },
    { title: "الهدف الشهري", subtitle: "Target", value: formatNumber(metrics.target), icon: Target },
    { title: "تحقيق المبيعات", subtitle: "Activations", value: formatNumber(metrics.activations), icon: PackageCheck, valueClass: "text-brand-dark" },
    { title: "نسبة تحقيق الهدف", subtitle: "Act%", value: `${metrics.actualPercent}%`, icon: Gauge, valueClass: metricTone(metrics.actualPercent - 100) },
    { title: "المتبقي من المبيعات", subtitle: "Remaining & Over", value: formatNumber(metrics.remainingOver), icon: TrendingUp, valueClass: metricTone(metrics.remainingOver) },
    { title: "التارجت اليومي", subtitle: "Daily Target", value: formatNumber(metrics.dailyTarget), icon: Activity },
    { title: "الأيام المتبقية", subtitle: "Remaining Days", value: formatNumber(metrics.remainingDays), icon: CalendarDays },
    { title: "نسبة المتوقع", subtitle: "Expected%", value: `${metrics.expectedPercent}%`, icon: Gauge, valueClass: "text-amber-600" },
    { title: "فرق المبيعات", subtitle: "Sales GAP", value: formatNumber(metrics.salesGap), icon: BarChart3, valueClass: metricTone(metrics.salesGap) },
    { title: "مطلوب يوميًا", subtitle: "Required Daily", value: formatNumber(metrics.requiredDaily), icon: Timer, valueClass: "text-red-600" },
  ];

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-brand/20 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-brand-dark">لوحة أداء المبيعات</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-950">{companyName}</h2>
              <p className="mt-1 text-sm text-slate-500">{report.settings.channel_title}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center rounded-full bg-brand-light px-3 py-1 font-semibold text-brand-dark">
              {companyCode}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
              <CalendarDays className="h-4 w-4" />
              {report.dayName} · {formatDateEnglish(report.date)}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">التقدم نحو الهدف الشهري</p>
                <p className="mt-1 text-3xl font-bold text-slate-950">
                  {formatNumber(metrics.activations)}
                  <span className="mx-2 text-base font-medium text-slate-400">من</span>
                  {formatNumber(metrics.target)}
                </p>
              </div>
              <span className={`text-3xl font-bold ${metricTone(metrics.actualPercent - 100)}`}>{metrics.actualPercent}%</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${targetProgress}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>المتوقع حتى اليوم: {metrics.expectedPercent}%</span>
              <span>·</span>
              <span>آخر تسجيل: {latestDay ? `${formatNumber(latestDay.total)} تفعيل` : "لا يوجد"}</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">إيقاع الشهر</p>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-brand-dark">{metrics.remainingDays} يوم متبقي</span>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>المتوقع</span>
                  <span>{metrics.expectedPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${expectedProgress}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">مطلوب يوميًا</p>
                  <p className="mt-1 font-bold text-red-600">{formatNumber(metrics.requiredDaily)}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">فرق المبيعات</p>
                  <p className={`mt-1 font-bold ${metricTone(metrics.salesGap)}`}>{formatNumber(metrics.salesGap)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <ReportMetric key={`${kpi.title}-${kpi.subtitle}`} {...kpi} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">الباقات الأعلى أداء</h3>
              <p className="text-sm text-slate-500">تقرأ من منتجات المبيعات وتتحرك حسب البيانات المسجلة.</p>
            </div>
            <PackageCheck className="h-5 w-5 text-brand" />
          </div>
          <div className="space-y-3">
            {report.focusGroups.map((group) => (
              <FocusProductCard key={group.label} label={group.label} value={group.value} percent={group.percent} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">اتجاه المبيعات</h3>
              <p className="text-sm text-slate-500">حركة التفعيلات اليومية خلال الشهر الحالي.</p>
            </div>
            <TrendingUp className="h-5 w-5 text-brand" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.trend} margin={{ top: 12, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ direction: "rtl", borderRadius: 8, borderColor: "#e5e7eb" }} />
                <Line type="monotone" dataKey="total" stroke="#58B145" strokeWidth={3} dot={{ r: 3, fill: "#58B145" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">أداء أيام الشهر</h3>
            <p className="text-sm text-slate-500">كل يوم يوضح عدد التفعيلات ونسبة تحقيق الهدف اليومي.</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">MTD Target: {formatNumber(metrics.expectedTarget)} · {metrics.expectedPercent}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {report.calendarDays.map((day) => (
            <DailyPerformanceCell key={day.date} day={day} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SalesDashboardSettingsPanel({
  settings,
  onChange,
  onSave,
  saving,
}: {
  settings: SalesDashboardSettings;
  onChange: (key: keyof SalesDashboardSettings, value: string | number | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-brand" />
              <h2 className="text-lg font-semibold text-slate-950">إعدادات تقرير المبيعات</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">هذه القيم يضعها HR أو مدير المبيعات، وباقي المؤشرات يتم حسابها تلقائيًا.</p>
          </div>
          <Button onClick={onSave} disabled={saving} className="bg-brand text-white hover:bg-brand-dark">
            <Save className="ml-2 h-4 w-4" />
            {saving ? "جار الحفظ..." : "حفظ الإعدادات"}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="عنوان القناة">
            <Input value={settings.channel_title} onChange={(event) => onChange("channel_title", event.target.value)} />
          </Field>
          <Field label="اسم الوكيل / الشريك">
            <Input value={settings.partner_label} onChange={(event) => onChange("partner_label", event.target.value)} />
          </Field>
          <Field label="الهدف الشهري">
            <Input type="number" min={0} value={settings.monthly_target} onChange={(event) => onChange("monthly_target", Number(event.target.value))} />
          </Field>
          <Field label="أيام العمل في الشهر">
            <Input type="number" min={1} max={31} value={settings.working_days} onChange={(event) => onChange("working_days", Number(event.target.value))} />
          </Field>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <FocusSetting title="الباقة الأولى" labelKey="focus_1_label" queryKey="focus_1_query" settings={settings} onChange={onChange} />
          <FocusSetting title="الباقة الثانية" labelKey="focus_2_label" queryKey="focus_2_query" settings={settings} onChange={onChange} />
          <FocusSetting title="الباقة الثالثة" labelKey="focus_3_label" queryKey="focus_3_query" settings={settings} onChange={onChange} />
        </div>
      </CardContent>
    </Card>
  );
}

function FocusSetting({
  title,
  labelKey,
  queryKey,
  settings,
  onChange,
}: {
  title: string;
  labelKey: keyof SalesDashboardSettings;
  queryKey: keyof SalesDashboardSettings;
  settings: SalesDashboardSettings;
  onChange: (key: keyof SalesDashboardSettings, value: string | number | null) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="mb-3 text-sm font-semibold text-slate-900">{title}</p>
      <div className="space-y-2">
        <Field label="الاسم الظاهر">
          <Input value={String(settings[labelKey] || "")} onChange={(event) => onChange(labelKey, event.target.value)} />
        </Field>
        <Field label="كلمة البحث في اسم المنتج">
          <Input value={String(settings[queryKey] || "")} onChange={(event) => onChange(queryKey, event.target.value)} placeholder="مثال: Yalla 20 أو above:30" />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ReportMetric({
  title,
  subtitle,
  value,
  valueClass = "text-slate-950",
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  value: string;
  valueClass?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-[11px] text-slate-500" dir="ltr">{subtitle}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`mt-4 text-2xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function FocusProductCard({ label, value, percent }: { label: string; value: number; percent: number }) {
  const safePercent = boundedPercent(percent);
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{label}</p>
          <p className="mt-1 text-xs text-slate-500">نسبة من الهدف الشهري</p>
        </div>
        <div className="text-left">
          <p className="text-lg font-bold text-brand-dark">{formatNumber(value)}</p>
          <p className="text-xs font-semibold text-slate-500">{percent}%</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-brand" style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function DailyPerformanceCell({
  day,
}: {
  day: SalesDashboardReport["calendarDays"][number];
}) {
  const safePercent = boundedPercent(day.percent);
  const strength = day.isFuture ? "bg-slate-50 text-slate-400" : safePercent >= 80 ? "bg-brand-light text-brand-dark" : safePercent >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600";
  return (
    <div
      className={`min-h-[76px] rounded-lg border border-slate-100 p-2 transition hover:-translate-y-0.5 hover:shadow-sm ${strength}`}
      title={`${day.label} - ${formatNumber(day.value)} - ${day.percent}%`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{String(day.day).padStart(2, "0")}</span>
        {!day.isFuture && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold">{day.percent}%</span>}
      </div>
      <p className="mt-3 text-lg font-bold">{day.isFuture ? "—" : formatNumber(day.value)}</p>
      <p className="mt-1 text-[11px] opacity-75">{day.isFuture ? "قادم" : "تفعيل"}</p>
    </div>
  );
}

function SalesChartCard({
  title,
  description,
  data,
  xInterval,
}: {
  title: string;
  description: string;
  data: SalesChartPoint[];
  xInterval: number;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <div className="h-72 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d1d5db" />
              <XAxis
                dataKey="label"
                interval={xInterval}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#9ca3af" }}
              />
              <YAxis
                width={64}
                tickFormatter={(value) => formatAxisMoney(Number(value || 0))}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#9ca3af" }}
              />
              <Tooltip
                formatter={(value) => formatMoney(Number(value || 0))}
                labelStyle={{ color: "#111827" }}
                contentStyle={{ direction: "rtl", borderRadius: 8, borderColor: "#e5e7eb" }}
              />
              <Bar dataKey="total" fill="#58B145" radius={[7, 7, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="mt-2 text-xl font-bold text-gray-950">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
