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
  CalendarDays
} from "lucide-react";

function getEmployeeFromRow(row: Record<string, unknown>) {
  return (row.employee ?? null) as Record<string, unknown> | null;
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
    ? employees.filter((employee) => String((employee as Record<string, unknown>).manager_id || "") === currentUser?.employeeId)
    : [];
  const dashboardEmployees = isManager ? teamEmployees : employees;
  const teamEmployeeIds = new Set(teamEmployees.map((employee) => String((employee as Record<string, unknown>).id || "")));

  const scopedAttendance = isManager
    ? allAttendance.filter((row) => {
        const employee = getEmployeeFromRow(row as Record<string, unknown>);
        return String(employee?.manager_id || "") === currentUser?.employeeId;
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
                <p className="text-xs text-gray-500">حاضر / متأخر / غائب</p>
                <p className="text-lg font-semibold text-gray-900">{presentCount} present · {lateCount} late · {absentCount} absent</p>
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
