"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSkeleton } from "@/components/Skeletons";

type PlatformUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  organization_id: string;
  organization_name: string;
  status: string;
  created_at: string;
  last_login_at: string;
};

const roleLabels: Record<string, string> = {
  admin: "مسؤول منظمة",
  hr_admin: "مدير الموارد البشرية",
  hr_recruitment: "مسؤول التوظيف",
  onground_agent_manager: "مدير المندوبين الميدانيين",
  inventory_receiver: "مستلم مخزون المنتجات",
  promoter: "مروج مبيعات",
  finance_manager: "مدير المالية",
  accountant: "محاسب",
  finance_viewer: "مشاهد المالية",
  sales: "مبيعات",
  sales_manager: "مدير المبيعات",
  training_manager: "مدير تدريب",
  employee: "موظف",
  supervisor: "مشرف مواقع",
  super_admin: "مشرف عام",
};

function downloadCsv(rows: PlatformUser[]) {
  const headers = ["name", "email", "role", "organization", "status", "created_at", "last_login_at"];
  const csv = [
    headers.join(","),
    ...rows.map((row) => [
      row.name,
      row.email,
      roleLabels[row.role] || row.role,
      row.organization_name,
      row.status,
      row.created_at,
      row.last_login_at,
    ].map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "platform-users.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function SuperadminUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [organization, setOrganization] = useState("all");

  useEffect(() => {
    fetch("/api/superadmin/users")
      .then((response) => response.json())
      .then((data) => setUsers(Array.isArray(data.users) ? data.users : []))
      .finally(() => setLoading(false));
  }, []);

  const organizations = useMemo(() => Array.from(new Set(users.map((user) => user.organization_name).filter(Boolean))), [users]);
  const roles = useMemo(() => Array.from(new Set(users.map((user) => user.role).filter(Boolean))), [users]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !term || user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term);
      const matchesRole = role === "all" || user.role === role;
      const matchesStatus = status === "all" || user.status.toLowerCase() === status;
      const matchesOrg = organization === "all" || user.organization_name === organization;
      return matchesSearch && matchesRole && matchesStatus && matchesOrg;
    });
  }, [organization, role, search, status, users]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">اليوزرات</h1>
          <p className="mt-1 text-sm text-gray-500">سجل حسابات المستخدمين في كل المنظمات.</p>
        </div>
        <Button variant="outline" onClick={() => downloadCsv(filtered)}>
          <Download className="ml-2 h-4 w-4" />
          تصدير CSV
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>كل الحسابات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الإيميل" className="pr-9" />
            </div>
            <Select value={organization} onValueChange={(value) => setOrganization(value || "all")}>
              <SelectTrigger><SelectValue placeholder="المنظمة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المنظمات</SelectItem>
                {organizations.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={(value) => setRole(value || "all")}>
              <SelectTrigger><SelectValue placeholder="الدور" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                {roles.map((item) => <SelectItem key={item} value={item}>{roleLabels[item] || item}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value || "all")}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="suspended">موقوف</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الإيميل</TableHead>
                  <TableHead>الدور</TableHead>
                  <TableHead>المنظمة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  <TableHead>آخر دخول</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((user) => (
                  <TableRow key={`${user.id}-${user.organization_id}`}>
                    <TableCell className="font-medium">{user.name || "—"}</TableCell>
                    <TableCell>{user.email || "—"}</TableCell>
                    <TableCell>{roleLabels[user.role] || user.role || "—"}</TableCell>
                    <TableCell>{user.organization_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={user.status.toLowerCase() === "active" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}>
                        {user.status || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.created_at ? new Date(user.created_at).toLocaleDateString("ar-SA") : "—"}</TableCell>
                    <TableCell>{user.last_login_at ? new Date(user.last_login_at).toLocaleString("ar-SA") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
