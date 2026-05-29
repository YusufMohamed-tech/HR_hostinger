"use client";

import React from "react";
import { Trash2, Layers as LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteDepartment } from "@/lib/services/departments";
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

export default function DepartmentsPage() {
  const { currentUser } = useRoleContext();
  const { data: departments, loading, refetch } = useDepartments();
  const { data: employees } = useEmployees();
  const canManageDepartments = ["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "");

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
                        <Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark">عرض</Button>
                        {canManageDepartments && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (!confirm(`Delete ${deptName}?`)) return;
                              await deleteDepartment(deptId);
                              refetch();
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
