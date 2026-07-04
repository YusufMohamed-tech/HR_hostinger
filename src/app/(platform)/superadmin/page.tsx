"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  Clock3,
  FileText,
  History,
  MapPin,
  MessageCircle,
  PackageCheck,
  RefreshCcw,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSkeleton } from "@/components/Skeletons";
import { cn } from "@/lib/utils";
import {
  getSuperadminDashboard,
  type SuperadminDashboardData,
} from "@/lib/services/superadmin-organizations";

type DashboardStats = {
  organizations?: { total: number; active: number; suspended: number };
  users?: { total: number; active: number; suspended: number; roles: Record<string, number> };
  employees?: { total: number; active: number };
  structure?: { departments: number; locations: number; shifts: number };
  attendanceToday?: { total: number; present: number; late: number; absent: number };
  leaves?: { total: number; pending: number; approved: number; rejected: number };
  tasks?: { total: number; open: number; completed: number; overdue: number };
  recruitment?: { postings: number; openPostings: number; applications: number; newApplications: number; hired: number };
  sales?: {
    totalLast30: number;
    totalMonth: number;
    logsLast30: number;
    companies: number;
    activeCompanies: number;
    products: number;
    activeAssignments: number;
    pendingEditRequests: number;
  };
  finance?: {
    payslips: number;
    payrollNet: number;
    balances: number;
    openBalancesAmount: number;
    advanceRequests: number;
    pendingAdvanceRequests: number;
    pendingAdvanceAmount: number;
  };
  assets?: { total: number; assigned: number; returned: number; signed: number };
  communication?: { conversations: number; recentMessages: number; notifications: number; unreadNotifications: number };
};

const iconByModule: Record<string, React.ElementType> = {
  organizations: Building2,
  users: Users,
  employees: BriefcaseBusiness,
  attendance: Clock3,
  leaves: CalendarCheck,
  tasks: ClipboardCheck,
  recruitment: FileText,
  sales: BarChart3,
  payroll: WalletCards,
  assets: PackageCheck,
  finance: WalletCards,
  communications: MessageCircle,
};

const toneClasses: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  slate: "border-slate-200 bg-slate-50 text-slate-800",
};

const sourceClasses: Record<string, string> = {
  platform: "bg-slate-950 text-white",
  audit: "bg-slate-700 text-white",
  task: "bg-sky-600 text-white",
  leave: "bg-amber-500 text-white",
  recruitment: "bg-violet-600 text-white",
  sales: "bg-emerald-600 text-white",
  chat: "bg-blue-600 text-white",
  attendance: "bg-orange-500 text-white",
};

function numberFormat(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("ar-SA") : "0";
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function summaryValue(value: unknown) {
  return typeof value === "string" ? value : numberFormat(value);
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: "Admin",
    hr_admin: "HR Admin",
    hr_recruitment: "HR Recruitment",
    training_manager: "Training Manager",
    sales: "Sales",
    sales_manager: "Sales Manager",
    onground_agent_manager: "On-ground Agent Manager",
    promoter: "Promoter",
    employee: "Employee",
  };
  return labels[role] || role;
}

const controlGroups = [
  {
    title: "تحكم المنصة",
    links: [
      { label: "المنظمات", href: "/superadmin/organizations", icon: Building2 },
      { label: "اليوزرات", href: "/superadmin/users", icon: Users },
      { label: "سجل التدقيق", href: "/superadmin/audit", icon: History },
      { label: "الشات", href: "/chat", icon: MessageCircle },
    ],
  },
  {
    title: "عمليات HR",
    links: [
      { label: "الموظفون", href: "/employees", icon: BriefcaseBusiness },
      { label: "الأقسام", href: "/departments", icon: Building2 },
      { label: "الملفات", href: "/personnel", icon: FileText },
      { label: "الرواتب", href: "/payroll", icon: WalletCards },
      { label: "العهد", href: "/assets", icon: PackageCheck },
      { label: "الأرصدة والسلف", href: "/balances", icon: WalletCards },
      { label: "الإجازات", href: "/leave", icon: CalendarCheck },
      { label: "المهام", href: "/tasks", icon: ClipboardCheck },
      { label: "الحضور", href: "/attendance", icon: Clock3 },
      { label: "الجداول", href: "/schedule", icon: CalendarCheck },
      { label: "المواقع", href: "/locations", icon: MapPin },
      { label: "الإشعارات", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "المبيعات والتوظيف",
    links: [
      { label: "لوحة المبيعات", href: "/sales/dashboard", icon: BarChart3 },
      { label: "تسجيل المبيعات", href: "/sales/log", icon: WalletCards },
      { label: "تقارير المبيعات", href: "/sales/reports", icon: FileText },
      { label: "منتجات المبيعات", href: "/sales/products", icon: PackageCheck },
      { label: "فريق المبيعات", href: "/sales/team", icon: Users },
      { label: "التوظيف", href: "/recruitment", icon: FileText },
    ],
  },
];

export default function SuperadminDashboardPage() {
  const [dashboard, setDashboard] = useState<SuperadminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const result = await getSuperadminDashboard();
    if (result.error) {
      setError(result.error.message);
      if (!silent) setDashboard(null);
    } else {
      setError(null);
      setDashboard(result.data);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = (dashboard?.stats ?? {}) as DashboardStats;

  const topStats = useMemo(() => {
    const decisionCount = dashboard?.decisionQueue.reduce((sum, item) => sum + Number(item.value || 0), 0) ?? 0;
    return [
      {
        label: "المنظمات",
        value: stats.organizations?.total ?? 0,
        helper: `${numberFormat(stats.organizations?.active)} نشطة`,
        icon: Building2,
      },
      {
        label: "المستخدمون",
        value: stats.users?.total ?? 0,
        helper: `${numberFormat(stats.users?.active)} حساب نشط`,
        icon: Users,
      },
      {
        label: "مبيعات الشهر",
        value: `${numberFormat(stats.sales?.totalMonth)} ريال`,
        helper: `${numberFormat(stats.sales?.logsLast30)} تقرير آخر 30 يوم`,
        icon: BarChart3,
      },
      {
        label: "تحتاج متابعة",
        value: decisionCount,
        helper: "قرارات وتنبيهات مفتوحة",
        icon: AlertTriangle,
      },
    ];
  }, [dashboard?.decisionQueue, stats.organizations, stats.sales, stats.users]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!dashboard) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-red-700">
        {error || "تعذر تحميل لوحة المشرف العام."}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-950 text-white hover:bg-slate-950">
                <ShieldCheck className="ml-1 h-3.5 w-3.5" />
                صلاحية مشرف عام
              </Badge>
              <Badge variant="outline" className="border-brand/25 bg-brand-light text-brand-dark">
                مركز قيادة المنصة
              </Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
              داشبورد المشرف العام
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              شاشة واحدة لمراقبة كل ما يحدث داخل النظام: المستخدمون، الموظفون، الحضور، الإجازات،
              المهام، التوظيف، المبيعات، الرواتب، العهد، الشات، وسجل التحركات.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => loadDashboard(true)} disabled={refreshing}>
              <RefreshCcw className={cn("ml-2 h-4 w-4", refreshing && "animate-spin")} />
              تحديث
            </Button>
            <Button asChild className="bg-brand text-white hover:bg-brand-dark">
              <Link href="/superadmin/users">
                إدارة اليوزرات
                <ArrowUpRight className="mr-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {topStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">{stat.label}</span>
                  <Icon className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 text-2xl font-bold text-slate-950">{summaryValue(stat.value)}</div>
                <p className="mt-1 text-xs text-slate-500">{stat.helper}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboard.moduleCards.map((module) => {
          const Icon = iconByModule[module.key] || Activity;
          return (
            <Link key={module.key} href={module.href} className="group block">
              <Card className="h-full border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">{module.label}</CardTitle>
                  <span className={cn("rounded-lg border p-2", toneClasses[module.tone] || toneClasses.slate)}>
                    <Icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-950">{summaryValue(module.value)}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs leading-5 text-slate-500">{module.helper}</p>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-brand" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              طابور القرارات
            </CardTitle>
            <CardDescription>أهم الحاجات التي تحتاج متابعة مباشرة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.decisionQueue.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-xl border px-4 py-3 transition hover:border-brand/40 hover:bg-brand-light/40",
                  item.value > 0 ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"
                )}
              >
                <span className="text-sm font-medium text-slate-800">{item.label}</span>
                <Badge className={item.value > 0 ? "bg-red-600 text-white hover:bg-red-600" : "bg-slate-200 text-slate-700 hover:bg-slate-200"}>
                  {numberFormat(item.value)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-brand" />
              النشاط الحي
            </CardTitle>
            <CardDescription>آخر تحركات المستخدمين والعمليات عبر كل أقسام النظام.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[560px] overflow-auto">
            <div className="space-y-3">
              {dashboard.recentActivity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 transition hover:border-brand/30 hover:bg-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", sourceClasses[item.source] || "bg-slate-200 text-slate-700")}>
                        {item.source}
                      </span>
                      <span className="font-semibold text-slate-950">{item.title}</span>
                    </div>
                    <span className="text-xs text-slate-500">{formatDate(item.occurred_at)}</span>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{item.description}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{item.actor}</span>
                    <span>·</span>
                    <span>{item.organization}</span>
                  </div>
                </Link>
              ))}
              {dashboard.recentActivity.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                  لا يوجد نشاط حديث ظاهر حتى الآن.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>توزيع الأدوار</CardTitle>
            <CardDescription>نظرة مباشرة على كل صلاحيات المستخدمين في النظام.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(stats.users?.roles || {}).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">{roleLabel(role)}</span>
                  <Badge variant="outline" className="bg-white">{numberFormat(count)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>هيكل التشغيل</CardTitle>
            <CardDescription>الأقسام، المواقع، الورديات، وحالة حضور اليوم.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <MetricBlock label="الأقسام" value={stats.structure?.departments} />
            <MetricBlock label="المواقع" value={stats.structure?.locations} />
            <MetricBlock label="الورديات" value={stats.structure?.shifts} />
            <MetricBlock label="حضور" value={stats.attendanceToday?.present} />
            <MetricBlock label="متأخر" value={stats.attendanceToday?.late} tone="amber" />
            <MetricBlock label="غياب" value={stats.attendanceToday?.absent} tone="red" />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>أحدث اليوزرات</CardTitle>
            <CardDescription>آخر الحسابات المسجلة أو المحدثة في المنصة.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>الدور</TableHead>
                  <TableHead>المنظمة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.recentUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium text-slate-950">{user.name}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.organization}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-white">{user.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>المنظمات</CardTitle>
            <CardDescription>ملخص سريع للجهات وعدد المستخدمين والموظفين.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المنظمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الأعضاء</TableHead>
                  <TableHead>الموظفون</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.organizations.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell>
                      <div className="font-medium text-slate-950">{organization.name}</div>
                      <div className="text-xs text-slate-500">{organization.slug || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={organization.raw_status.toLowerCase() === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}
                      >
                        {organization.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{numberFormat(organization.members)}</TableCell>
                    <TableCell>{numberFormat(organization.employees)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">مراكز التحكم</h2>
          <p className="mt-1 text-sm text-slate-500">روابط مباشرة لكل مكان يحتاجه المشرف العام للعرض أو التحكم.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {controlGroups.map((group) => (
            <Card key={group.title} className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {group.links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Button key={link.href} variant="outline" asChild className="justify-between bg-white">
                      <Link href={link.href}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-brand" />
                          {link.label}
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-slate-400" />
                      </Link>
                    </Button>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          آخر تحديث واجه تحذيرًا: {error}
        </div>
      )}

      <div className="text-xs text-slate-400">
        آخر تجميع للبيانات: {formatDate(dashboard.generated_at)}
      </div>
    </div>
  );
}

function MetricBlock({ label, value, tone = "slate" }: { label: string; value: unknown; tone?: "slate" | "amber" | "red" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "red" && "border-red-200 bg-red-50 text-red-800",
        tone === "slate" && "border-slate-100 bg-slate-50 text-slate-800"
      )}
    >
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-2 text-xl font-bold">{numberFormat(value)}</div>
    </div>
  );
}
