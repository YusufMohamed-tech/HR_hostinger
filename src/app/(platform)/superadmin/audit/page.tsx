"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Activity, Building2, Clock, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/Skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSuperadminAuditLogs,
  type SuperadminAuditLog,
} from "@/lib/services/superadmin-organizations";

const actionLabels: Record<string, string> = {
  "organization.created": "إنشاء منظمة",
  "organization.updated": "تحديث منظمة",
  "organization.suspended": "إيقاف منظمة",
  "organization.activated": "تفعيل منظمة",
  "organization_user.created": "إنشاء مستخدم منظمة",
  "organization_user.updated": "تحديث مستخدم منظمة",
  "organization_user.suspended": "إيقاف مستخدم",
  "organization_user.activated": "تفعيل مستخدم",
  "organization_user.password_reset": "إعادة تعيين كلمة مرور",
  "leave_request.approved": "اعتماد طلب إجازة",
  "leave_request.rejected": "رفض طلب إجازة",
  "platform_task.created": "إسناد مهمة",
};

export default function SuperadminAuditPage() {
  const [logs, setLogs] = useState<SuperadminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      const result = await getSuperadminAuditLogs(100);
      if (result.error) {
        setError(result.error.message);
        setLogs([]);
      } else {
        setError("");
        setLogs(result.data || []);
      }
      setLoading(false);
    }

    loadLogs();
  }, []);

  const stats = useMemo(() => {
    const organizationActions = logs.filter((log) => log.target_type === "organization").length;
    const userActions = logs.filter((log) => log.target_type === "org_member").length;
    const uniqueActors = new Set(logs.map((log) => log.actor_user_id).filter(Boolean)).size;

    return [
      { label: "إجمالي الأحداث", value: logs.length, icon: Activity },
      { label: "أحداث المنظمات", value: organizationActions, icon: Building2 },
      { label: "أحداث المستخدمين", value: userActions, icon: Shield },
      { label: "منفذو العمليات", value: uniqueActors, icon: Clock },
    ];
  }, [logs]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">سجل تدقيق المنصة</h1>
        <p className="mt-1 text-sm text-slate-500">
          متابعة عمليات المشرف العام على المنظمات والمستخدمين من مكان واحد.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-none shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">{stat.label}</CardTitle>
                <Icon className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-950">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>آخر العمليات</CardTitle>
          <CardDescription>أحدث 100 عملية مسجلة في مركز تحكم المنصة.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">العملية</TableHead>
                <TableHead className="font-semibold text-gray-600">المنفذ</TableHead>
                <TableHead className="font-semibold text-gray-600">المنظمة</TableHead>
                <TableHead className="font-semibold text-gray-600">الهدف</TableHead>
                <TableHead className="font-semibold text-gray-600">الوقت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                      {actionLabels[log.action] || log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">{log.actor_profile?.full_name || "مشرف عام"}</span>
                      <span className="text-xs text-slate-500">{log.actor_profile?.email || log.actor_user_id || "-"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">{log.target_organization?.name || "-"}</span>
                      <span className="text-xs text-slate-500">{log.target_organization?.slug || log.target_org_id || ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600">{formatTarget(log)}</TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(log.created_at).toLocaleString("en-CA")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-900">لا توجد عمليات مسجلة بعد</p>
              <p className="mt-1 text-xs text-gray-500">ستظهر هنا عمليات إنشاء وتحديث المنظمات والمستخدمين.</p>
            </div>
          )}

          {error && <div className="border-t px-4 py-3 text-sm text-red-600">{error}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function formatTarget(log: SuperadminAuditLog) {
  const metadata = log.metadata || {};
  if (typeof metadata.email === "string") return metadata.email;
  if (typeof metadata.name === "string") return metadata.name;
  return log.target_id || "-";
}
