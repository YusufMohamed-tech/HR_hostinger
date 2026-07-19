"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, Search, ShieldCheck, UserRound, UserX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSkeleton } from "@/components/Skeletons";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  createFinanceTeamMember,
  getFinanceTeam,
  updateFinanceTeamMember,
  type FinanceTeamMember,
  type FinanceTeamRole,
} from "@/lib/services/accounting-team";
import { cn } from "@/lib/utils";

const roleOptions: Array<{
  value: FinanceTeamRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "finance_manager",
    label: "مدير المالية",
    description: "صلاحية كاملة لإدارة وحدة المالية والمحاسبة، الترحيل، الإعدادات، والتقارير.",
    icon: ShieldCheck,
  },
  {
    value: "accountant",
    label: "محاسب",
    description: "إنشاء وإدارة المسودات والعمليات اليومية دون صلاحية الترحيل أو الإعدادات الحساسة.",
    icon: Users,
  },
  {
    value: "finance_viewer",
    label: "مشاهد المالية",
    description: "عرض التقارير والبيانات المالية فقط دون تعديل.",
    icon: Eye,
  },
];

const roleLabels = Object.fromEntries(roleOptions.map((option) => [option.value, option.label]));

function roleBadgeClass(role: string) {
  if (role === "finance_manager") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (role === "accountant") return "border-teal-200 bg-teal-50 text-teal-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "border-green-200 bg-green-50 text-green-700";
  if (normalized === "suspended") return "border-red-200 bg-red-50 text-red-700";
  return "border-gray-200 bg-gray-100 text-gray-600";
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "نشط";
  if (normalized === "suspended") return "موقوف";
  return "غير نشط";
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

export default function AccountingTeamPage() {
  const { currentUser } = useRoleContext();
  const [members, setMembers] = useState<FinanceTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const canManage = ["Admin", "HR_Admin", "Superadmin"].includes(currentUser?.role || "");

  const load = async () => {
    setLoading(true);
    const result = await getFinanceTeam();
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر تحميل فريق المالية.");
    } else {
      setMembers(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredMembers = useMemo(() => {
    const term = normalizeSearch(search);
    if (!term) return members;
    return members.filter((member) => {
      const haystack = [
        member.full_name,
        member.email,
        member.role,
        roleLabels[member.role],
        member.phone || "",
        member.job_title || "",
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [members, search]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">فريق المالية</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            إدارة مستخدمي وحدة المالية والمحاسبة وتحديد صلاحياتهم داخل المؤسسة دون منح الموارد البشرية صلاحيات محاسبية تشغيلية.
          </p>
        </div>
        {canManage && <FinanceMemberDialog onDone={load} onMessage={setMessage} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {roleOptions.map((option) => {
          const Icon = option.icon;
          const count = members.filter((member) => member.role === option.value).length;
          return (
            <div key={option.value} className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-gray-950">{option.label}</p>
                    <Badge variant="outline" className={roleBadgeClass(option.value)}>{count}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-500">{option.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative md:w-96">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="بحث بالاسم أو البريد أو الدور"
                className="pr-9"
              />
            </div>
            <Badge variant="outline" className="w-fit bg-white text-gray-700">
              {filteredMembers.length} عضو
            </Badge>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-100">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/70">
                  <TableHead>المستخدم</TableHead>
                  <TableHead>الدور المالي</TableHead>
                  <TableHead>المسمى</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الإضافة</TableHead>
                  <TableHead className="text-left">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => {
                  const active = member.status.toLowerCase() === "active";
                  return (
                    <TableRow key={member.user_id}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-gray-950">{member.full_name}</p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                          {member.phone && <p className="mt-0.5 text-xs text-gray-400">{member.phone}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={roleBadgeClass(member.role)}>
                          {roleLabels[member.role] || member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{member.job_title || member.title || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(member.status)}>
                          {statusLabel(member.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{member.created_at ? new Date(member.created_at).toLocaleDateString("ar-SA") : "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {canManage ? (
                            <>
                              <FinanceMemberDialog member={member} onDone={load} onMessage={setMessage} />
                              {active && <ConfirmActionButton
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:bg-red-50"
                                title="إنهاء خدمة عضو مالي"
                                description="سيتم إيقاف الوصول وإغلاق التكليفات مع الاحتفاظ بالسجل التاريخي. يجب تسوية العهد والسلف أولاً."
                                confirmLabel="إنهاء الخدمة"
                                destructive
                                onConfirm={async () => {
                                  const result = await updateFinanceTeamMember({
                                    user_id: member.user_id,
                                    expected_version: member.lifecycle_version,
                                    status: "inactive",
                                  });
                                  if (result.error) setMessage(result.error);
                                  else load();
                                }}
                              >
                                <UserX className="h-4 w-4" />
                              </ConfirmActionButton>}
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">عرض فقط</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {filteredMembers.length === 0 && (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <UserRound className="mb-3 h-10 w-10 text-gray-300" />
                <p className="font-medium text-gray-900">لا يوجد أعضاء في فريق المالية بعد</p>
                <p className="mt-1 max-w-md text-sm text-gray-500">
                  أضف مدير مالية أو محاسب أو مشاهد مالية لتفعيل الوصول المنضبط إلى وحدة المالية والمحاسبة.
                </p>
                {canManage && <div className="mt-4"><FinanceMemberDialog onDone={load} onMessage={setMessage} compact /></div>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FinanceMemberDialog({
  member,
  onDone,
  onMessage,
  compact = false,
}: {
  member?: FinanceTeamMember;
  onDone: () => void;
  onMessage: (message: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    full_name: string;
    email: string;
    phone: string;
    role: FinanceTeamRole;
  }>({
    full_name: "",
    email: "",
    phone: "",
    role: "accountant",
  });

  useEffect(() => {
    if (!open) return;
    setForm(member ? {
      full_name: member.full_name || "",
      email: member.email || "",
      phone: member.phone || "",
      role: member.role,
    } : {
      full_name: "",
      email: "",
      phone: "",
      role: "accountant",
    });
  }, [member, open]);

  const selectedRole = roleOptions.find((option) => option.value === form.role) || roleOptions[1];
  const SelectedRoleIcon = selectedRole.icon;

  const save = async () => {
    if (form.full_name.trim().length < 2) {
      onMessage("اسم المستخدم مطلوب.");
      return;
    }
    if (!member && !form.email.includes("@")) {
      onMessage("البريد الإلكتروني الصحيح مطلوب لإرسال دعوة الدخول.");
      return;
    }

    setSaving(true);
    const result = member
      ? await updateFinanceTeamMember({
          user_id: member.user_id,
          expected_version: member.lifecycle_version,
          full_name: form.full_name,
          phone: form.phone,
          role: form.role,
        })
      : await createFinanceTeamMember({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role: form.role,
        });
    setSaving(false);

    if (result.error) {
      onMessage(result.error);
      return;
    }
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={member ? "ghost" : "default"}
            size={member ? "sm" : "default"}
            className={cn(member ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark")}
          />
        }
      >
        {member ? (
          <Pencil className="h-4 w-4" />
        ) : compact ? (
          "إضافة عضو مالي"
        ) : (
          <>
            <Plus className="ml-2 h-4 w-4" />
            إضافة عضو مالي
          </>
        )}
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{member ? "تعديل عضو مالي" : "إضافة عضو مالي"}</DialogTitle>
          <DialogDescription>
            أدوار المالية تمنح المستخدم صلاحيات داخل وحدة المالية والمحاسبة حسب مستوى الدور.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>الدور المالي *</Label>
              <Select value={form.role} onValueChange={(value) => setForm((prev) => ({ ...prev, role: value as FinanceTeamRole }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الاسم *</Label>
              <Input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>البريد الإلكتروني *</Label>
              <Input
                type="email"
                disabled={Boolean(member)}
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                dir="ltr"
              />
            </div>
            {!member && <p className="self-end pb-2 text-xs text-gray-500">سيصل للمستخدم رابط دعوة آمن لاختيار كلمة المرور.</p>}
            <div className="space-y-2">
              <Label>الجوال</Label>
              <Input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} dir="ltr" />
            </div>
          </div>

          <div className={cn("rounded-lg border p-4", roleBadgeClass(form.role))}>
            <div className="flex items-start gap-3">
              <SelectedRoleIcon className="mt-0.5 h-5 w-5" />
              <div>
                <p className="font-semibold">{selectedRole.label}</p>
                <p className="mt-1 text-sm leading-6">{selectedRole.description}</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save} disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
