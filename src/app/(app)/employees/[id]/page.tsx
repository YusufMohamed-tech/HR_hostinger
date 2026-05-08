"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmployees, useAttendance } from "@/hooks/use-data";

export default function EmployeeDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: employees } = useEmployees();
  const { data: attendance } = useAttendance();
  const employee = employees.find((item: Record<string, unknown>) => item.id === id);
  const recentAttendance = attendance.filter((row) => row.employee_id === id).slice(0, 3);

  if (!employee) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Employee not found</h1>
        <Button asChild variant="outline">
          <Link href="/employees">Back to employees</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Employee profile and performance summary.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/employees">Back to employees</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="font-medium text-gray-900">{employee.email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="font-medium text-gray-900">{employee.phone}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Employee ID</p>
              <p className="font-medium text-gray-900">{employee.employee_code || employee.id}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">National ID</p>
              <p className="font-medium text-gray-900">{employee.national_id || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <Badge variant="outline" className={employee.status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                {employee.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Work Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Job Title</p>
              <p className="font-medium text-gray-900">{employee.job_title || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Department</p>
              <p className="font-medium text-gray-900">{employee.department?.name || employee.department || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Location</p>
              <p className="font-medium text-gray-900">{employee.location?.name || employee.location || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Employment Type</p>
              <p className="font-medium text-gray-900">{employee.employment_type || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Salary Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Base Salary</p>
              <p className="font-medium text-gray-900">{employee.base_salary ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Bonus</p>
              <p className="font-medium text-gray-900">{employee.bonus ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Deductions</p>
              <p className="font-medium text-gray-900">{employee.deductions ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Payment Method</p>
              <p className="font-medium text-gray-900">{employee.payment_method || "—"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Recent Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentAttendance.length === 0 && (
            <p className="text-sm text-gray-500">No attendance records for this employee.</p>
          )}
          {recentAttendance.map((record) => (
            <div key={record.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{record.status}</p>
                <p className="text-xs text-gray-500">{record.work_date}</p>
              </div>
              <div className="text-xs text-gray-400">{record.check_in_at || "—"}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
