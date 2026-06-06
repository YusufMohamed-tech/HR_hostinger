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
import { createEmployeeAccount, replaceEmployeeLocations, updateEmployee } from "@/lib/services/employees";
import { updateDepartment } from "@/lib/services/departments";
import { hasUnreturnedAssets } from "@/lib/services/assets";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { useRoleContext } from "@/providers/RoleProvider";
import { createCareerEvents } from "@/lib/services/career-events";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employee: any;
  onSuccess: () => void;
}

const employmentTypeLabels: Record<string, string> = {
  intern: "متدرب",
  full_time: "موظف عادي",
  contract: "موظف دائم",
  part_time: "دوام جزئي",
};

const statusLabels: Record<string, string> = {
  Active: "نشط",
  Inactive: "غير نشط",
  "On Leave": "في إجازة",
};

const cityOptions = [
  "الرياض",
  "جدة",
  "مكة المكرمة",
  "المدينة المنورة",
  "الدمام",
  "الخبر",
  "تبوك",
  "أبها",
  "نجران",
  "حائل",
  "القصيم",
  "الجوف",
  "الباحة",
  "عسير",
  "ينبع",
  "جازان",
];

const employeeDialogContentClass =
  "max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-3 sm:max-w-[760px] sm:p-4";
const twoColumnGridClass = "grid grid-cols-1 gap-4 md:grid-cols-2";
const threeColumnGridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

export function EditEmployeeDialog({ employee, onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const [createLoginAccount, setCreateLoginAccount] = useState(false);
  const [accountRole, setAccountRole] = useState<"employee" | "training_manager">("employee");
  const [accountPassword, setAccountPassword] = useState("");
  const [canMultiCheckin, setCanMultiCheckin] = useState(false);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [primaryLocationId, setPrimaryLocationId] = useState("");

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
    city: "",
    province: "",
    employment_type: "full_time",
    status: "Active",
    base_salary: "",
    bonus: "",
    deductions: "",
    leave_balance_manual_adjustment: "",
    leave_accrual_start_date: "",
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
        city: employee.city || "",
        province: employee.province || employee.city || "",
        employment_type: employee.employment_type || "full_time",
        status: employee.status || "Active",
        base_salary: employee.base_salary ? String(employee.base_salary) : "",
        bonus: employee.bonus ? String(employee.bonus) : "",
        deductions: employee.deductions ? String(employee.deductions) : "",
        leave_balance_manual_adjustment: employee.leave_balance_manual_adjustment ? String(employee.leave_balance_manual_adjustment) : "",
        leave_accrual_start_date: employee.leave_accrual_start_date || employee.hiring_date || "",
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
      setCanMultiCheckin(Boolean(employee.can_multi_checkin));
      const employeeLocationRows = Array.isArray(employee.employee_locations) ? employee.employee_locations : [];
      const locationIds = employeeLocationRows
        .map((row: Record<string, unknown>) => String(row.location_id || ""))
        .filter(Boolean);
      const primaryRow = employeeLocationRows.find((row: Record<string, unknown>) => Boolean(row.is_primary));
      const fallbackPrimary = String(employee.location_id || locationIds[0] || "");
      setSelectedLocationIds(locationIds.length > 0 ? locationIds : fallbackPrimary ? [fallbackPrimary] : []);
      setPrimaryLocationId(String((primaryRow as Record<string, unknown> | undefined)?.location_id || fallbackPrimary));
    }
  }, [departments, employee, open]);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const toggleLocation = (locationId: string, checked: boolean) => {
    setSelectedLocationIds((prev) => {
      const next = checked ? Array.from(new Set([...prev, locationId])) : prev.filter((id) => id !== locationId);
      const nextPrimary = next.includes(primaryLocationId) ? primaryLocationId : next[0] || "";
      setPrimaryLocationId(nextPrimary);
      set("location_id", nextPrimary);
      return next;
    });
  };

  const choosePrimaryLocation = (locationId: string) => {
    const next = selectedLocationIds.includes(locationId) ? selectedLocationIds : [...selectedLocationIds, locationId];
    setSelectedLocationIds(next);
    setPrimaryLocationId(locationId);
    set("location_id", locationId);
  };

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

    const currentStatus = String(employee?.status || "Active");
    const isChangingToInactive = form.status === "Inactive" && currentStatus !== "Inactive";
    if (isChangingToInactive) {
      const orgId = String(employee?.org_id || "");
      const employeeId = String(employee?.id || "");
      const assetCheck = orgId && employeeId
        ? await hasUnreturnedAssets(orgId, employeeId)
        : { hasAssets: false, error: null };

      if (assetCheck.error) {
        setError(assetCheck.error.message);
        setSubmitting(false);
        return;
      }

      if (assetCheck.hasAssets) {
        setMessage("لا يمكن تعطيل هذا الموظف. لديه عهدة لم تُسلّم بعد. يرجى الانتهاء من تسليم العهدة أولاً.");
        setSubmitting(false);
        return;
      }
    }

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
      city: form.city || undefined,
      province: form.province || form.city || undefined,
      employment_type: form.employment_type || undefined,
      status: form.status || undefined,
      base_salary: form.base_salary ? parseFloat(form.base_salary) : undefined,
      bonus: form.bonus ? parseFloat(form.bonus) : undefined,
      deductions: form.deductions ? parseFloat(form.deductions) : undefined,
      leave_balance_manual_adjustment: form.leave_balance_manual_adjustment ? parseFloat(form.leave_balance_manual_adjustment) : undefined,
      leave_accrual_start_date: form.leave_accrual_start_date || form.hiring_date || undefined,
      can_multi_checkin: canMultiCheckin,
      payment_method: form.payment_method || undefined,
      bank_account: form.bank_account || undefined,
    };

    const effectiveDate = form.hiring_date || new Date().toISOString().split("T")[0];
    const careerEvents = [
      { key: "job_title", type: "role_change", label: "تغيير المسمى الوظيفي" },
      { key: "department_id", type: "department_change", label: "تغيير القسم" },
      { key: "location_id", type: "location_change", label: "تغيير الموقع الأساسي" },
      { key: "status", type: "status_change", label: "تغيير الحالة" },
      { key: "employment_type", type: "role_change", label: "تغيير نوع التوظيف" },
    ]
      .filter((item) => String(employee?.[item.key] || "") !== String(form[item.key as keyof typeof form] || ""))
      .map((item) => ({
        employee_id: String(employee.id),
        event_type: item.type,
        previous_value: { [item.key]: employee?.[item.key] || null },
        new_value: { [item.key]: form[item.key as keyof typeof form] || null },
        effective_date: effectiveDate,
        notes: item.label,
        created_by: currentUser?.id,
      }));

    const { error: err } = await updateEmployee(employee.id, payload);

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    const { error: careerError } = await createCareerEvents(careerEvents);
    if (careerError) {
      setError(careerError.message);
      setSubmitting(false);
      return;
    }

    const { error: locationsError } = await replaceEmployeeLocations(
      String(employee.id),
      selectedLocationIds,
      form.location_id
    );
    if (locationsError) {
      setError(locationsError.message);
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
    <>
      <MessageDialog open={Boolean(message)} onOpenChange={(nextOpen) => !nextOpen && setMessage("")} description={message} />
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
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={canMultiCheckin}
                onChange={(event) => setCanMultiCheckin(event.target.checked)}
              />
              <span>السماح بتسجيل حضور متعدد في نفس اليوم</span>
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
                <Label>المحافظة / المدينة</Label>
                <Select
                  value={form.city}
                  onValueChange={(value) => {
                    set("city", value || "");
                    set("province", value || "");
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    {cityOptions.map((city) => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <Label>المواقع المسموحة</Label>
                <p className="mt-1 text-xs text-gray-500">اختر الفروع المسموحة، وحدد موقعًا أساسيًا للحضور الافتراضي.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {locations.map((location) => {
                  const locationId = String(location.id);
                  const checked = selectedLocationIds.includes(locationId);
                  return (
                    <label key={locationId} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={checked}
                          onChange={(event) => toggleLocation(locationId, event.target.checked)}
                        />
                        {String(location.name)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <input
                          type="radio"
                          name="edit-primary-location"
                          checked={primaryLocationId === locationId}
                          onChange={() => choosePrimaryLocation(locationId)}
                        />
                        أساسي
                      </span>
                    </label>
                  );
                })}
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
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>رصيد الإجازات الافتتاحي</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.leave_balance_manual_adjustment}
                  onChange={(e) => set("leave_balance_manual_adjustment", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>بداية احتساب رصيد الإجازات</Label>
                <Input
                  type="date"
                  value={form.leave_accrual_start_date}
                  onChange={(e) => set("leave_accrual_start_date", e.target.value)}
                />
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
    </>
  );
}
