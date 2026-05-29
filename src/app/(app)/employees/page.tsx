"use client";

import React from "react";
import Link from "next/link";
import { Search, Trash2, Users } from "lucide-react";
import { deleteEmployee } from "@/lib/services/employees";
import { EditEmployeeDialog } from "@/components/forms/EditEmployeeDialog";
import { Button } from "@/components/ui/button";
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

  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("الكل");

  const uniqueDepartments = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach(emp => {
      const empRecord = emp as Record<string, unknown>;
      const department = (empRecord.department ?? null) as Record<string, unknown> | null;
      const departmentName = typeof department?.name === "string" ? department.name : typeof empRecord.department === "string" ? empRecord.department : "-";
      if (departmentName !== "-") depts.add(departmentName);
    });
    return ["الكل", ...Array.from(depts)];
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
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
  }, [employees, searchQuery, departmentFilter]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الموظفون</h1>
          <p className="text-gray-500 text-sm mt-1">
            إدارة بيانات الموظفين، مواقع العمل، الأقسام، والرواتب.
          </p>
        </div>

        {["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "") && (
          <AddEmployeeDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row p-4 border-b gap-4 items-center justify-between">
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

          <Table>
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
                  <TableRow key={empId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{empName}</span>
                        <span className="text-xs text-gray-500">{empEmail}</span>
                        <span className="text-xs text-gray-400 mt-0.5">{empCode}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          empStatus === "Active"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        {statusLabels[empStatus] || empStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{jobTitle}</TableCell>
                    <TableCell className="text-gray-600">{departmentName}</TableCell>
                    <TableCell className="text-gray-600">{locationName}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "") && (
                          <EditEmployeeDialog employee={emp} onSuccess={refetch} />
                        )}
                        <Button asChild variant="ghost" size="sm" className="text-brand hover:text-brand-dark">
                          <Link href={`/employees/${empId}`}>عرض</Link>
                        </Button>
                        {["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (!confirm(`حذف ${empName}؟`)) return;
                              await deleteEmployee(empId);
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
