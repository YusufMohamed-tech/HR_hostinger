"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Mail, Shield, User, KeyRound, Building2 } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SuperadminSettingsPage() {
  const router = useRouter();
  const { currentUser, logout } = useRoleContext();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (!currentUser) {
    return null;
  }

  const profileItems = [
    { label: "الاسم", value: currentUser.name, icon: User },
    { label: "البريد الإلكتروني", value: currentUser.email, icon: Mail },
    { label: "الدور", value: currentUser.role, icon: Shield },
    { label: "رقم المستخدم", value: currentUser.id, icon: KeyRound },
    { label: "معرف المنظمة القديم", value: currentUser.orgId || "غير مرتبط", icon: Building2 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">إعدادات المنصة</h1>
          <p className="mt-1 text-sm text-slate-500">
            بيانات حساب المشرف العام وإدارة الجلسة بعيدًا عن إعدادات مساحة الموارد البشرية.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-slate-200 bg-white px-3 py-1 text-slate-700">
          Superadmin
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>ملف الحساب</CardTitle>
            <CardDescription>هذه البيانات تخص حساب المنصة المركزي، وليست ملف موظف داخل منظمة.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {profileItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </div>
                    <p className="mt-2 break-all text-sm font-semibold text-slate-950">{item.value}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>أمان الجلسة</CardTitle>
            <CardDescription>الخروج ينهي جلسة المشرف العام ويعيدك إلى صفحة تسجيل الدخول.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              المرحلة الحالية ما زالت تستخدم ربطًا قديمًا عبر المنظمة. الخطوة التالية ستنقل المشرف العام إلى جدول منصة مستقل.
            </div>
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={handleLogout}
            >
              <LogOut className="ml-2 h-4 w-4" />
              تسجيل الخروج
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
