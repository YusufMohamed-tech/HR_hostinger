"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, Save, Settings2, TrendingUp, Users } from "lucide-react";
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
  const companies = dashboard?.companies ?? [];
  const canManageSettings = Boolean(dashboard?.canManageSettings);

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
                <SelectValue placeholder="اختر الشركة" />
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
  const brandColor = report.company?.brandColor || "#58B145";
  const companyName = report.company?.name || "Sales";
  const companyCode = report.company?.code || companyName;

  return (
    <section className="overflow-hidden rounded-xl border border-brand/30 bg-white shadow-sm">
      <div className="grid gap-4 border-b border-slate-100 p-4 md:grid-cols-[220px_1fr_220px] md:items-center">
        <div className="text-right md:text-left">
          <p className="text-3xl font-extrabold uppercase tracking-tight" style={{ color: brandColor }}>
            {companyCode || companyName}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{companyName}</p>
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-sky-700">{report.settings.channel_title}</h2>
          <div className="mx-auto mt-4 h-px max-w-3xl bg-sky-500" />
        </div>
        <div className="flex items-center justify-start gap-3 md:justify-end" dir="ltr">
          <CalendarDays className="h-8 w-8 text-sky-600" />
          <div className="text-right">
            <p className="text-sm font-bold text-sky-700">{report.dayName}</p>
            <p className="mt-2 text-sm font-bold text-sky-700">{formatDateEnglish(report.date)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-slate-200 text-center md:grid-cols-5 xl:grid-cols-10">
        <ReportMetric title="الوكيل" subtitle="Partner" value={metrics.partner} />
        <ReportMetric title="الهدف الشهري" subtitle="Target" value={formatNumber(metrics.target)} />
        <ReportMetric title="تحقيق المبيعات" subtitle="Activations" value={formatNumber(metrics.activations)} />
        <ReportMetric title="نسبة تحقيق الهدف" subtitle="Act%" value={`${metrics.actualPercent}%`} valueClass={metricTone(metrics.actualPercent - 100)} />
        <ReportMetric title="المتبقي من المبيعات" subtitle="Remaining & Over" value={formatNumber(metrics.remainingOver)} valueClass={metricTone(metrics.remainingOver)} />
        <ReportMetric title="التارجت اليومي" subtitle="Daily Target" value={formatNumber(metrics.dailyTarget)} />
        <ReportMetric title="الأيام المتبقية" subtitle="Remaining Days" value={formatNumber(metrics.remainingDays)} />
        <ReportMetric title="نسبة المتوقع" subtitle="Expected%" value={`${metrics.expectedPercent}%`} valueClass="text-red-600" />
        <ReportMetric title="فرق المبيعات" subtitle="Sales GAP" value={formatNumber(metrics.salesGap)} valueClass={metricTone(metrics.salesGap)} />
        <ReportMetric title="مطلوب يوميًا" subtitle="Required Daily" value={formatNumber(metrics.requiredDaily)} valueClass="text-red-600" />
      </div>

      <div className="p-4">
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <h3 className="mb-4 text-center text-sm font-bold text-sky-700">الباقات الأعلى بيعًا</h3>
          <div className="grid gap-5 md:grid-cols-3">
            {report.focusGroups.map((group) => (
              <FocusCircle key={group.label} label={group.label} value={group.value} percent={group.percent} />
            ))}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-center text-sm font-bold text-slate-600">معدل المبيعات اليومية - ونسبة تحقيق الهدف اليومية</h3>
          <div className="grid gap-0 overflow-hidden rounded-lg border border-slate-200 md:grid-cols-[1fr_160px]">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
              {report.calendarDays.map((day) => (
                <div key={day.date} className="min-h-[82px] border-b border-l border-slate-100 p-2 text-center">
                  <p className="text-[11px] font-bold text-sky-700">{day.label}</p>
                  {!day.isFuture && (
                    <>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{formatNumber(day.value)}</p>
                      <span className="mt-2 inline-flex min-w-20 justify-center rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-red-500">
                        {day.percent}%
                      </span>
                    </>
                  )}
                  {day.isFuture && <div className="mx-auto mt-8 h-5 w-20 rounded-full bg-sky-100" />}
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center justify-center border-slate-200 p-4 text-center md:border-r">
              <p className="text-sm font-bold text-sky-700">MTD Target</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">{formatNumber(metrics.expectedTarget)}</p>
              <span className="mt-2 inline-flex min-w-20 justify-center rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-red-500">
                {metrics.expectedPercent}%
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-center text-sm font-bold text-sky-700">Sales Trend - اتجاه المبيعات</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.trend} margin={{ top: 20, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ direction: "rtl", borderRadius: 8, borderColor: "#e5e7eb" }} />
                <Line type="monotone" dataKey="total" stroke="#0f6f93" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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

function ReportMetric({ title, subtitle, value, valueClass = "text-sky-700" }: { title: string; subtitle: string; value: string; valueClass?: string }) {
  return (
    <div className="border-l border-slate-100 p-3">
      <p className="text-xs font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-[11px] text-slate-500" dir="ltr">{subtitle}</p>
      <span className={`mt-2 inline-flex min-w-24 justify-center rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function FocusCircle({ label, value, percent }: { label: string; value: number; percent: number }) {
  const degrees = Math.max(0, Math.min(100, percent)) * 3.6;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm font-bold text-sky-700 underline underline-offset-2">{label}</p>
      <div
        className="flex h-32 w-32 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(#0ea5e9 ${degrees}deg, #e5e7eb ${degrees}deg)` }}
      >
        <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white">
          <p className="text-xl font-extrabold text-sky-700">{formatNumber(value)}</p>
          <p className="mt-2 text-lg font-medium text-slate-800">{percent}%</p>
        </div>
      </div>
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
