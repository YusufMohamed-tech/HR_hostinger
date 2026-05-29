"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/Skeletons";
import {
  getSuperadminOrganizations,
  type SuperadminOrganization,
} from "@/lib/services/superadmin-organizations";

const isActiveStatus = (status: string) => status.trim().toLowerCase() === "active";

export default function SuperadminDashboardPage() {
  const [organizations, setOrganizations] = useState<SuperadminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrganizations() {
      setLoading(true);
      const result = await getSuperadminOrganizations();
      if (result.error) {
        setError(result.error.message);
        setOrganizations([]);
      } else {
        setError(null);
        setOrganizations(result.data || []);
      }
      setLoading(false);
    }

    loadOrganizations();
  }, []);

  const stats = useMemo(() => {
    const activeOrganizations = organizations.filter((organization) => isActiveStatus(organization.status)).length;
    const memberCount = organizations.reduce((sum, organization) => sum + organization.memberCount, 0);
    const hrTeamCount = organizations.reduce(
      (sum, organization) => sum + organization.hrAdminCount + organization.hrRecruitmentCount,
      0
    );
    const employeeCount = organizations.reduce((sum, organization) => sum + organization.employeeCount, 0);

    return [
      { label: "المنظمات", value: String(organizations.length), icon: Building2, hint: "كل الجهات المسجلة" },
      { label: "المنظمات النشطة", value: String(activeOrganizations), icon: ShieldCheck, hint: "جاهزة للعمل" },
      { label: "فريق HR", value: String(hrTeamCount), icon: UserCog, hint: "مسؤولو الموارد والتوظيف" },
      { label: "الموظفون", value: String(employeeCount), icon: Users, hint: `${memberCount} عضوًا إجماليًا` },
    ];
  }, [organizations]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">لوحة المنصة</h1>
          <p className="mt-1 text-sm text-gray-500">
            فصل إدارة المنصة عن بيئة الموارد البشرية، والبدء من مركز تحكم موحد للجهات والمستخدمين.
          </p>
        </div>
        <Button asChild className="bg-brand text-white hover:bg-brand-dark">
          <Link href="/superadmin/organizations">إدارة المنظمات</Link>
        </Button>
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
                <p className="mt-1 text-xs text-slate-500">{stat.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>أحدث المنظمات</CardTitle>
            <CardDescription>قائمة سريعة لأحدث الجهات المسجلة وما إذا كانت جاهزة للتشغيل.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {organizations.slice(0, 5).map((organization) => (
              <div
                key={organization.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3"
              >
                <div className="space-y-1">
                  <p className="font-medium text-slate-950">{organization.name}</p>
                  <p className="text-xs text-slate-500">
                    {organization.memberCount} عضو · {organization.employeeCount} موظف · {organization.slug || "بدون slug"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={isActiveStatus(organization.status)
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"}
                >
                  {organization.status}
                </Badge>
              </div>
            ))}

            {organizations.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                لا توجد منظمات مسجلة حتى الآن. ابدأ بإنشاء أول جهة من صفحة إدارة المنظمات.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>نموذج الفصل الجديد</CardTitle>
            <CardDescription>هذا السطح الجديد هو بداية فصل المنصة عن واجهة الموارد البشرية الحالية.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">المنصة</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                إدارة الجهات، التحكم في التفعيل، ومتابعة مستخدمي HR من منظور مركزي.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">بيئة العمل</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                تبقى صفحات الموارد البشرية والعمليات داخل مساحة عمل المنظمة، وليست لوحة المشرف العام.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}