"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useDepartments, useLocations, useEmployees } from "@/hooks/use-data";
import { createEmployeeAccount, updateEmployee } from "@/lib/services/employees";
import { updateDepartment } from "@/lib/services/departments";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employee: any;
  onSuccess: () => void;
}

const employmentTypeLabels: Record<string, string> = {
  full_time: "دوام كامل",
  part_time: "دوام جزئي",
  intern: "تدريب",
  contract: "عقد",
};

const statusLabels: Record<string, string> = {
  Active: "نشط",
  Inactive: "غير نشط",
  "On Leave": "في إجازة",
};

const employeeDialogContentClass =
  "max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-3 sm:max-w-[760px] sm:p-4";
const twoColumnGridClass = "grid grid-cols-1 gap-4 md:grid-cols-2";
const threeColumnGridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

export function EditEmployeeDialog({ employee, onSuccess }: Props) {
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const [createLoginAccount, setCreateLoginAccount] = useState(false);
  const [accountRole, setAccountRole] = useState<"employee" | "training_manager">("employee");
  const [accountPassword, setAccountPassword] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    employee_code: "",
    email: "",
    phone: "",
    address: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    national_id: "",
    date_of_birth: "",
    gender: "",
    hiring_date: "",
    department_id: "",
    job_title: "",
    manager_id: "",
    location_id: "",
    employment_type: "full_time",
    status: "Active",
    base_salary: "",
    bonus: "",
    deductions: "",
    payment_method: "",
    bank_account: "",
  });

  useEffect(() => {
    if (employee && open) {
      setForm({
        full_name: employee.full_name || employee.name || "",
        employee_code: employee.employee_code || "",
        email: employee.email || "",
        phone: employee.phone || "",
        address: employee.address || "",
        emergency_contact_name: employee.emergency_contact_name || "",
        emergency_contact_phone: employee.emergency_contact_phone || "",
        national_id: employee.national_id || "",
        date_of_birth: employee.date_of_birth || "",
        gender: employee.gender || "",
        hiring_date: employee.hiring_date || "",
        department_id: employee.department_id || "",
        job_title: employee.job_title || "",
        manager_id: employee.manager_id || "",
        location_id: employee.location_id || "",
        employment_type: employee.employment_type || "full_time",
        status: employee.status || "Active",
        base_salary: employee.base_salary ? String(employee.base_salary) : "",
        bonus: employee.bonus ? String(employee.bonus) : "",
        deductions: employee.deductions ? String(employee.deductions) : "",
        payment_method: employee.payment_method || "",
        bank_account: employee.bank_account || "",
      });
      const managedDepartment = departments.find((department) => {
        const departmentRecord = department as Record<string, unknown>;
        return String(departmentRecord.manager_employee_id || "") === String(employee.id || "");
      });
      setIsDepartmentManager(Boolean(managedDepartment));
      setCreateLoginAccount(false);
      setAccountRole(Boolean(managedDepartment) ? "training_manager" : "employee");
      setAccountPassword("");
    }
  }, [departments, employee, open]);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleDepartmentManagerChange = (checked: boolean) => {
    setIsDepartmentManager(checked);
    if (checked && !employee?.user_id) {
      setCreateLoginAccount(true);
      setAccountRole("training_manager");
    }
  };

  const handleSubmit = async () => {
    if (!form.full_name) return;
    if (createLoginAccount && !employee?.user_id) {
      if (!form.email.trim()) {
        setError("البريد الإلكتروني مطلوب لإنشاء حساب الدخول.");
        return;
      }
      if (accountPassword.length < 8) {
        setError("كلمة مرور حساب الدخول يجب ألا تقل عن 8 أحرف.");
        return;
      }
    }
    setSubmitting(true);
    setError("");

    const payload = {
      full_name: form.full_name,
      employee_code: form.employee_code || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      emergency_contact_name: form.emergency_contact_name || undefined,
      emergency_contact_phone: form.emergency_contact_phone || undefined,
      national_id: form.national_id || undefined,
      date_of_birth: form.date_of_birth || undefined,
      gender: form.gender || undefined,
      hiring_date: form.hiring_date || undefined,
      department_id: form.department_id || undefined,
      job_title: form.job_title || undefined,
      manager_id: form.manager_id || undefined,
      location_id: form.location_id || undefined,
      employment_type: form.employment_type || undefined,
      status: form.status || undefined,
      base_salary: form.base_salary ? parseFloat(form.base_salary) : undefined,
      bonus: form.bonus ? parseFloat(form.bonus) : undefined,
      deductions: form.deductions ? parseFloat(form.deductions) : undefined,
      payment_method: form.payment_method || undefined,
      bank_account: form.bank_account || undefined,
    };

    const { error: err } = await updateEmployee(employee.id, payload);

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    const managedDepartments = departments.filter((department) => {
      const departmentRecord = department as Record<string, unknown>;
      return String(departmentRecord.manager_employee_id || "") === String(employee.id || "");
    });

    for (const department of managedDepartments) {
      const departmentId = String((department as Record<string, unknown>).id || "");
      if (departmentId && (!isDepartmentManager || departmentId !== form.department_id)) {
        const { error: clearError } = await updateDepartment(departmentId, { manager_employee_id: null });
        if (clearError) {
          setError(clearError.message);
          setSubmitting(false);
          return;
        }
      }
    }

    if (isDepartmentManager && form.department_id) {
      const { error: deptError } = await updateDepartment(form.department_id, {
        manager_employee_id: employee.id,
      });
      if (deptError) {
        setError(deptError.message);
        setSubmitting(false);
        return;
      }
    }

    if (createLoginAccount && !employee.user_id) {
      const { error: accountError } = await createEmployeeAccount({
        employee_id: String(employee.id),
        email: form.email.trim(),
        password: accountPassword,
        full_name: form.full_name,
        role: accountRole,
      });

      if (accountError) {
        setError(`تم حفظ بيانات الموظف، لكن فشل إنشاء حساب الدخول: ${accountError.message}`);
        setSubmitting(false);
        onSuccess();
        return;
      }
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark" />}>
        <Pencil className="w-3.5 h-3.5 ml-1" />
        تعديل
      </DialogTrigger>
      <DialogContent className={employeeDialogContentClass}>
        <DialogHeader>
          <DialogTitle>تعديل بيانات الموظف</DialogTitle>
          <DialogDescription>حدّث بيانات الموظف وإعدادات العمل والراتب.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">البيانات الأساسية</p>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>الاسم الكامل *</Label>
                <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>رقم الموظف</Label>
                <Input value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>البريد الإلكتروني</Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>الجوال</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>العنوان</Label>
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>رقم الهوية</Label>
                <Input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} />
              </div>
            </div>
            <div className={threeColumnGridClass}>
              <div className="space-y-2">
                <Label>تاريخ الميلاد</Label>
                <Input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>الجنس</Label>
                <Select value={form.gender} onValueChange={(v) => set("gender", v || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">ذكر</SelectItem>
                    <SelectItem value="female">أنثى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>تاريخ التعيين</Label>
                <Input type="date" value={form.hiring_date} onChange={(e) => set("hiring_date", e.target.value)} />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>اسم جهة الطوارئ</Label>
                <Input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>جوال جهة الطوارئ</Label>
                <Input value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">بيانات العمل</p>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>القسم</Label>
                <Select value={form.department_id} onValueChange={(v) => set("department_id", v || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={String(d.id)} value={String(d.id)}>{String(d.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>المسمى الوظيفي</Label>
                <Input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={isDepartmentManager}
                onChange={(event) => handleDepartmentManagerChange(event.target.checked)}
              />
              <span>تعيين هذا الشخص كمدير للقسم المختار</span>
            </label>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>المدير المباشر</Label>
                <Select value={form.manager_id} onValueChange={(v) => set("manager_id", v || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={String(emp.id)} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الموقع</Label>
                <Select value={form.location_id} onValueChange={(v) => set("location_id", v || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={String(l.id)} value={String(l.id)}>{String(l.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className={threeColumnGridClass}>
              <div className="space-y-2">
                <Label>نوع التوظيف</Label>
                <Select value={form.employment_type} onValueChange={(v) => set("employment_type", v || "")}>
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => (value ? employmentTypeLabels[value] || value : "اختر")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(employmentTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الحالة</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v || "")}>
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => (value ? statusLabels[value] || value : "اختر")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>طريقة الدفع</Label>
                <Input value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)} />
              </div>
            </div>
          </div>

          {!employee?.user_id && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-700">حساب الدخول</p>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={createLoginAccount}
                  onChange={(event) => setCreateLoginAccount(event.target.checked)}
                />
                <span>إنشاء حساب دخول لهذا الموظف</span>
              </label>
              {createLoginAccount && (
                <div className={twoColumnGridClass}>
                  <div className="space-y-2">
                    <Label>نوع الحساب</Label>
                    <Select value={accountRole} onValueChange={(value) => setAccountRole(value as "employee" | "training_manager")}>
                      <SelectTrigger>
                        <SelectValue>
                          {(value: string | null) => value === "training_manager" ? "مدير تدريب / موقع" : "موظف"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">موظف</SelectItem>
                        <SelectItem value="training_manager">مدير تدريب / موقع</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>كلمة المرور المؤقتة *</Label>
                    <Input
                      type="password"
                      value={accountPassword}
                      onChange={(event) => setAccountPassword(event.target.value)}
                      placeholder="8 أحرف على الأقل"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">بيانات الراتب</p>
            <div className={threeColumnGridClass}>
              <div className="space-y-2">
                <Label>الراتب الأساسي</Label>
                <Input type="number" value={form.base_salary} onChange={(e) => set("base_salary", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>البدلات / المكافآت</Label>
                <Input type="number" value={form.bonus} onChange={(e) => set("bonus", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>الخصومات الثابتة</Label>
                <Input type="number" value={form.deductions} onChange={(e) => set("deductions", e.target.value)} />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>الحساب البنكي</Label>
                <Input value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.full_name}>
            {submitting ? "جاري الحفظ..." : "حفظ التعديلات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
