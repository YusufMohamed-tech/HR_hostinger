"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, KeyRound, Mail, Plus, Power, Shield, UserCog, Users } from "lucide-react";
import { createManagedUser, updateManagedUser, type ManagedOrgRole } from "@/lib/services/admin-users";
import {
  getSuperadminOrganization,
  updateSuperadminOrganization,
  type SuperadminOrganization,
  type SuperadminOrganizationDetail,
  type SuperadminOrganizationMember,
} from "@/lib/services/superadmin-organizations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/Skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roleLabels: Record<string, string> = {
  admin: "مسؤول منظمة",
  hr_admin: "مدير الموارد البشرية",
  hr_recruitment: "مسؤول التوظيف",
  onground_agent_manager: "مدير المندوبين الميدانيين",
  promoter: "مروج مبيعات",
  finance_manager: "مدير المالية",
  accountant: "محاسب",
  finance_viewer: "مشاهد المالية",
  sales: "مبيعات",
  sales_manager: "مدير المبيعات",
  training_manager: "مدير تدريب",
  employee: "موظف",
  super_admin: "مشرف عام",
};

const roleBadgeClasses: Record<string, string> = {
  admin: "border-blue-200 bg-blue-50 text-blue-700",
  hr_admin: "border-indigo-200 bg-indigo-50 text-indigo-700",
  hr_recruitment: "border-purple-200 bg-purple-50 text-purple-700",
  onground_agent_manager: "border-orange-200 bg-orange-50 text-orange-700",
  promoter: "border-cyan-200 bg-cyan-50 text-cyan-700",
  finance_manager: "border-emerald-200 bg-emerald-50 text-emerald-700",
  accountant: "border-teal-200 bg-teal-50 text-teal-700",
  finance_viewer: "border-slate-200 bg-slate-50 text-slate-700",
  sales: "border-cyan-200 bg-cyan-50 text-cyan-700",
  sales_manager: "border-sky-200 bg-sky-50 text-sky-700",
  training_manager: "border-amber-200 bg-amber-50 text-amber-700",
  employee: "border-emerald-200 bg-emerald-50 text-emerald-700",
  super_admin: "border-slate-200 bg-slate-900 text-white",
};

const managedRoleOptions: Array<{ value: ManagedOrgRole; label: string }> = [
  { value: "admin", label: "مسؤول منظمة" },
  { value: "hr_admin", label: "مدير الموارد البشرية" },
  { value: "hr_recruitment", label: "مسؤول التوظيف" },
  { value: "onground_agent_manager", label: "مدير المندوبين الميدانيين" },
  { value: "promoter", label: "مروج مبيعات" },
  { value: "finance_manager", label: "مدير المالية" },
  { value: "accountant", label: "محاسب" },
  { value: "finance_viewer", label: "مشاهد المالية" },
];

export default function SuperadminOrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = Array.isArray(params.orgId) ? params.orgId[0] : params.orgId;
  const [detail, setDetail] = useState<SuperadminOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrganization = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const result = await getSuperadminOrganization(orgId);
    if (result.error) {
      setError(result.error.message);
      setDetail(null);
    } else {
      setError("");
      setDetail(result.data);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadOrganization();
  }, [loadOrganization]);

  const stats = useMemo(() => {
    const counts = detail?.counts;
    return [
      { label: "الأعضاء", value: counts?.memberCount ?? 0, icon: Users },
      { label: "الموظفون", value: counts?.employeeCount ?? 0, icon: Building2 },
      { label: "HR Admin", value: counts?.hrAdminCount ?? 0, icon: Shield },
      { label: "Recruiters", value: counts?.hrRecruitmentCount ?? 0, icon: UserCog },
    ];
  }, [detail]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!detail) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-red-600">{error || "تعذر تحميل المنظمة."}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/superadmin/organizations">العودة إلى المنظمات</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { organization, members } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" className="mb-2 px-0 text-slate-500 hover:bg-transparent hover:text-slate-900">
            <Link href="/superadmin/organizations">
              <ArrowRight className="ml-2 h-4 w-4" />
              العودة إلى المنظمات
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{organization.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            إدارة المنظمة، مستخدمي HR، وصلاحيات الدخول الخاصة بها من مركز تحكم المشرف العام.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrganizationStatusButton organization={organization} onSuccess={loadOrganization} />
          <CreateOrgUserDialog orgId={organization.id} onSuccess={loadOrganization} />
        </div>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>مستخدمو المنظمة</CardTitle>
            <CardDescription>إنشاء ومراجعة حسابات الإدارة والموارد البشرية والمالية داخل هذه المنظمة.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-600">المستخدم</TableHead>
                  <TableHead className="font-semibold text-gray-600">البريد</TableHead>
                  <TableHead className="font-semibold text-gray-600">الدور</TableHead>
                  <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                  <TableHead className="font-semibold text-gray-600">تاريخ الإضافة</TableHead>
                  <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <MemberRow key={member.id || member.user_id} member={member} orgId={organization.id} onSuccess={loadOrganization} />
                ))}
              </TableBody>
            </Table>

            {members.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="mb-3 h-10 w-10 text-gray-300" />
                <p className="text-sm font-medium text-gray-900">لا يوجد مستخدمون بعد</p>
                <p className="mt-1 text-xs text-gray-500">ابدأ بإنشاء HR Admin أو Recruiter لهذه المنظمة.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>بيانات المنظمة</CardTitle>
            <CardDescription>مرجع سريع لحالة المنظمة ومعرفاتها.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="الحالة" value={organization.status} />
            <InfoRow label="Slug" value={organization.slug || "غير محدد"} />
            <InfoRow label="Organization ID" value={organization.id} mono />
            <InfoRow label="تاريخ الإنشاء" value={new Date(organization.created_at).toLocaleDateString("en-CA")} />
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function MemberRow({
  member,
  orgId,
  onSuccess,
}: {
  member: SuperadminOrganizationMember;
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) {
  const profile = member.profile;
  const role = String(member.role || "employee");
  const accountStatus = String(profile?.account_status || "active");
  const isActive = accountStatus.toLowerCase() === "active";

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-slate-950">{profile?.full_name || "بدون اسم"}</span>
          <span className="text-xs text-slate-500">{profile?.title || "بدون مسمى"}</span>
        </div>
      </TableCell>
      <TableCell className="text-slate-600">
        <span className="inline-flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-400" />
          {profile?.email || "-"}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={roleBadgeClasses[role] || "border-slate-200 bg-slate-50 text-slate-700"}>
          {roleLabels[role] || role}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={isActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700"}
        >
          {accountStatus}
        </Badge>
      </TableCell>
      <TableCell className="text-slate-600">
        {member.created_at ? new Date(member.created_at).toLocaleDateString("en-CA") : "-"}
      </TableCell>
      <TableCell className="text-right">
        <MemberActions member={member} orgId={orgId} onSuccess={onSuccess} />
      </TableCell>
    </TableRow>
  );
}

function OrganizationStatusButton({
  organization,
  onSuccess,
}: {
  organization: SuperadminOrganization;
  onSuccess: () => Promise<void> | void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isActive = organization.status.trim().toLowerCase() === "active";

  const handleToggle = async () => {
    setSubmitting(true);
    setError("");
    const result = await updateSuperadminOrganization(organization.id, {
      status: isActive ? "Suspended" : "Active",
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    await onSuccess();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        className={isActive
          ? "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"}
        onClick={handleToggle}
        disabled={submitting}
      >
        <Power className="ml-2 h-4 w-4" />
        {submitting ? "جار التحديث..." : isActive ? "إيقاف المنظمة" : "تفعيل المنظمة"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function MemberActions({
  member,
  orgId,
  onSuccess,
}: {
  member: SuperadminOrganizationMember;
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const accountStatus = String(member.profile?.account_status || "active");
  const isActive = accountStatus.toLowerCase() === "active";

  const handleStatus = async () => {
    setSubmitting(true);
    setError("");
    const result = await updateManagedUser({
      user_id: member.user_id,
      target_org_id: orgId,
      action: isActive ? "suspend" : "activate",
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    await onSuccess();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className={isActive
            ? "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"}
          onClick={handleStatus}
          disabled={submitting}
        >
          <Power className="ml-2 h-4 w-4" />
          {submitting ? "..." : isActive ? "إيقاف" : "تفعيل"}
        </Button>
        <ChangeRoleDialog member={member} orgId={orgId} onSuccess={onSuccess} />
        <ResetPasswordDialog member={member} orgId={orgId} onSuccess={onSuccess} />
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function ChangeRoleDialog({
  member,
  orgId,
  onSuccess,
}: {
  member: SuperadminOrganizationMember;
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ManagedOrgRole>(
    managedRoleOptions.some((option) => option.value === member.role)
      ? member.role as ManagedOrgRole
      : "hr_admin"
  );
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRole(managedRoleOptions.some((option) => option.value === member.role) ? member.role as ManagedOrgRole : "hr_admin");
  }, [member.role, open]);

  const handleUpdate = async () => {
    setSubmitting(true);
    setError("");
    const result = await updateManagedUser({
      user_id: member.user_id,
      target_org_id: orgId,
      action: "update_role",
      role,
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSaved(true);
    await onSuccess();
    setTimeout(() => {
      setOpen(false);
      setSaved(false);
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Shield className="ml-2 h-4 w-4" />
        الدور
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>تحديث دور المستخدم</DialogTitle>
          <DialogDescription>
            أدوار المالية تمنح المستخدم صلاحيات داخل وحدة المالية والمحاسبة حسب مستوى الدور.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الدور</Label>
            <Select value={role} onValueChange={(value) => setRole((value || "hr_admin") as ManagedOrgRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {managedRoleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleUpdate} disabled={submitting || role === member.role}>
            {saved ? (
              <><CheckCircle2 className="ml-2 h-4 w-4" />تم التحديث</>
            ) : submitting ? (
              "جار التحديث..."
            ) : (
              "تحديث الدور"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  orgId,
  onSuccess,
}: {
  member: SuperadminOrganizationMember;
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async () => {
    setSubmitting(true);
    setError("");
    const result = await updateManagedUser({
      user_id: member.user_id,
      target_org_id: orgId,
      action: "reset_password",
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSaved(true);
    await onSuccess();
    setTimeout(() => {
      setOpen(false);
      setSaved(false);
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <KeyRound className="ml-2 h-4 w-4" />
        كلمة المرور
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>إرسال رابط استعادة كلمة المرور</DialogTitle>
          <DialogDescription>
            سيرسل النظام رابط استعادة آمن إلى بريد {member.profile?.full_name || "هذا المستخدم"}. لن يتمكن مسؤول المنصة من اختيار كلمة مرور المستخدم أو الاطلاع عليها.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">سيبقى الرابط محدود الصلاحية ويخضع لسياسة كلمة المرور والتحقق من الجلسة.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleReset} disabled={submitting}>
            {saved ? (
              <><CheckCircle2 className="ml-2 h-4 w-4" />تم التحديث</>
            ) : submitting ? (
              "جار التحديث..."
            ) : (
              "إرسال رابط الاستعادة"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 break-all text-sm font-semibold text-slate-950 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function CreateOrgUserDialog({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "admin" as ManagedOrgRole,
  });

  const set = (key: keyof typeof form, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const handleCreate = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setError("الاسم والبريد مطلوبان.");
      return;
    }

    setSubmitting(true);
    setError("");
    const result = await createManagedUser({
      ...form,
      target_org_id: orgId,
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSaved(true);
    await onSuccess();
    setTimeout(() => {
      setOpen(false);
      setSaved(false);
      setForm({ full_name: "", email: "", role: "admin" });
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}>
        <Plus className="ml-2 h-4 w-4" />
        إنشاء مستخدم
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>دعوة مسؤول منظمة</DialogTitle>
          <DialogDescription>أدوار الموظفين تُدعى من دورة تهيئة الموظف لدى HR بعد اكتمال ملفهم.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الاسم الكامل</Label>
            <Input value={form.full_name} onChange={(event) => set("full_name", event.target.value)} placeholder="HR Manager" />
          </div>
          <div className="space-y-2">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} placeholder="hr@company.com" />
          </div>
          <div className="space-y-2">
            <Label>الدور</Label>
            <Select value={form.role} onValueChange={(value) => set("role", value || "hr_admin")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {managedRoleOptions.filter((option) => option.value === "admin").map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              أدوار المالية تمنح المستخدم صلاحيات داخل وحدة المالية والمحاسبة حسب مستوى الدور.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleCreate} disabled={submitting}>
            {saved ? (
              <><CheckCircle2 className="ml-2 h-4 w-4" />تم الإنشاء</>
            ) : submitting ? (
              "جار الإنشاء..."
            ) : (
              <><Plus className="ml-2 h-4 w-4" />إنشاء المستخدم</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
