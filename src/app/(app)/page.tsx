"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
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
    if (currentUser?.role === "HR_Recruitment") {
      router.replace("/recruitment");
    }
  }, [currentUser?.role, router]);

  if (currentUser?.role === "HR_Recruitment") {
    return null;
  }

  const canViewOrgStats = ["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "");

  const todayRecords = allAttendance.filter(row => (row as Record<string, unknown>).work_date === today);
  const presentCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "present").length;
  const lateCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "late").length;
  const onLeaveCount = todayRecords.filter((row) => String((row as Record<string, unknown>).status ?? "") === "on_leave").length;
  const absentCount = Math.max(0, employees.length - presentCount - lateCount - onLeaveCount);

  const pendingTasks = tasks.filter((task) => {
    const status = String((task as Record<string, unknown>).status ?? "");
    return status === "pending" || status === "in_progress";
  }).length;
  const pendingLeaves = leaves.filter((req) => String((req as Record<string, unknown>).status ?? "") === "pending").length;
  
  const firstAttendance = todayRecords.find(r => (r as Record<string, unknown>).employee_id === currentUser?.employeeId);
  const myStatus = typeof firstAttendance?.status === "string" ? firstAttendance.status : "لم يسجل";

  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });
  const chartData = last7Days.map(date => {
    return allAttendance.filter(row => (row as Record<string, unknown>).work_date === date).length;
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
        { label: "مهامي", value: String(pendingTasks), icon: CheckSquare, change: "مستحقة قريبًا" },
        { label: "الحضور", value: todayRecords.some(r => String((r as Record<string, unknown>).employee_id) === currentUser?.employeeId) ? myStatus : "لم يسجل", icon: Clock, change: "اليوم" },
        { label: "الوردية التالية", value: nextShift, icon: CalendarDays, change: "قادمة" },
        { label: "التنبيهات", value: String(notifications.length), icon: Bell, change: "جديد" },
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
