"use client";

import React from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniLineChart } from "@/components/charts/MiniLineChart";
import {
  Users,
  MapPin,
  Clock,
  TrendingUp,
  AlertTriangle
} from "lucide-react";

export default function DashboardPage() {
  const { currentUser } = useRoleContext();

  // Mock data for the dashboard
  const stats = [
    { label: "Active Employees", value: "248", icon: Users, change: "+12%" },
    { label: "Check-ins Today", value: "194", icon: Clock, change: "92% Attendance" },
    { label: "Active Sites", value: "12", icon: MapPin, change: "All operational" },
    { label: "Overall KPI", value: "94%", icon: TrendingUp, change: "+2.4%" },
  ];

  const recentAnomalies = [
    { id: 1, employee: "Tariq Ali", issue: "Late Check-in (45m)", location: "Site A - Downtown", severity: "medium" },
    { id: 2, employee: "Sara Ahmed", issue: "Missed Check-out", location: "Site B - East Mall", severity: "high" },
  ];

  const scheduleSeries = [62, 68, 70, 74, 72, 76, 78];

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
            <CardTitle>Schedule Utilization</CardTitle>
            <CardDescription>
              Hours scheduled vs actual checks-ins over the week.
            </CardDescription>
          </CardHeader>
          <CardContent className="border-t border-dashed bg-white m-4 rounded">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Scheduled vs Actual</p>
                <p className="text-lg font-semibold text-gray-900">76% utilization</p>
              </div>
              <Badge className="bg-brand-light text-brand-dark border-brand/20">+4.2% WoW</Badge>
            </div>
            <div className="mt-6">
              <MiniLineChart values={scheduleSeries} />
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Anomaly Detection (AI)</CardTitle>
            <CardDescription>
              Actionable flags from today's active shifts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentAnomalies.map((anomaly) => (
                <div key={anomaly.id} className="flex items-center gap-4 p-3 border rounded-lg bg-red-50/30 border-red-100">
                  <div className="bg-red-100 p-2 rounded-full">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">{anomaly.employee}</p>
                    <p className="text-xs text-gray-500">{anomaly.issue} &middot; {anomaly.location}</p>
                  </div>
                  <Badge className="bg-red-500 hover:bg-red-600 text-white border-transparent">
                    {anomaly.severity === "high" ? "Urgent" : "Review"}
                  </Badge>
                </div>
              ))}

              {recentAnomalies.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No anomalies detected.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
