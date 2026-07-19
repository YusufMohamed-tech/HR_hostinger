"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEmployees, useAttendance } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { 
  getEmployeeDocuments, 
  getEmployeeSalaryHistory, 
  getEmployeeKpis, 
  getEmployeeReviews, 
  getEmployeeActions 
} from "@/lib/services/employee-details";
import { useEffect, useState } from "react";

import { getEmployeeAssets } from "@/lib/services/assets";
import { getFinancialBalances } from "@/lib/services/financial";
import { getLeaveBalances } from "@/lib/services/leaves";
import { getEmployeeCareerEvents } from "@/lib/services/career-events";
import { formatCurrency } from "@/lib/utils/currency";

const careerEventLabels: Record<string, string> = {
  hired: "تم التعيين",
  hired_as_trainee: "بدأ كمتدرب",
  promoted: "ترقية",
  role_change: "تغيير وظيفي",
  status_change: "تغيير الحالة",
  department_change: "تغيير القسم",
  location_change: "تغيير الموقع",
};

export default function EmployeeDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: employees } = useEmployees();
  const { data: attendance } = useAttendance();
  const employee = employees.find((item: Record<string, unknown>) => item.id === id);
  const employeeRecord = employee as Record<string, unknown> | undefined;
  const employeeId = String(employeeRecord?.id ?? id);
  const recentAttendance = attendance.filter((row) => String(row.employee_id ?? "") === employeeId).slice(0, 3);
  
  const { currentUser } = useRoleContext();
  const [details, setDetails] = useState({
    documents: [] as Record<string, unknown>[],
    salaryHistory: [] as Record<string, unknown>[],
    kpis: [] as Record<string, unknown>[],
    reviews: [] as Record<string, unknown>[],
    actions: [] as Record<string, unknown>[],
    assets: [] as Record<string, unknown>[],
    financials: [] as Record<string, unknown>[],
    careerEvents: [] as Record<string, unknown>[]
  });
  const [currentLeaveBalance, setCurrentLeaveBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!currentUser?.orgId || !employeeId) return;
    async function fetchDetails() {
      const [docs, salary, kpis, reviews, actions, assets, financials, careerEvents] = await Promise.all([
        getEmployeeDocuments(currentUser?.orgId as string, employeeId),
        getEmployeeSalaryHistory(currentUser?.orgId as string, employeeId),
        getEmployeeKpis(currentUser?.orgId as string, employeeId),
        getEmployeeReviews(currentUser?.orgId as string, employeeId),
        getEmployeeActions(currentUser?.orgId as string, employeeId),
        getEmployeeAssets(currentUser?.orgId as string, employeeId),
        getFinancialBalances(currentUser?.orgId as string, employeeId),
        getEmployeeCareerEvents(employeeId)
      ]);
      setDetails({
        documents: docs.data || [],
        salaryHistory: salary.data || [],
        kpis: kpis.data || [],
        reviews: reviews.data || [],
        actions: actions.data || [],
        assets: assets.data || [],
        financials: financials.data || [],
        careerEvents: careerEvents.data || []
      });
      const balances = await getLeaveBalances(currentUser?.orgId as string, employeeId);
      const balance = (balances.data?.[0] ?? null) as Record<string, unknown> | null;
      setCurrentLeaveBalance(Number(balance?.vacation_remaining || 0));
    }
    fetchDetails();
  }, [currentUser?.orgId, employeeId, employeeRecord, id]);

  const employeeName = typeof employeeRecord?.full_name === "string"
    ? employeeRecord.full_name
    : typeof employeeRecord?.name === "string"
      ? employeeRecord.name
      : "Employee";
  const employeeEmail = typeof employeeRecord?.email === "string" ? employeeRecord.email : "—";
  const employeePhone = typeof employeeRecord?.phone === "string" ? employeeRecord.phone : "—";
  const employeeCode = typeof employeeRecord?.employee_code === "string" ? employeeRecord.employee_code : employeeId;
  const nationalId = typeof employeeRecord?.national_id === "string" ? employeeRecord.national_id : "—";
  const status = typeof employeeRecord?.status === "string" ? employeeRecord.status : "Active";
  const jobTitle = typeof employeeRecord?.job_title === "string" ? employeeRecord.job_title : "—";
  const employmentType = typeof employeeRecord?.employment_type === "string" ? employeeRecord.employment_type : "—";

  const department = (employeeRecord?.department ?? null) as Record<string, unknown> | null;
  const departmentName = typeof department?.name === "string"
    ? department.name
    : typeof employeeRecord?.department === "string"
      ? employeeRecord.department
      : "—";
  const location = (employeeRecord?.location ?? null) as Record<string, unknown> | null;
  const locationName = typeof location?.name === "string"
    ? location.name
    : typeof employeeRecord?.location === "string"
      ? employeeRecord.location
      : "—";

  const baseSalary = typeof employeeRecord?.base_salary === "number" ? employeeRecord.base_salary : 0;
  const bonus = typeof employeeRecord?.bonus === "number" ? employeeRecord.bonus : 0;
  const deductions = typeof employeeRecord?.deductions === "number" ? employeeRecord.deductions : 0;
  const paymentMethod = typeof employeeRecord?.payment_method === "string" ? employeeRecord.payment_method : "—";

  const leaveBalance = currentLeaveBalance ?? 0;

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
          <h1 className="text-2xl font-bold tracking-tight">{employeeName}</h1>
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
              <p className="font-medium text-gray-900">{employeeEmail}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="font-medium text-gray-900">{employeePhone}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Employee ID</p>
              <p className="font-medium text-gray-900">{employeeCode}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">National ID</p>
              <p className="font-medium text-gray-900">{nationalId}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <Badge variant="outline" className={status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                {status}
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
              <p className="font-medium text-gray-900">{jobTitle}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Department</p>
              <p className="font-medium text-gray-900">{departmentName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Location</p>
              <p className="font-medium text-gray-900">{locationName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Employment Type</p>
              <p className="font-medium text-gray-900">{employmentType}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">رصيد الإجازات الحالي</p>
              <p className="font-medium text-gray-900">{Number(leaveBalance).toFixed(2)} يوم</p>
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
              <p className="font-medium text-gray-900">{formatCurrency(baseSalary)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Bonus</p>
              <p className="font-medium text-gray-900">{bonus}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Deductions</p>
              <p className="font-medium text-gray-900">{deductions}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Payment Method</p>
              <p className="font-medium text-gray-900">{paymentMethod}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>المسيرة الوظيفية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {details.careerEvents.length === 0 ? (
            <p className="text-sm text-gray-500">لا توجد أحداث وظيفية مسجلة بعد.</p>
          ) : (
            <div className="space-y-3">
              {details.careerEvents.map((event) => {
                const type = String(event.event_type || "");
                const creator = (event.creator ?? null) as Record<string, unknown> | null;
                const previousValue = event.previous_value ? JSON.stringify(event.previous_value) : "—";
                const newValue = event.new_value ? JSON.stringify(event.new_value) : "—";
                return (
                  <div key={String(event.id)} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{careerEventLabels[type] || type}</p>
                        <p className="mt-1 text-xs text-gray-500">{String(event.notes || "")}</p>
                      </div>
                      <Badge variant="outline">{String(event.effective_date || "—")}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-600 md:grid-cols-2">
                      <div className="rounded-md bg-gray-50 p-2">
                        <span className="font-semibold">قبل: </span>{previousValue}
                      </div>
                      <div className="rounded-md bg-green-50 p-2 text-green-800">
                        <span className="font-semibold">بعد: </span>{newValue}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      بواسطة {String(creator?.full_name || creator?.email || "النظام")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Recent Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentAttendance.length === 0 && (
            <p className="text-sm text-gray-500">No attendance records for this employee.</p>
          )}
          {recentAttendance.map((record) => {
            const recordStatus = typeof record.status === "string" ? record.status : "present";
            const workDate = typeof record.work_date === "string" ? record.work_date : "—";
            const checkInAt = typeof record.check_in_at === "string" ? record.check_in_at : "—";
            return (
              <div key={String(record.id)} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{recordStatus}</p>
                  <p className="text-xs text-gray-500">{workDate}</p>
                </div>
                <div className="text-xs text-gray-400">{checkInAt}</div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {details.documents.length === 0 ? (
              <p className="text-sm text-gray-500">No documents found.</p>
            ) : (
              details.documents.map((doc: Record<string, unknown>) => (
                <div key={String(doc.id)} className="flex justify-between items-center text-sm border-b pb-2 border-gray-100">
                  <span className="font-medium text-gray-700">{String(doc.file_name)}</span>
                  <Badge variant="outline">{String(doc.doc_type)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Warnings & Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {details.actions.length === 0 ? (
              <p className="text-sm text-gray-500">No actions recorded.</p>
            ) : (
              details.actions.map((act: Record<string, unknown>) => (
                <div key={String(act.id)} className="flex justify-between items-center text-sm border-b pb-2 border-gray-100">
                  <span className="font-medium text-gray-700">{String(act.reason)}</span>
                  <Badge variant="outline" className={act.action_type === 'warning' ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50'}>{String(act.action_type)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Asset Handover</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {details.assets.length === 0 ? (
              <p className="text-sm text-gray-500">No assets assigned yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.assets.map((asset) => (
                      <TableRow key={String(asset.id)}>
                        <TableCell className="font-medium">{String(asset.asset_type)}</TableCell>
                        <TableCell>{String(asset.serial_number || 'N/A')}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={asset.status === 'assigned' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-700'}>
                            {String(asset.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Financial Balances & Deficits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {details.financials.length === 0 ? (
              <p className="text-sm text-gray-500">No financial deficits recorded.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.financials.map((fin) => (
                      <TableRow key={String(fin.id)}>
                        <TableCell className="font-medium">{String(fin.transaction_type)}</TableCell>
                        <TableCell>{formatCurrency(fin.amount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={fin.status === 'pending' ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}>
                            {String(fin.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
