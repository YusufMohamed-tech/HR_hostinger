"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { useDepartments, useLocations, useEmployees, useShifts } from "@/hooks/use-data";
import { createEmployee, replaceEmployeeLocations, type EmployeeAccountRole } from "@/lib/services/employees";
import { assignEmployeeShift } from "@/lib/services/schedule";
import { updateDepartment } from "@/lib/services/departments";
import { employeeFormSchema, getValidationMessage } from "@/lib/validation";
import { getSalesCompanies, type SalesCompany } from "@/lib/services/sales";
import { bankOptions, educationLevelOptions, saudiCityOptions } from "@/lib/hr-options";
import { inferLocationCity, locationMatchesCompany } from "@/lib/location-classification";
import {
  EMPLOYEE_ACCOUNT_PASSWORD_CONFIRMATION_MESSAGE,
  EMPLOYEE_ACCOUNT_PASSWORD_MESSAGE,
  isStrongEmployeeAccountPassword,
} from "@/lib/employee-account-password";

interface Props {
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

const employeeDialogContentClass =
  "max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-3 sm:max-w-[760px] sm:p-4";
const twoColumnGridClass = "grid grid-cols-1 gap-4 md:grid-cols-2";
const threeColumnGridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";
const todayString = () => new Date().toISOString().split("T")[0];
const accountRoleOptions: Array<{ value: EmployeeAccountRole; label: string }> = [
  { value: "employee", label: "موظف" },
  { value: "hr_admin", label: "مدير الموارد البشرية" },
  { value: "hr_recruitment", label: "مسؤول التوظيف" },
  { value: "training_manager", label: "مدير تدريب / موقع" },
  { value: "onground_agent_manager", label: "مدير المندوبين الميدانيين" },
  { value: "promoter", label: "مروج مبيعات" },
  { value: "finance_manager", label: "مدير المالية" },
  { value: "accountant", label: "محاسب" },
  { value: "finance_viewer", label: "مشاهد المالية" },
  { value: "supervisor", label: "مشرف مواقع" },
];
const getAccountRoleLabel = (value: string | null) =>
  accountRoleOptions.find((option) => option.value === value)?.label || "موظف";

export function AddEmployeeDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees();
  const { data: shifts } = useShifts();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [companies, setCompanies] = useState<SalesCompany[]>([]);
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const [accountRole, setAccountRole] = useState<EmployeeAccountRole>("employee");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirmation, setAccountPasswordConfirmation] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    full_name_ar: "",
    full_name_en: "",
    employee_code: "",
    email: "",
    phone: "",
    address: "",
    work_city: "",
    national_address_code: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    national_id: "",
    date_of_birth: "",
    date_of_birth_hijri: "",
    gender: "",
    hiring_date: todayString(),
    department_id: "",
    job_title: "",
    manager_id: "",
    location_id: "",
    company_id: "",
    project_id: "",
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
    bank_account_name: "",
    bank_name: "",
    iban: "",
    education_level: "",
  });
  const [shiftForm, setShiftForm] = useState({
    shift_id: "",
    start_date: "",
    end_date: "",
  });
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [primaryLocationId, setPrimaryLocationId] = useState("");

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  const setShift = (key: string, value: string | null) => setShiftForm((prev) => ({ ...prev, [key]: value ?? "" }));
  const setArabicName = (value: string) => {
    setForm((prev) => ({ ...prev, full_name_ar: value, full_name: value }));
  };
  const setWorkCity = (value: string | null) => {
    setSelectedLocationIds([]);
    setPrimaryLocationId("");
    setForm((prev) => ({
      ...prev,
      work_city: value ?? "",
      city: value ?? "",
      province: value ?? "",
      location_id: "",
    }));
  };
  const setProject = (value: string | null) => {
    setSelectedLocationIds([]);
    setPrimaryLocationId("");
    setForm((prev) => ({
      ...prev,
      project_id: value ?? "",
      company_id: value ?? "",
      location_id: "",
    }));
  };
  const setIban = (value: string) => {
    setForm((prev) => ({ ...prev, iban: value, bank_account: value }));
  };
  const selectedProject = useMemo(
    () => companies.find((company) => company.id === form.project_id) || null,
    [companies, form.project_id]
  );
  const filteredLocations = useMemo(() => {
    return locations.filter((location) => {
      const locationCity = inferLocationCity(location);
      const matchesCity = !form.work_city || locationCity === form.work_city;
      const matchesProject = !form.project_id || locationMatchesCompany(location, selectedProject);
      return matchesCity && matchesProject;
    });
  }, [form.project_id, form.work_city, locations, selectedProject]);

  useEffect(() => {
    if (!open) return;
    getSalesCompanies().then((result) => setCompanies(result.data || []));
  }, [open, currentUser?.orgId]);

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
    if (checked) {
      setAccountRole("training_manager");
    }
  };

  const handleSubmit = async () => {
    if (!currentUser?.orgId) return;

    const parsed = employeeFormSchema.safeParse(form);
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      return;
    }

    if (!parsed.data.email) {
      setError("البريد الإلكتروني مطلوب لإنشاء وتفعيل حساب الدخول.");
      return;
    }
    if (!parsed.data.hiring_date) {
      setError("تاريخ بدء العمل مطلوب.");
      return;
    }
    if (!isStrongEmployeeAccountPassword(accountPassword)) {
      setError(EMPLOYEE_ACCOUNT_PASSWORD_MESSAGE);
      return;
    }
    if (accountPassword !== accountPasswordConfirmation) {
      setError(EMPLOYEE_ACCOUNT_PASSWORD_CONFIRMATION_MESSAGE);
      return;
    }

    setSubmitting(true);
    setError("");

    const payload = {
      org_id: currentUser.orgId,
      ...parsed.data,
      leave_accrual_start_date: parsed.data.hiring_date || todayString(),
    };

    const { data: createdEmployee, error: err } = await createEmployee(payload, {
      email: parsed.data.email,
      full_name: parsed.data.full_name,
      role: accountRole,
      password: accountPassword,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    if (createdEmployee?.id) {
      const employeeId = String(createdEmployee.id);
      const { error: locationsError } = await replaceEmployeeLocations(
        currentUser.orgId,
        employeeId,
        selectedLocationIds,
        parsed.data.location_id
      );
      if (locationsError) {
        setError(`تم حفظ الموظف، لكن فشل حفظ المواقع: ${locationsError.message}`);
        setSubmitting(false);
        onSuccess();
        return;
      }

    }

    if (isDepartmentManager && parsed.data.department_id && createdEmployee?.id) {
      const { error: deptError } = await updateDepartment(parsed.data.department_id, {
        manager_employee_id: String(createdEmployee.id),
        name: String(departments.find((department) => String(department.id) === parsed.data.department_id)?.name || ""),
        expected_version: Number(departments.find((department) => String(department.id) === parsed.data.department_id)?.version || 1),
      });

      if (deptError) {
        setError(deptError.message);
        setSubmitting(false);
        return;
      }
    }

    if (shiftForm.shift_id && createdEmployee?.id) {
      const { error: shiftError } = await assignEmployeeShift({
        org_id: currentUser.orgId,
        employee_id: String(createdEmployee.id),
        shift_id: shiftForm.shift_id,
        start_date: shiftForm.start_date || parsed.data.hiring_date || todayString(),
        end_date: shiftForm.end_date || undefined,
      });

      if (shiftError) {
        setError(`تم حفظ الموظف، لكن فشل إسناد الشيفت: ${shiftError.message}`);
        setSubmitting(false);
        onSuccess();
        return;
      }
    }

    setSubmitting(false);
    setOpen(false);
    setForm({
      full_name: "",
      full_name_ar: "",
      full_name_en: "",
      employee_code: "",
      email: "",
      phone: "",
      address: "",
      work_city: "",
      national_address_code: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      national_id: "",
      date_of_birth: "",
      date_of_birth_hijri: "",
      gender: "",
      hiring_date: todayString(),
      department_id: "",
      job_title: "",
      manager_id: "",
      location_id: "",
      company_id: "",
      project_id: "",
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
      bank_account_name: "",
      bank_name: "",
      iban: "",
      education_level: "",
    });
    setIsDepartmentManager(false);
    setSelectedLocationIds([]);
    setPrimaryLocationId("");
    setShiftForm({ shift_id: "", start_date: "", end_date: "" });
    setAccountRole("employee");
    setAccountPassword("");
    setAccountPasswordConfirmation("");
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 ml-2" />
        إضافة موظف
      </DialogTrigger>
      <DialogContent className={employeeDialogContentClass}>
        <DialogHeader>
          <DialogTitle>إضافة موظف</DialogTitle>
          <DialogDescription>أكمل بيانات الموظف. الحقول المطلوبة عليها علامة *.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">البيانات الأساسية</p>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>الاسم الكامل *</Label>
                <Input value={form.full_name_ar} onChange={(e) => setArabicName(e.target.value)} placeholder="أحمد يوسف" />
              </div>
              <div className="space-y-2">
                <Label>رقم الموظف</Label>
                <Input value={form.employee_code || "سيتم توليده تلقائيا"} readOnly className="bg-gray-50 text-gray-500" />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>الاسم بالإنجليزي</Label>
                <Input value={form.full_name_en} onChange={(e) => set("full_name_en", e.target.value)} placeholder="Ahmed Youssef" dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>المؤهل العلمي</Label>
                <Select value={form.education_level} onValueChange={(v) => set("education_level", v || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر المؤهل" /></SelectTrigger>
                  <SelectContent>
                    {educationLevelOptions.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>البريد الإلكتروني</Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="employee@company.com" />
              </div>
              <div className="space-y-2">
                <Label>الجوال</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+966 55 123 4567" />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>العنوان</Label>
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="العنوان الوطني التفصيلي" />
              </div>
              <div className="space-y-2">
                <Label>رقم الهوية</Label>
                <Input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} placeholder="رقم الهوية" />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>مدينة العمل *</Label>
                <Select value={form.work_city} onValueChange={(value) => setWorkCity(value)}>
                  <SelectTrigger><SelectValue placeholder="اختر المدينة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">كل المدن</SelectItem>
                    {saudiCityOptions.map((city) => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>العنوان الوطني</Label>
                <Input value={form.national_address_code} onChange={(e) => set("national_address_code", e.target.value.toUpperCase())} placeholder="EAPX0123" dir="ltr" maxLength={8} />
              </div>
            </div>
            <div className={threeColumnGridClass}>
              <div className="space-y-2">
                <Label>تاريخ الميلاد ميلادي</Label>
                <Input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>تاريخ الميلاد هجري</Label>
                <Input value={form.date_of_birth_hijri} onChange={(e) => set("date_of_birth_hijri", e.target.value)} placeholder="1445/01/01" dir="ltr" />
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
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-semibold text-slate-700">الشيفت وساعات العمل</p>
                <p className="mt-1 text-xs text-gray-500">اختيار الشيفت هنا يربط الموظف بساعات دخول وانصراف محددة لحساب الحضور المبكر والتأخير والانصراف المبكر أو المتأخر.</p>
              </div>
              <div className={threeColumnGridClass}>
                <div className="space-y-2">
                  <Label>الشيفت</Label>
                  <Select value={shiftForm.shift_id} onValueChange={(v) => setShift("shift_id", v || "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر شيفت">
                        {() => { const s = shifts.find((sh) => String(sh.id) === shiftForm.shift_id); return s ? `${String(s.name)} (${typeof s.start_time === "string" ? s.start_time.slice(0, 5) : "--:--"} - ${typeof s.end_time === "string" ? s.end_time.slice(0, 5) : "--:--"})` : "اختر شيفت"; }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {shifts.map((shift) => {
                        const start = typeof shift.start_time === "string" ? shift.start_time.slice(0, 5) : "--:--";
                        const end = typeof shift.end_time === "string" ? shift.end_time.slice(0, 5) : "--:--";
                        return (
                          <SelectItem key={String(shift.id)} value={String(shift.id)}>
                            {String(shift.name)} ({start} - {end})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>بداية تطبيق الشيفت</Label>
                  <Input type="date" value={shiftForm.start_date} onChange={(e) => setShift("start_date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>نهاية تطبيق الشيفت</Label>
                  <Input type="date" value={shiftForm.end_date} onChange={(e) => setShift("end_date", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">بيانات العمل</p>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>القسم</Label>
                <Select value={form.department_id} onValueChange={(v) => set("department_id", v || "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر">
                      {() => String(departments.find((d) => String(d.id) === form.department_id)?.name || "اختر")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={String(d.id)} value={String(d.id)}>{String(d.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>المسمى الوظيفي</Label>
                <Input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} placeholder="مشغل ميداني" />
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
                  <SelectTrigger>
                    <SelectValue placeholder="اختر">
                      {() => { const e = employees.find((emp) => String(emp.id) === form.manager_id); return e ? String(e.full_name || e.name) : "اختر"; }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={String(emp.id)} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>المشروع / القناة *</Label>
                <Select value={form.project_id} onValueChange={(value) => setProject(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المشروع">
                      {() => companies.find((c) => c.id === form.project_id)?.name || "اختر المشروع"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">كل المشاريع</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
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
                {filteredLocations.map((location) => {
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
                          name="add-primary-location"
                          checked={primaryLocationId === locationId}
                          onChange={() => choosePrimaryLocation(locationId)}
                        />
                        أساسي
                      </span>
                    </label>
                  );
                })}
                {filteredLocations.length === 0 && (
                  <p className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-sm text-gray-500 sm:col-span-2">
                    اختر مدينة العمل والمشروع لإظهار المواقع المسموحة.
                  </p>
                )}
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
                <Input value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)} placeholder="تحويل بنكي" />
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
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">حساب الدخول</p>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              سيتم إنشاء الموظف وحساب الدخول بحالة نشطة فورًا. المستندات والعقد والتأمينات تُستكمل لاحقًا من تبويب استكمال الملفات ولا تمنع الدخول.
            </div>
            <div className="space-y-2">
              <div className="space-y-2">
                <Label>نوع الحساب *</Label>
                <Select value={accountRole} onValueChange={(value) => setAccountRole(value as EmployeeAccountRole)}>
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => getAccountRoleLabel(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {accountRoleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  يحدد HR كلمة المرور الآن ويستطيع تغييرها أو استبدالها لاحقًا من تعديل الموظف.
                </p>
              </div>
              <div className={twoColumnGridClass}>
                <div className="space-y-2">
                  <Label>كلمة المرور *</Label>
                  <Input
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={accountPassword}
                    onChange={(event) => setAccountPassword(event.target.value)}
                    placeholder="12+ characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label>تأكيد كلمة المرور *</Label>
                  <Input
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={accountPasswordConfirmation}
                    onChange={(event) => setAccountPasswordConfirmation(event.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                يجب أن تحتوي على 12 حرفًا على الأقل وحرف كبير وصغير ورقم. لا تُعرض كلمة المرور بعد الحفظ؛ يستطيع HR فقط استبدالها.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">بيانات الراتب</p>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>الراتب الأساسي</Label>
                <Input type="number" value={form.base_salary} onChange={(e) => set("base_salary", e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>البدلات / المكافآت</Label>
                <Input type="number" value={form.bonus} onChange={(e) => set("bonus", e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className={twoColumnGridClass}>
              <div className="space-y-2">
                <Label>اسم صاحب الحساب</Label>
                <Input value={form.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} placeholder="الاسم حسب البنك" />
              </div>
              <div className="space-y-2">
                <Label>اسم البنك</Label>
                <Select value={form.bank_name} onValueChange={(value) => set("bank_name", value || "")}>
                  <SelectTrigger><SelectValue placeholder="اختر البنك" /></SelectTrigger>
                  <SelectContent>
                    {bankOptions.map((bank) => (
                      <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>رقم الآيبان</Label>
                <Input value={form.iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="SA0000000000000000000000" dir="ltr" />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.full_name}>
            {submitting ? "جاري الإضافة..." : "إضافة الموظف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
