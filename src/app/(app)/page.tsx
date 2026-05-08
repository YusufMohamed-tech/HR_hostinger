"use client";

import React from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniLineChart } from "@/components/charts/MiniLineChart";
import { useEmployees, useLocations, useAttendance, useTasks, useLeaveRequests, useNotifications } from "@/hooks/use-data";
import {
  Users,
  MapPin,
  Clock,
  ClipboardList,
  CheckSquare,
  Bell
} from "lucide-react";

export default function DashboardPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();
  const today = new Date().toISOString().split("T")[0];
  const { data: attendance } = useAttendance(today);
  const { data: tasks } = useTasks();
  const { data: leaves } = useLeaveRequests();
  const { data: notifications } = useNotifications();

  const isAdmin = currentUser?.role === "Admin";

  const presentCount = attendance.filter((row) => row.status === "present").length;
  const lateCount = attendance.filter((row) => row.status === "late").length;
  const pendingTasks = tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
  const pendingLeaves = leaves.filter((req) => req.status === "pending").length;
  const firstAttendance = attendance[0] as Record<string, unknown> | undefined;
  const myStatus = typeof firstAttendance?.status === "string" ? firstAttendance.status : "Not checked";

  const stats = isAdmin
    ? [
        { label: "Employees", value: String(employees.length), icon: Users, change: "Total active" },
        { label: "Present Today", value: String(presentCount), icon: Clock, change: `${lateCount} late` },
        { label: "Active Tasks", value: String(pendingTasks), icon: CheckSquare, change: "In progress" },
        { label: "Pending Leave", value: String(pendingLeaves), icon: ClipboardList, change: "Needs review" },
      ]
    : [
        { label: "My Tasks", value: String(pendingTasks), icon: CheckSquare, change: "Due soon" },
        { label: "Attendance", value: attendance.length ? myStatus : "Not checked", icon: Clock, change: "Today" },
        { label: "Locations", value: String(locations.length), icon: MapPin, change: "Assigned" },
        { label: "Alerts", value: String(notifications.length), icon: Bell, change: "New" },
      ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, {currentUser?.name}. You are logged in as {currentUser?.role}.
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
            <CardTitle>Today&apos;s Attendance</CardTitle>
            <CardDescription>Live check-ins and presence status across shifts.</CardDescription>
          </CardHeader>
          <CardContent className="border-t border-dashed pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Present / Late</p>
                <p className="text-lg font-semibold text-gray-900">{presentCount} present · {lateCount} late</p>
              </div>
              <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{attendance.length} total</Badge>
            </div>
            <div className="mt-6">
              <MiniLineChart values={[10, 18, 22, 30, 28, 35, 40]} />
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Recent Notifications</CardTitle>
            <CardDescription>Latest alerts that need attention.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {notifications.slice(0, 3).map((note) => (
                <div key={note.id} className="flex items-center gap-4 p-3 border rounded-lg bg-slate-50 border-slate-100">
                  <div className="bg-brand-light p-2 rounded-full">
                    <Bell className="w-4 h-4 text-brand" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">{note.title}</p>
                    <p className="text-xs text-gray-500">{note.body || "View details"}</p>
                  </div>
                </div>
              ))}

              {notifications.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No notifications yet.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
