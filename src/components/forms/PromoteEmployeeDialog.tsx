"use client";

import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { useRoleContext } from "@/providers/RoleProvider";
import { useDepartments, useEmployees } from "@/hooks/use-data";
import { updateDepartment } from "@/lib/services/departments";
import { updateEmployee } from "@/lib/services/employees";
import { createCareerEvent } from "@/lib/services/career-events";

interface Props {
  employee: Record<string, unknown>;
  onSuccess: () => void;
  compact?: boolean;
}

function getRecordName(value: unknown, fallback: string | null = "-") {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.full_name === "string" && record.full_name.trim()) return record.full_name;
    if (typeof record.name === "string" && record.name.trim()) return record.name;
  }
  return fallback;
}

export function PromoteEmployeeDialog({ employee, onSuccess, compact = false }: Props) {
  const { currentUser } = useRoleContext();
  const { data: departments } = useDepartments();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    job_title: "",
    department_id: "",
    manager_id: "",
    effective_date: "",
    notes: "",
    assign_department_manager: false,
  });

  const employeeId = String(employee.id || "");
  const employeeName = getRecordName(employee.full_name || employee.name, "الموظف") || "الموظف";
  const currentDepartment = employee.department as Record<string, unknown> | null;
  const currentManager = employee.manager as Record<string, unknown> | null;

  const departmentOptions = useMemo(() => departments || [], [departments]);
  const managerOptions = useMemo(
    () => (employees || []).filter((item) => String(item.id || "") !== employeeId),
    [employeeId, employees]
  );

  useEffect(() => {
    if (!open) return;
    setForm({
      job_title: typeof employee.job_title === "string" ? employee.job_title : "",
      department_id: typeof employee.department_id === "string" ? employee.department_id : "",
      manager_id: typeof employee.manager_id === "string" ? employee.manager_id : "",
      effective_date: new Date().toISOString().split("T")[0],
      notes: "",
      assign_department_manager: false,
    });
    setError("");
  }, [employee, open]);

  const submit = async () => {
    if (!employeeId) return;
    if (!form.job_title.trim()) {
      setError("المسمى الوظيفي الجديد مطلوب.");
      return;
    }
    if (!form.effective_date) {
      setError("تاريخ سريان الترقية مطلوب.");
      return;
    }

    setSubmitting(true);
    setError("");

    const selectedDepartment = departmentOptions.find((department) => String(department.id || "") === form.department_id);
    const selectedManager = managerOptions.find((manager) => String(manager.id || "") === form.manager_id);
    const previousValue = {
      job_title: employee.job_title || null,
      department_id: employee.department_id || null,
      department_name: getRecordName(currentDepartment, null),
      manager_id: employee.manager_id || null,
      manager_name: getRecordName(currentManager, null),
    };
    const newValue = {
      job_title: form.job_title.trim(),
      department_id: form.department_id || null,
      department_name: selectedDepartment ? getRecordName(selectedDepartment) : null,
      manager_id: form.manager_id || null,
      manager_name: selectedManager ? getRecordName(selectedManager) : null,
      assigned_as_department_manager: form.assign_department_manager,
    };

    const updateResult = await updateEmployee(employeeId, {
      job_title: form.job_title.trim(),
      department_id: form.department_id || null,
      manager_id: form.manager_id || null,
    });

    if (updateResult.error) {
      setSubmitting(false);
      setError(updateResult.error.message);
      return;
    }

    if (form.assign_department_manager && form.department_id) {
      const departmentResult = await updateDepartment(form.department_id, {
        manager_employee_id: employeeId,
      });
      if (departmentResult.error) {
        setSubmitting(false);
        setError(departmentResult.error.message);
        return;
      }
    }

    const eventResult = await createCareerEvent({
      employee_id: employeeId,
      event_type: "promoted",
      previous_value: previousValue,
      new_value: newValue,
      effective_date: form.effective_date,
      notes: form.notes.trim() || `ترقية ${employeeName} إلى ${form.job_title.trim()}`,
      created_by: currentUser?.id,
    });

    setSubmitting(false);
    if (eventResult.error) {
      setError(eventResult.error.message);
      return;
    }

    setOpen(false);
    setMessage("تم حفظ الترقية وتسجيلها في المسيرة الوظيفية.");
    onSuccess();
  };

  return (
    <>
      <MessageDialog open={Boolean(message)} onOpenChange={(nextOpen) => !nextOpen && setMessage("")} description={message} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size={compact ? "icon-xs" : "sm"}
              className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
              aria-label={compact ? "ترقية" : undefined}
            />
          }
        >
          <TrendingUp className={compact ? "h-3.5 w-3.5" : "h-4 w-4 ml-1"} />
          {!compact && "ترقية"}
        </DialogTrigger>
        <DialogContent dir="rtl" className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>ترقية موظف</DialogTitle>
            <DialogDescription>
              حدّث المسمى أو القسم أو المدير، وسيتم تسجيل التغيير تلقائيًا في المسيرة الوظيفية.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>الموظف</Label>
              <Input value={employeeName} disabled />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>المسمى الوظيفي الجديد *</Label>
                <Input
                  value={form.job_title}
                  onChange={(event) => setForm((prev) => ({ ...prev, job_title: event.target.value }))}
                  placeholder="مثال: مدير منطقة"
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ السريان *</Label>
                <Input
                  type="date"
                  value={form.effective_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, effective_date: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>القسم الجديد</Label>
                <Select value={form.department_id} onValueChange={(value) => setForm((prev) => ({ ...prev, department_id: value || "" }))}>
                  <SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger>
                  <SelectContent>
                    {departmentOptions.map((department) => (
                      <SelectItem key={String(department.id)} value={String(department.id)}>
                        {getRecordName(department, "قسم")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>المدير المباشر الجديد</Label>
                <Select value={form.manager_id} onValueChange={(value) => setForm((prev) => ({ ...prev, manager_id: value || "" }))}>
                  <SelectTrigger><SelectValue placeholder="اختر المدير" /></SelectTrigger>
                  <SelectContent>
                    {managerOptions.map((manager) => (
                      <SelectItem key={String(manager.id)} value={String(manager.id)}>
                        {getRecordName(manager, "مدير")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={form.assign_department_manager}
                onChange={(event) => setForm((prev) => ({ ...prev, assign_department_manager: event.target.checked }))}
                disabled={!form.department_id}
              />
              تعيينه كمدير لهذا القسم أيضًا
            </label>
            <div className="space-y-2">
              <Label>ملاحظات الترقية</Label>
              <Input
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="مثال: ترقية بعد تقييم الأداء"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={submit} disabled={submitting}>
              {submitting ? "جار الحفظ..." : "حفظ الترقية"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
