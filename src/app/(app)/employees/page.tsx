"use client";

import React from "react";
import Link from "next/link";
import { Eye, Search, Trash2, Users } from "lucide-react";
import { deleteEmployee } from "@/lib/services/employees";
import { EditEmployeeDialog } from "@/components/forms/EditEmployeeDialog";
import { PromoteEmployeeDialog } from "@/components/forms/PromoteEmployeeDialog";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/feedback-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRoleContext } from "@/providers/RoleProvider";
import { useEmployees } from "@/hooks/use-data";
import { AddEmployeeDialog } from "@/components/forms/AddEmployeeDialog";
import { PageSkeleton } from "@/components/Skeletons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";

const statusLabels: Record<string, string> = {
  Active: "نشط",
  Inactive: "غير نشط",
  "On Leave": "في إجازة",
};

export default function EmployeesPage() {
  const { currentUser } = useRoleContext();
  const { data: employees, loading, refetch } = useEmployees();
  const isManagerView = currentUser?.role === "Training_Manager";
  const canManageEmployees = ["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "");
  const scopedEmployees = useMemo(() => {
    const hideOwnInternalProfile = ["Admin", "HR_Admin", "HR_Recruitment"].includes(currentUser?.role || "");
    const visibleEmployees = hideOwnInternalProfile
      ? employees.filter((emp) => String((emp as Record<string, unknown>).id || "") !== currentUser?.employeeId)
      : employees;

    if (!isManagerView) return visibleEmployees;
    return visibleEmployees.filter((emp) => String((emp as Record<string, unknown>).manager_id || "") === currentUser?.employeeId);
  }, [currentUser?.employeeId, currentUser?.role, employees, isManagerView]);

  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("الكل");

  const uniqueDepartments = useMemo(() => {
    const depts = new Set<string>();
    scopedEmployees.forEach(emp => {
      const empRecord = emp as Record<string, unknown>;
      const department = (empRecord.department ?? null) as Record<string, unknown> | null;
      const departmentName = typeof department?.name === "string" ? department.name : typeof empRecord.department === "string" ? empRecord.department : "-";
      if (departmentName !== "-") depts.add(departmentName);
    });
    return ["الكل", ...Array.from(depts)];
  }, [scopedEmployees]);

  const filteredEmployees = useMemo(() => {
    return scopedEmployees.filter((emp) => {
      const empRecord = emp as Record<string, unknown>;
      const empName = typeof empRecord.full_name === "string" ? empRecord.full_name : typeof empRecord.name === "string" ? empRecord.name : "";
      const empEmail = typeof empRecord.email === "string" ? empRecord.email : "";
      const empCode = typeof empRecord.employee_code === "string" ? empRecord.employee_code : String(empRecord.id ?? "");
      const department = (empRecord.department ?? null) as Record<string, unknown> | null;
      const departmentName = typeof department?.name === "string" ? department.name : typeof empRecord.department === "string" ? empRecord.department : "-";
      
      const matchesSearch = empName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            empEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            empCode.toLowerCase().includes(searchQuery.toLowerCase());
                            
      const matchesDept = departmentFilter === "الكل" || departmentName === departmentFilter;
      
      return matchesSearch && matchesDept;
    });
  }, [scopedEmployees, searchQuery, departmentFilter]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الموظفون</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isManagerView
              ? "متابعة الموظفين المعينين لك من HR ومراجعة بياناتهم الأساسية."
              : "إدارة بيانات الموظفين، مواقع العمل، الأقسام، والرواتب."}
          </p>
        </div>

        {canManageEmployees && (
          <AddEmployeeDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="overflow-hidden border border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row p-3 border-b gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input
                type="search"
                placeholder="ابحث عن موظف..."
                className="pr-9 bg-gray-50 border-gray-200 focus-visible:ring-brand"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Select value={departmentFilter} onValueChange={(val) => setDepartmentFilter(val || "الكل")}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="القسم" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueDepartments.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table className="table-fixed text-[13px] [&_td]:border-l [&_td]:border-gray-100 [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-[13px] [&_td]:leading-tight [&_td]:whitespace-normal [&_td:last-child]:border-l-0 [&_th]:h-8 [&_th]:border-l [&_th]:border-gray-100 [&_th]:px-2 [&_th]:text-xs [&_th:last-child]:border-l-0">
            <colgroup>
              <col className="w-[27%]" />
              <col className="w-[8%]" />
              <col className="w-[18%]" />
              <col className="w-[15%]" />
              <col className="w-[19%]" />
              <col className="w-[13%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">بيانات الموظف</TableHead>
                <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                <TableHead className="font-semibold text-gray-600">الوظيفة</TableHead>
                <TableHead className="font-semibold text-gray-600">القسم</TableHead>
                <TableHead className="font-semibold text-gray-600">الموقع الأساسي</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.map((emp) => {
                const empRecord = emp as Record<string, unknown>;
                const empId = String(empRecord.id ?? "");
                const empName = typeof empRecord.full_name === "string"
                  ? empRecord.full_name
                  : typeof empRecord.name === "string"
                    ? empRecord.name
                    : "-";
                const empEmail = typeof empRecord.email === "string" ? empRecord.email : "-";
                const empCode = typeof empRecord.employee_code === "string" ? empRecord.employee_code : empId;
                const empStatus = typeof empRecord.status === "string" ? empRecord.status : "Active";
                const jobTitle = typeof empRecord.job_title === "string" ? empRecord.job_title : "-";
                const department = (empRecord.department ?? null) as Record<string, unknown> | null;
                const departmentName = typeof department?.name === "string"
                  ? department.name
                  : typeof empRecord.department === "string"
                    ? empRecord.department
                    : "-";
                const location = (empRecord.location ?? null) as Record<string, unknown> | null;
                const locationName = typeof location?.name === "string"
                  ? location.name
                  : typeof empRecord.location === "string"
                    ? empRecord.location
                    : "-";

                return (
                  <TableRow key={empId} className="h-[58px] hover:bg-brand-light/20">
                    <TableCell>
                      <div className="min-w-0">
                        <span className="block truncate font-semibold text-gray-900" title={empName}>{empName}</span>
                        <span className="block truncate text-[12px] text-gray-500" title={empEmail}>{empEmail}</span>
                        <span className="block truncate text-[11px] text-gray-400" title={empCode}>{empCode}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          empStatus === "Active"
                            ? "h-6 rounded px-2 text-[11px] bg-green-50 text-green-700 border-green-200"
                            : "h-6 rounded px-2 text-[11px] bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        {statusLabels[empStatus] || empStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <span className="block truncate" title={jobTitle}>{jobTitle}</span>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <span className="block truncate" title={departmentName}>{departmentName}</span>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <span className="block truncate" title={locationName}>{locationName}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {canManageEmployees && (
                          <PromoteEmployeeDialog employee={emp} onSuccess={refetch} compact />
                        )}
                        {canManageEmployees && (
                          <EditEmployeeDialog employee={emp} onSuccess={refetch} compact />
                        )}
                        <Button asChild variant="ghost" size="icon-xs" className="overflow-hidden text-brand hover:text-brand-dark" aria-label="View employee">
                          <Link href={`/employees/${empId}`}>
                            <Eye className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        {canManageEmployees && (
                          <ConfirmActionButton
                            variant="ghost"
                            size="icon-xs"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            title="حذف الموظف"
                            description={`سيتم حذف الموظف ${empName}. هل تريد المتابعة؟`}
                            confirmLabel="حذف"
                            destructive
                            onConfirm={async () => {
                              if (!currentUser?.orgId) return;
                              await deleteEmployee(currentUser.orgId, empId);
                              refetch();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </ConfirmActionButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredEmployees.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">لا يوجد موظفون</p>
              <p className="text-xs text-gray-500 mt-1">غيّر البحث أو الفلتر للوصول للنتيجة المطلوبة.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
