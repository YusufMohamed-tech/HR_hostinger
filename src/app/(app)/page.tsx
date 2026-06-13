"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniLineChart } from "@/components/charts/MiniLineChart";
import { useEmployees, useAttendance, useTasks, useLeaveRequests, useNotifications, useEmployeeShifts } from "@/hooks/use-data";
import {
  Users,
  Clock,
  ClipboardList,
  CheckSquare,
  Bell,
  CalendarDays,
  MapPin
} from "lucide-react";

function getEmployeeFromRow(row: Record<string, unknown>) {
  return (row.employee ?? null) as Record<string, unknown> | null;
}

function isEmployeeManagedBy(employee: Record<string, unknown>, managerEmployeeId?: string) {
  if (!managerEmployeeId) return false;
  if (String(employee.manager_id || "") === managerEmployeeId) return true;

  const department = (employee.department ?? null) as Record<string, unknown> | null;
  if (String(department?.manager_employee_id || "") === managerEmployeeId) return true;

  const location = (employee.location ?? null) as Record<string, unknown> | null;
  return String(location?.manager_employee_id || "") === managerEmployeeId;
}

function asRecord(value: unknown) {
  return (value && typeof value === "object" ? value : null) as Record<string, unknown> | null;
}

function getText(value: unknown, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function getEmployeeName(employee: Record<string, unknown>) {
  return getText(employee.full_name, getText(employee.name, "موظف"));
}

function getEmployeeLocationRows(employee: Record<string, unknown>) {
  const rows = Array.isArray(employee.employee_locations) ? employee.employee_locations : [];
  return rows
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function getEmployeeLocationIds(employee: Record<string, unknown>) {
  const ids = new Set<string>();
  const directLocationId = getText(employee.location_id);
  if (directLocationId) ids.add(directLocationId);
  getEmployeeLocationRows(employee).forEach((row) => {
    const locationId = getText(row.location_id);
    if (locationId) ids.add(locationId);
  });
  return ids;
}

function getEmployeeLocationFields(employee: Record<string, unknown>) {
  const cities = new Set<string>();
  const projects = new Set<string>();
  const locationNames = new Set<string>();
  const directLocation = asRecord(employee.location);
  if (directLocation) {
    const city = getText(directLocation.city);
    const projectId = getText(directLocation.project_id);
    const name = getText(directLocation.name);
    if (city) cities.add(city);
    if (projectId) projects.add(projectId);
    if (name) locationNames.add(name);
  }
  getEmployeeLocationRows(employee).forEach((row) => {
    const location = asRecord(row.location);
    if (!location) return;
    const city = getText(location.city);
    const projectId = getText(location.project_id);
    const name = getText(location.name);
    if (city) cities.add(city);
    if (projectId) projects.add(projectId);
    if (name) locationNames.add(name);
  });
  return { cities, projects, locationNames };
}

function sharesHrScope(employee: Record<string, unknown>, scope: { locationIds: Set<string>; cities: Set<string>; projects: Set<string> }) {
  const employeeLocationIds = getEmployeeLocationIds(employee);
  if (Array.from(employeeLocationIds).some((id) => scope.locationIds.has(id))) return true;

  const fields = getEmployeeLocationFields(employee);
  if (Array.from(fields.cities).some((city) => scope.cities.has(city))) return true;
  if (Array.from(fields.projects).some((projectId) => scope.projects.has(projectId))) return true;

  return scope.locationIds.size === 0 && scope.cities.size === 0 && scope.projects.size === 0;
}

function isActiveEmployee(employee: Record<string, unknown>) {
  const status = getText(employee.status, "active").toLowerCase();
  return !["inactive", "terminated", "archived", "deleted", "موقوف", "منتهي"].includes(status);
}

function isTrainee(employee: Record<string, unknown>) {
  const employmentType = getText(employee.employment_type).toLowerCase();
  const jobTitle = getText(employee.job_title).toLowerCase();
  return employmentType.includes("intern")
    || employmentType.includes("trainee")
    || jobTitle.includes("trainee")
    || jobTitle.includes("متدرب");
}

function getProbationDays(employee: Record<string, unknown>) {
  const hiringDate = getText(employee.hiring_date);
  if (!hiringDate) return null;
  const parsed = new Date(hiringDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const elapsed = Math.floor((Date.now() - parsed.getTime()) / 86400000);
  if (elapsed < 0 || elapsed > 180) return null;
  return elapsed;
}

export default function DashboardPage() {
  const router = useRouter();
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const today = new Date().toISOString().split("T")[0];
  const { data: allAttendance } = useAttendance(); // Fetch all to compute 7-day trend
  const { data: tasks } = useTasks();
  const { data: leaves } = useLeaveRequests();
  const { data: notifications } = useNotifications();
  const { data: myShifts } = useEmployeeShifts(currentUser?.employeeId);

  useEffect(() => {
    if (currentUser?.role === "Superadmin") {
      router.replace("/superadmin");
      return;
    }

    if (currentUser?.role === "HR_Recruitment") {
      router.replace("/recruitment");
    }
  }, [currentUser?.role, router]);

  if (currentUser?.role === "Superadmin" || currentUser?.role === "HR_Recruitment") {
    return null;
  }

  const isManager = currentUser?.role === "Training_Manager";
  const canViewOrgStats = ["Admin", "HR_Admin"].includes(currentUser?.role || "");
  const teamEmployees = isManager
    ? employees.filter((employee) => isEmployeeManagedBy(employee as Record<string, unknown>, currentUser?.employeeId))
    : [];
  const dashboardEmployees = isManager ? teamEmployees : employees;
  const teamEmployeeIds = new Set(teamEmployees.map((employee) => String((employee as Record<string, unknown>).id || "")));
  const isHrDashboard = ["Admin", "HR_Admin"].includes(currentUser?.role || "");
  const currentEmployeeRecord = employees.find((employee) => String((employee as Record<string, unknown>).id || "") === currentUser?.employeeId) as Record<string, unknown> | undefined;
  const currentEmployeeLocationFields = currentEmployeeRecord ? getEmployeeLocationFields(currentEmployeeRecord) : { cities: new Set<string>(), projects: new Set<string>(), locationNames: new Set<string>() };
  const currentEmployeeLocationIds = currentEmployeeRecord ? getEmployeeLocationIds(currentEmployeeRecord) : new Set<string>();
  const hrScope = {
    locationIds: currentEmployeeLocationIds,
    cities: currentEmployeeLocationFields.cities,
    projects: currentEmployeeLocationFields.projects,
  };
  const hasHrLocationScope = hrScope.locationIds.size > 0 || hrScope.cities.size > 0 || hrScope.projects.size > 0;
  const hrScopeLabel = hasHrLocationScope
    ? Array.from(currentEmployeeLocationFields.cities).slice(0, 2).join("، ")
      || Array.from(currentEmployeeLocationFields.locationNames).slice(0, 2).join("، ")
      || "نطاق المواقع المسندة"
    : "كل المناطق";
  const hrRegionalEmployees = isHrDashboard
    ? employees
        .map((employee) => employee as Record<string, unknown>)
        .filter((employee) => isActiveEmployee(employee))
        .filter((employee) => !hasHrLocationScope || sharesHrScope(employee, hrScope))
    : [];
  const hrRegionalEmployeeIds = new Set(hrRegionalEmployees.map((employee) => String(employee.id || "")));
  const hrTrainees = hrRegionalEmployees.filter(isTrainee);
  const hrJobTitleSummary = Object.entries(
    hrRegionalEmployees.reduce<Record<string, number>>((acc, employee) => {
      const title = getText(employee.job_title, "بدون مسمى");
      acc[title] = (acc[title] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);
  const hrLeavesToday = leaves
    .map((leave) => leave as Record<string, unknown>)
    .filter((leave) => {
      const status = getText(leave.status).toLowerCase();
      const employeeId = getText(leave.employee_id);
      const startDate = getText(leave.start_date);
      const endDate = getText(leave.end_date);
      return status === "approved"
        && hrRegionalEmployeeIds.has(employeeId)
        && startDate <= today
        && endDate >= today;
    });
  const hrEmployeesOnLeave = hrLeavesToday
    .map((leave) => {
      const employeeId = getText(leave.employee_id);
      const employee = hrRegionalEmployees.find((item) => String(item.id || "") === employeeId);
      return employee ? { employee, leave } : null;
    })
    .filter((entry): entry is { employee: Record<string, unknown>; leave: Record<string, unknown> } => Boolean(entry));
  const hrProbationEmployees = hrRegionalEmployees
    .map((employee) => ({ employee, days: getProbationDays(employee) }))
    .filter((entry): entry is { employee: Record<string, unknown>; days: number } => entry.days !== null)
    .sort((a, b) => b.days - a.days);

  const scopedAttendance = isManager
    ? allAttendance.filter((row) => {
        const employee = getEmployeeFromRow(row as Record<string, unknown>);
        return Boolean(employee && isEmployeeManagedBy(employee, currentUser?.employeeId));
      })
    : allAttendance;
  const todayRecords = scopedAttendance.filter(row => (row as Record<string, unknown>).work_date === today);
  const presentCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "present").length;
  const lateCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "late").length;
  const onLeaveCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "on_leave").length;
  const absentCount = Math.max(0, dashboardEmployees.length - presentCount - lateCount - onLeaveCount);

  const pendingTasks = tasks.filter((task) => {
    const status = String((task as Record<string, unknown>).status ?? "");
    return status === "pending" || status === "in_progress";
  }).length;
  const pendingLeaves = leaves.filter((req) => {
    const request = req as Record<string, unknown>;
    const isPending = String(request.status ?? "") === "pending";
    if (!isManager) return isPending;
    return isPending && Number(request.current_step || 1) <= 1 && teamEmployeeIds.has(String(request.employee_id || ""));
  }).length;
  
  const firstAttendance = todayRecords.find(r => (r as Record<string, unknown>).employee_id === currentUser?.employeeId);
  const myStatus = typeof firstAttendance?.status === "string" ? firstAttendance.status : "لم يسجل";

  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });
  const chartData = last7Days.map(date => {
    return scopedAttendance.filter(row => (row as Record<string, unknown>).work_date === date).length;
  });

  const nextShift = myShifts.length > 0 ? String(((myShifts[0] as Record<string, unknown>).shift as Record<string, unknown>)?.name || "مخصصة") : "لا يوجد";

  const stats = canViewOrgStats
    ? [
        { label: "الموظفون", value: String(employees.length), icon: Users, change: "الإجمالي النشط" },
        { label: "الحاضرون اليوم", value: String(presentCount), icon: Clock, change: `${lateCount} متأخر، ${absentCount} غائب` },
        { label: "المهام النشطة", value: String(pendingTasks), icon: CheckSquare, change: "قيد التنفيذ" },
        { label: "طلبات إجازة معلقة", value: String(pendingLeaves), icon: ClipboardList, change: "تحتاج مراجعة" },
      ]
    : [
        ...(isManager
          ? [
              { label: "فريقي", value: String(teamEmployees.length), icon: Users, change: "موظفون معينون لك" },
              { label: "حضور الفريق اليوم", value: String(presentCount + lateCount), icon: Clock, change: `${lateCount} متأخر، ${absentCount} غائب` },
              { label: "إجازات تنتظر موافقتك", value: String(pendingLeaves), icon: ClipboardList, change: "مرحلة المدير المباشر" },
            ]
          : []),
        { label: "مهامي", value: String(pendingTasks), icon: CheckSquare, change: "مستحقة قريبًا" },
        ...(!isManager
          ? [
              { label: "الحضور", value: todayRecords.some(r => String((r as Record<string, unknown>).employee_id) === currentUser?.employeeId) ? myStatus : "لم يسجل", icon: Clock, change: "اليوم" },
              { label: "الوردية التالية", value: nextShift, icon: CalendarDays, change: "قادمة" },
              { label: "التنبيهات", value: String(notifications.length), icon: Bell, change: "جديد" },
            ]
          : [{ label: "التنبيهات", value: String(notifications.length), icon: Bell, change: "جديد" }]),
      ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">لوحة التحكم</h1>
        <p className="text-gray-500 mt-1">
          مرحبًا بعودتك، {currentUser?.name}. تم تسجيل دخولك بصلاحية {currentUser?.role}.
        </p>
      </div>

      {isManager && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-none shadow-sm">
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">طلب إجازة</p>
                <p className="mt-1 text-xs text-slate-500">أرسل طلب إجازتك الشخصية وتابع حالة الاعتماد.</p>
              </div>
              <Button asChild className="bg-brand text-white hover:bg-brand-dark">
                <Link href="/leave?view=mine">طلب إجازة</Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">إسناد مهمة للفريق</p>
                <p className="mt-1 text-xs text-slate-500">كلّف موظفاً من فريقك وتابع التنفيذ والملاحظات.</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/tasks">إسناد مهمة</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-gray-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-gray-500 mt-1">
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isHrDashboard && (
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>لوحة الموارد البشرية في المنطقة</CardTitle>
              <CardDescription>
                متابعة المتدربين والموظفين والإجازات وفترة التجربة داخل نطاق HR الحالي.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit border-brand/20 bg-brand-light text-brand-dark">
              <MapPin className="ml-1 h-3.5 w-3.5" />
              {hrScopeLabel}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs text-slate-500">الموظفون الحاليون</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{hrRegionalEmployees.length}</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-4">
                <p className="text-xs text-blue-700">المتدربون الحاليون</p>
                <p className="mt-1 text-2xl font-semibold text-blue-900">{hrTrainees.length}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-4">
                <p className="text-xs text-amber-700">في إجازة اليوم</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">{hrEmployeesOnLeave.length}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-4">
                <p className="text-xs text-emerald-700">فترة التجربة 180 يوم</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-900">{hrProbationEmployees.length}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">الموظفون حسب المسمى الوظيفي</h3>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/employees">الموظفون</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  {hrJobTitleSummary.slice(0, 8).map(([title, count]) => (
                    <div key={title} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                      <span className="truncate text-slate-700">{title}</span>
                      <span className="font-semibold text-slate-950">{count}</span>
                    </div>
                  ))}
                  {hrJobTitleSummary.length === 0 && (
                    <p className="py-6 text-center text-sm text-slate-500">لا توجد بيانات موظفين في هذا النطاق.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">الموظفون في إجازة اليوم</h3>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/leave">الإجازات</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  {hrEmployeesOnLeave.slice(0, 8).map(({ employee, leave }) => (
                    <Link
                      key={`${String(leave.id || "")}-${String(employee.id || "")}`}
                      href={`/employees/${String(employee.id || "")}`}
                      className="block rounded-md bg-amber-50 px-3 py-2 transition-colors hover:bg-amber-100"
                    >
                      <p className="font-medium text-slate-950">{getEmployeeName(employee)}</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {getText(employee.job_title, "بدون مسمى")} · {getText(leave.start_date, "-")} إلى {getText(leave.end_date, "-")}
                      </p>
                    </Link>
                  ))}
                  {hrEmployeesOnLeave.length === 0 && (
                    <p className="py-6 text-center text-sm text-slate-500">لا يوجد موظفون في إجازة اليوم.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">داخل فترة التجربة</h3>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                    180 يوم
                  </Badge>
                </div>
                <div className="space-y-2">
                  {hrProbationEmployees.slice(0, 8).map(({ employee, days }) => (
                    <Link
                      key={String(employee.id || "")}
                      href={`/employees/${String(employee.id || "")}`}
                      className="block rounded-md bg-emerald-50 px-3 py-2 transition-colors hover:bg-emerald-100"
                    >
                      <p className="font-medium text-slate-950">{getEmployeeName(employee)}</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        {getText(employee.job_title, "بدون مسمى")} · مضى {days} يوم · المتبقي {Math.max(0, 180 - days)} يوم
                      </p>
                    </Link>
                  ))}
                  {hrProbationEmployees.length === 0 && (
                    <p className="py-6 text-center text-sm text-slate-500">لا يوجد موظفون داخل فترة التجربة في هذا النطاق.</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isManager && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>فريقي</CardTitle>
              <CardDescription>الموظفون الذين تم تعيينك كمدير مباشر لهم من HR.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/employees">عرض الموظفين</Link>
              </Button>
              <Button asChild className="bg-brand text-white hover:bg-brand-dark" size="sm">
                <Link href="/leave">مراجعة الإجازات</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {teamEmployees.slice(0, 6).map((employee) => {
                const record = employee as Record<string, unknown>;
                const employeeId = String(record.id || "");
                const name = String(record.full_name || "موظف");
                const title = String(record.job_title || "بدون مسمى");
                const location = (record.location ?? null) as Record<string, unknown> | null;
                const locationName = typeof location?.name === "string" ? location.name : "بدون موقع";

                return (
                  <Link
                    key={employeeId}
                    href={`/employees/${employeeId}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition-colors hover:border-brand/40 hover:bg-brand-light/40"
                  >
                    <p className="font-medium text-slate-950">{name}</p>
                    <p className="mt-1 text-xs text-slate-500">{title}</p>
                    <p className="mt-2 text-xs text-slate-400">{locationName}</p>
                  </Link>
                );
              })}
            </div>
            {teamEmployees.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                لا يوجد موظفون معينون لك حتى الآن. HR يمكنه تعيين المدير المباشر من ملف الموظف.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>حضور اليوم</CardTitle>
            <CardDescription>تسجيلات حضور مباشرة وحالة التواجد عبر الورديات.</CardDescription>
          </CardHeader>
          <CardContent className="border-t border-dashed pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">حالة حضور اليوم</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-base font-semibold" dir="rtl">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    <span>{presentCount}</span>
                    <span>حاضر</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-amber-700">
                    <span>{lateCount}</span>
                    <span>متأخر</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-rose-700">
                    <span>{absentCount}</span>
                    <span>غائب</span>
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{todayRecords.length} تم تسجيله اليوم</Badge>
            </div>
            <div className="mt-6">
              <MiniLineChart values={chartData.length ? chartData : [0, 0, 0, 0, 0, 0, 0]} />
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>آخر الإشعارات</CardTitle>
            <CardDescription>أحدث التنبيهات التي تحتاج متابعة.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {notifications.slice(0, 3).map((note) => {
                const noteRecord = note as Record<string, unknown>;
                const noteId = String(noteRecord.id ?? "");
                const noteTitle = typeof noteRecord.title === "string" ? noteRecord.title : "إشعار";
                const noteBody = typeof noteRecord.body === "string" ? noteRecord.body : "عرض التفاصيل";
                return (
                  <div key={noteId} className="flex items-center gap-4 p-3 border rounded-lg bg-slate-50 border-slate-100">
                    <div className="bg-brand-light p-2 rounded-full">
                      <Bell className="w-4 h-4 text-brand" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{noteTitle}</p>
                      <p className="text-xs text-gray-500">{noteBody}</p>
                    </div>
                  </div>
                );
              })}

              {notifications.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">لا توجد إشعارات حتى الآن.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
