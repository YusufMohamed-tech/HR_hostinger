"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoleContext } from "@/providers/RoleProvider";
import { LogOut, Shield, User, Building2, Mail, Key, Save, CheckCircle, UserPlus } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { getOrganizations, updateOrganization } from "@/lib/services/organizations";
import { getOrgMembers } from "@/lib/services/members";
import { createManagedUser, type ManagedOrgRole } from "@/lib/services/admin-users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SettingsPage() {
  const router = useRouter();
  const { currentUser, logout } = useRoleContext();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const roleBadgeColors: Record<string, string> = {
    Superadmin: "bg-slate-900 text-white border-slate-900",
    Admin: "bg-blue-50 text-blue-700 border-blue-200",
    Employee: "bg-green-50 text-green-700 border-green-200",
    HR_Admin: "bg-indigo-50 text-indigo-700 border-indigo-200",
    HR_Recruitment: "bg-purple-50 text-purple-700 border-purple-200",
    Training_Manager: "bg-amber-50 text-amber-700 border-amber-200",
    Finance_Manager: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Accountant: "bg-teal-50 text-teal-700 border-teal-200",
    Finance_Viewer: "bg-slate-50 text-slate-700 border-slate-200",
  };
  const roleBadgeColor = roleBadgeColors[currentUser?.role || "Employee"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">الإعدادات</h1>
        <p className="text-gray-500 text-sm mt-1">
          إدارة حسابك وصلاحياتك وتفضيلات النظام.
        </p>
      </div>

      {/* User Profile Card */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-brand" />
              الملف الشخصي
            </CardTitle>
            <EditProfileButton />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <User className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">الاسم الكامل</p>
                <p className="text-sm font-medium text-gray-900">{currentUser?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Mail className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">البريد الإلكتروني</p>
                <p className="text-sm font-medium text-gray-900">{currentUser?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Shield className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">الدور الوظيفي</p>
                <Badge variant="outline" className={roleBadgeColor}>{currentUser?.role}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Building2 className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">رقم المنظمة</p>
                <p className="text-sm font-medium text-gray-900 font-mono">{currentUser?.orgId}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Key className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">رقم المستخدم</p>
                <p className="text-sm font-medium text-gray-900 font-mono">{currentUser?.id}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Settings (Admin only) */}
      {["Superadmin", "Admin"].includes(currentUser?.role || "") && (
        <div className="grid gap-4 md:grid-cols-2">
          {currentUser?.role === "Superadmin" && <UserManagementCard />}

          <EditCompanyDialog />

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>الأدوار والصلاحيات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">التحكم في الوصول لأدوار المسؤول والموظف.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">مسؤول</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">إدارة + عرض</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">موظف</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">عرض فقط</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>الإشعارات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">ضبط التنبيهات للحضور والمهام واعتمادات الإجازات.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">تنبيهات التأخر</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">تعيينات المهام الجديدة</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">اعتمادات الإجازات</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>الأمان</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">إعدادات الجلسة والتوثيق.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">التحقق بعاملين</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">مخطط</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">سياسة كلمة المرور</span>
                  <span className="text-gray-900 font-medium">قياسية</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Logout */}
      <Card className="shadow-sm border-red-200">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="font-medium text-gray-900">تسجيل الخروج</p>
            <p className="text-sm text-gray-500">إنهاء الجلسة الحالية والعودة إلى صفحة تسجيل الدخول.</p>
          </div>
          <Button
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            تسجيل الخروج
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UserManagementCard() {
  const { currentUser } = useRoleContext();
  const [members, setMembers] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "hr_admin" as ManagedOrgRole,
  });

  const roleOptions: Array<{ value: ManagedOrgRole; label: string }> = [
    { value: "admin", label: "مسؤول منظمة" },
    { value: "hr_admin", label: "مدير الموارد البشرية" },
    { value: "hr_recruitment", label: "مسؤول التوظيف" },
    { value: "finance_manager", label: "مدير المالية" },
    { value: "accountant", label: "محاسب" },
    { value: "finance_viewer", label: "مشاهد المالية" },
  ];

  const roleLabels: Record<string, string> = {
    super_admin: "مسؤول أعلى",
    admin: "مسؤول",
    hr_admin: "موارد بشرية",
    hr_recruitment: "مسؤول توظيف",
    finance_manager: "مدير المالية",
    accountant: "محاسب",
    finance_viewer: "مشاهد المالية",
    sales: "مبيعات",
    sales_manager: "مدير المبيعات",
    training_manager: "مدير تدريب",
    employee: "موظف",
  };

  const loadMembers = async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const result = await getOrgMembers(currentUser.orgId);
    setMembers(result.data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.orgId]);

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreate = async () => {
    setSubmitting(true);
    setError("");
    setMessage("");

    const result = await createManagedUser({ ...form, target_org_id: currentUser?.orgId });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage("تم إنشاء الحساب وتحديث الصلاحية.");
    setForm({ full_name: "", email: "", password: "", role: "hr_admin" });
    await loadMembers();
    setTimeout(() => {
      setMessage("");
      setOpen(false);
    }, 1200);
  };

  return (
    <Card className="border-none shadow-sm md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-brand" />
            إدارة المستخدمين
          </CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
              إنشاء حساب إداري
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>إنشاء مستخدم مُدار</DialogTitle>
                <DialogDescription>إنشاء حساب إداري أو مالي داخل هذه المنظمة.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>الاسم الكامل</Label>
                  <Input value={form.full_name} onChange={(event) => set("full_name", event.target.value)} placeholder="فريق الموارد البشرية" />
                </div>
                <div className="space-y-2">
                  <Label>البريد الإلكتروني</Label>
                  <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} placeholder="hr@tatwir.sa" />
                </div>
                <div className="space-y-2">
                  <Label>كلمة المرور</Label>
                  <Input type="password" value={form.password} onChange={(event) => set("password", event.target.value)} placeholder="8 أحرف على الأقل" />
                </div>
                <div className="space-y-2">
                  <Label>الدور</Label>
                  <Select value={form.role} onValueChange={(value) => set("role", value || "hr_admin")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    أدوار المالية تمنح المستخدم صلاحيات داخل وحدة المالية والمحاسبة حسب مستوى الدور.
                  </p>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                {message && <p className="text-sm text-green-700">{message}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
                <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleCreate} disabled={submitting}>
                  {submitting ? "جار الإنشاء..." : "إنشاء المستخدم"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-3 gap-3 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
            <span>الاسم</span>
            <span>البريد الإلكتروني</span>
            <span>الدور</span>
          </div>
          <div className="divide-y divide-gray-100">
            {members.map((member) => {
              const memberId = String(member.id || member.user_id || "");
              const profile = (member.profiles ?? null) as Record<string, unknown> | null;
              const role = String(member.role || "employee");
              return (
                <div key={memberId} className="grid grid-cols-3 gap-3 px-3 py-3 text-sm">
                  <span className="font-medium text-gray-900">{String(profile?.full_name || "-")}</span>
                  <span className="text-gray-600">{String(profile?.email || "-")}</span>
                  <Badge variant="outline">{roleLabels[role] || role}</Badge>
                </div>
              );
            })}
            {!loading && members.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-gray-500">لم يتم إيجاد مستخدمين.</div>
            )}
            {loading && (
              <div className="px-3 py-6 text-center text-sm text-gray-500">جار التحميل...</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Edit Company Profile Dialog ─── */

function EditCompanyDialog() {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    companyName: "",
    status: "active",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!open || !currentUser?.orgId) return;

    const orgId = currentUser.orgId;

    async function loadOrganization() {
      const result = await getOrganizations();
      const organization = result.data?.find((item) => item.id === orgId);
      if (!organization) return;

      setForm({
        companyName: typeof organization.name === "string" ? organization.name : "",
        status: typeof organization.status === "string" ? organization.status : "active",
      });
    }

    loadOrganization();
  }, [currentUser?.orgId, open]);

  const handleSave = async () => {
    if (!currentUser?.orgId) return;

    const companyName = form.companyName.trim();
    if (!companyName) {
      setError("اسم الشركة مطلوب.");
      return;
    }

    setSubmitting(true);
    setError("");

    const result = await updateOrganization(currentUser.orgId, {
      name: companyName,
    });

    setSubmitting(false);

    if (result.error) {
      setError(result.error.message || "فشل في حفظ ملف الشركة.");
      return;
    }

    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
  };

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>ملف الشركة</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">بيانات الأعمال والمواقع والعلامة التجارية.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="outline" />}>تعديل الملف</DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>ملف الشركة</DialogTitle>
              <DialogDescription>تحديث بيانات مؤسستك.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>اسم الشركة</Label>
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>الحالة</Label>
                <Input value={form.status} onChange={(e) => set("status", e.target.value)} disabled />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
              <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave} disabled={submitting}>
                {saved ? (
                  <><CheckCircle className="w-4 h-4 mr-2" />تم الحفظ!</>
                ) : submitting ? (
                  "جار الحفظ..."
                ) : (
                  <><Save className="w-4 h-4 mr-2" />حفظ التغييرات</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ─── Edit Profile Button ─── */

function EditProfileButton() {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    full_name: currentUser?.name || "",
    phone: "",
    title: "",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const [submitting, setSubmitting] = useState(false);

  // Sync name from context when it changes
  React.useEffect(() => {
    setForm((prev) => ({ ...prev, full_name: currentUser?.name || prev.full_name }));
  }, [currentUser?.name]);

  const handleSave = async () => {
    if (!currentUser?.id) return;
    setSubmitting(true);
    const supabase = createClient();
    
    await supabase.from("profiles").update({ full_name: form.full_name } as never).eq("user_id", currentUser.id);
    
    if (currentUser.employeeId) {
      await supabase.from("employees").update({ 
        full_name: form.full_name,
        phone: form.phone || null,
        job_title: form.title || null
      } as never).eq("id", currentUser.employeeId);
    }
    
    setSubmitting(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        تعديل الملف الشخصي
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>تعديل الملف الشخصي</DialogTitle>
          <DialogDescription>تحديث بياناتك الشخصية.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الاسم الكامل</Label>
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الهاتف</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+966..." />
          </div>
          <div className="space-y-2">
            <Label>المسمى الوظيفي</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="مدير موارد بشرية" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave} disabled={submitting}>
            {saved ? (
              <><CheckCircle className="w-4 h-4 mr-2" />تم الحفظ!</>
            ) : submitting ? (
              "جار الحفظ..."
            ) : (
              <><Save className="w-4 h-4 mr-2" />حفظ الملف الشخصي</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
