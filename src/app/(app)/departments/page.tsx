"use client";

import React, { useState } from "react";
import { Trash2, Layers as LayersIcon, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/feedback-dialog";
import { deleteDepartment, setDepartmentMembers } from "@/lib/services/departments";
import { EditDepartmentDialog } from "@/components/forms/EditDepartmentDialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDepartments, useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddDepartmentDialog } from "@/components/forms/AddDepartmentDialog";
import { PageSkeleton } from "@/components/Skeletons";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DepartmentsPage() {
  const { currentUser } = useRoleContext();
  const { data: departments, loading, refetch } = useDepartments();
  const { data: employees, refetch: refetchEmployees } = useEmployees();
  const canManageDepartments = ["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "");
  const hideOwnInternalProfile = ["Admin", "HR_Admin", "HR_Recruitment"].includes(currentUser?.role || "");
  const assignableEmployees = hideOwnInternalProfile
    ? employees.filter((emp) => String((emp as Record<string, unknown>).id || "") !== currentUser?.employeeId)
    : employees;

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الأقسام</h1>
          <p className="text-gray-500 text-sm mt-1">
            Define teams, leadership, and coverage needs.
          </p>
        </div>

        {canManageDepartments && (
          <AddDepartmentDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">القسم</TableHead>
                <TableHead className="font-semibold text-gray-600">مدير القسم</TableHead>
                <TableHead className="font-semibold text-gray-600">عدد الموظفين</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((dept) => {
                const deptRecord = dept as Record<string, unknown>;
                const deptId = String(deptRecord.id ?? "");
                const deptName = typeof deptRecord.name === "string" ? deptRecord.name : "—";
                const manager = (deptRecord.manager ?? null) as Record<string, unknown> | null;
                const managerName = typeof manager?.full_name === "string" ? manager.full_name : "—";
                const headcount = employees.filter((emp) => {
                  const empRecord = emp as Record<string, unknown>;
                  return String(empRecord.department_id ?? "") === deptId;
                }).length;

                return (
                  <TableRow key={deptId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{deptName}</span>
                        <span className="text-xs text-gray-400">{deptId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">{managerName}</TableCell>
                    <TableCell className="text-gray-600">{headcount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canManageDepartments && (
                          <EditDepartmentDialog department={dept} onSuccess={refetch} />
                        )}
                        {canManageDepartments ? (
                          <ManageDepartmentMembersDialog
                            orgId={currentUser?.orgId || ""}
                            department={deptRecord}
                            employees={assignableEmployees}
                            onSuccess={() => {
                              refetch();
                              refetchEmployees();
                            }}
                          />
                        ) : (
                          <Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark">عرض</Button>
                        )}
                        {canManageDepartments && (
                          <ConfirmActionButton
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            title="حذف القسم"
                            description={`سيتم حذف قسم ${deptName}. هل تريد المتابعة؟`}
                            confirmLabel="حذف"
                            destructive
                            onConfirm={async () => {
                              await deleteDepartment(deptId, Number(deptRecord.version || 1));
                              refetch();
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </ConfirmActionButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {departments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <LayersIcon className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">لا توجد أقسام بعد</p>
              <p className="text-xs text-gray-500 mt-1">أنشئ أول قسم لتنظيم الفرق.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ManageDepartmentMembersDialog({
  orgId,
  department,
  employees,
  onSuccess,
}: {
  orgId: string;
  department: Record<string, unknown>;
  employees: Record<string, unknown>[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const departmentId = String(department.id || "");
  const departmentName = String(department.name || "القسم");
  const currentManagerId = String(department.manager_employee_id || "");
  const [managerId, setManagerId] = useState(currentManagerId || "__none");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setManagerId(currentManagerId || "__none");
    setSelectedEmployeeIds(
      employees
        .filter((employee) => String(employee.department_id || "") === departmentId)
        .map((employee) => String(employee.id || ""))
        .filter(Boolean)
    );
    setError("");
  }, [currentManagerId, departmentId, employees, open]);

  const selectedSet = new Set(selectedEmployeeIds);
  const resolvedManagerId = managerId === "__none" ? "" : managerId;

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");

    const finalMembers = new Set(selectedEmployeeIds);
    if (resolvedManagerId) finalMembers.add(resolvedManagerId);

    if (!orgId) {
      setError("Organization context is required.");
      setSubmitting(false);
      return;
    }

    const result = await setDepartmentMembers(departmentId, Number(department.version || 1),
      resolvedManagerId || null, [...finalMembers]);
    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark" />}>
        <UserPlus className="w-3.5 h-3.5 mr-1" />
        إدارة الأعضاء
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>إدارة أعضاء {departmentName}</DialogTitle>
          <DialogDescription>حدد مدير القسم والموظفين المرتبطين بهذا القسم.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          <div className="space-y-2">
            <Label>مدير القسم</Label>
            <Select value={managerId} onValueChange={(value) => setManagerId(value || "__none")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر المدير" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">بدون مدير</SelectItem>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name || employee.email || "موظف")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>موظفو القسم</Label>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
              {employees.map((employee) => {
                const employeeId = String(employee.id || "");
                const employeeName = String(employee.full_name || employee.name || "موظف");
                const employeeEmail = String(employee.email || "");
                const isChecked = selectedSet.has(employeeId) || resolvedManagerId === employeeId;

                return (
                  <label
                    key={employeeId}
                    className="flex cursor-pointer items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900">{employeeName}</span>
                      {employeeEmail && <span className="text-xs text-gray-500">{employeeEmail}</span>}
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={isChecked}
                      disabled={resolvedManagerId === employeeId}
                      onChange={() => toggleEmployee(employeeId)}
                    />
                  </label>
                );
              })}
              {employees.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-500">لا توجد موظفين متاحين.</div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "جارٍ الحفظ..." : "حفظ التعيين"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
