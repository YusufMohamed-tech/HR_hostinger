"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoleContext } from "@/providers/RoleProvider";
import { useEmployees, useLeaveRequests, useLeaveBalances } from "@/hooks/use-data";
import {
  adjustLeaveBalance,
  advanceLeaveApproval,
  createLeaveRequest,
  ensureEmployeeLeaveBalance,
  getLeaveApprovalManagerId,
  getLeaveBalanceTransactions,
} from "@/lib/services/leaves";
import { notifyLeaveDecision } from "@/lib/services/notification-triggers";
import { PageSkeleton } from "@/components/Skeletons";
import { AttachmentLink } from "@/components/AttachmentLink";
import { getValidationMessage, leaveRequestFormSchema } from "@/lib/validation";
import { inclusiveDays, leaveTypeLabels, leaveTypeOptions, leaveTypeRequiresAttachment } from "@/lib/hr-options";

const statusStyle: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

const statusLabels: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمدة",
  rejected: "مرفوضة",
};

function getWorkflowStageLabel(request: Record<string, unknown>) {
  const status = typeof request.status === "string" ? request.status : "pending";
  const currentStep = Number(request.current_step || 1);
  const managerStatus = typeof request.manager_approval_status === "string" ? request.manager_approval_status : "pending";
  const hrStatus = typeof request.hr_approval_status === "string" ? request.hr_approval_status : "pending";

  if (status === "approved") return "تم الاعتماد";
  if (status === "rejected") {
    if (managerStatus === "rejected") return "مرفوض من المدير";
    if (hrStatus === "rejected") return "مرفوض من HR";
    return "مرفوض";
  }
  if (currentStep <= 1) return "بانتظار المدير";
  return "بانتظار HR";
}

export default function LeavePage() {
  const searchParams = useSearchParams();
  const { currentUser } = useRoleContext();
  const [employeeSearch, setEmployeeSearch] = useState("");
  const { data: leaveRequests, loading, refetch } = useLeaveRequests();
  const { data: employees } = useEmployees();
  const role = currentUser?.role || "";
  const isHRAdmin = role === "HR_Admin";
  const isTrainingManager = role === "Training_Manager";
  const isSalesManager = role === "Sales_Manager";
  const isApprover = ["Superadmin", "Admin", "HR_Admin", "Training_Manager", "Sales_Manager"].includes(role);
  const isSelfServiceView = !isApprover || ((isHRAdmin || isTrainingManager || isSalesManager) && searchParams.get("view") === "mine");
  const { data: balances, refetch: refetchBalances } = useLeaveBalances(isSelfServiceView ? currentUser?.employeeId : undefined);
  const canApprove = isApprover && !isSelfServiceView;
  const isOwnRequest = (req: Record<string, unknown>) => String(req.employee_id ?? "") === currentUser?.employeeId;
  const isManagedRequest = (req: Record<string, unknown>) => {
    const employee = (req.employee ?? null) as Record<string, unknown> | null;
    return Boolean(currentUser?.employeeId && getLeaveApprovalManagerId(employee) === currentUser.employeeId);
  };
  const isHrReviewableRequest = (req: Record<string, unknown>) => {
    const currentStep = Number(req.current_step || 1);
    const status = typeof req.status === "string" ? req.status : "pending";
    return currentStep >= 2 || status !== "pending";
  };
  const visibleRequests = isSelfServiceView
    ? leaveRequests.filter((req) => isOwnRequest(req as Record<string, unknown>))
    : isHRAdmin
      ? leaveRequests.filter((req) => !isOwnRequest(req as Record<string, unknown>) && isHrReviewableRequest(req as Record<string, unknown>))
      : role === "Training_Manager"
        ? leaveRequests.filter((req) => isManagedRequest(req as Record<string, unknown>))
        : role === "Sales_Manager"
          ? leaveRequests.filter((req) => {
              const requesterRole = String((req as Record<string, unknown>).requester_role || "");
              return requesterRole === "Sales";
            })
        : leaveRequests;
  const balance = (balances[0] ?? null) as Record<string, unknown> | null;
  const sickRemaining = typeof balance?.sick_remaining === "number" ? balance.sick_remaining : 0;
  const vacationRemaining = typeof balance?.vacation_remaining === "number" ? balance.vacation_remaining : 0;
  const emergencyRemaining = typeof balance?.emergency_remaining === "number" ? balance.emergency_remaining : 0;
  const pageTitle = isSelfServiceView ? "طلب إجازتي" : "طلبات الإجازات";
  const pageDescription = isSelfServiceView
    ? isHRAdmin
      ? "إرسال طلب إجازة لاعتماد المشرف العام ومتابعة حالته."
      : "إرسال طلبات الإجازة الخاصة بك ومتابعة حالتها."
    : "تقديم طلبات الإجازة واعتمادها ومتابعتها.";
  const emptyTitle = isSelfServiceView ? "لا توجد طلبات إجازة خاصة بك بعد" : "لا توجد طلبات إجازة بعد";
  const emptyDescription = isSelfServiceView ? "أرسل طلبًا جديدًا ليظهر هنا." : "أرسل طلبًا للبدء.";
  const todayIso = new Date().toISOString().split("T")[0];
  const employeesOnLeaveIds = new Set(
    leaveRequests
      .filter((request) => {
        const record = request as Record<string, unknown>;
        return String(record.status || "") === "approved"
          && String(record.start_date || "") <= todayIso
          && String(record.end_date || "") >= todayIso;
      })
      .map((request) => String((request as Record<string, unknown>).employee_id || ""))
      .filter(Boolean)
  );
  const traineesCount = employees.filter((employee) => String(employee.employment_type || "") === "intern").length;
  const probationCount = employees.filter((employee) => {
    const hiringDate = typeof employee.hiring_date === "string" ? new Date(employee.hiring_date) : null;
    if (!hiringDate || Number.isNaN(hiringDate.getTime())) return false;
    const elapsedDays = Math.floor((Date.now() - hiringDate.getTime()) / 86400000);
    return elapsedDays >= 0 && elapsedDays <= 180;
  }).length;
  const jobTitleSummary = Object.entries(
    employees.reduce<Record<string, number>>((acc, employee) => {
      const title = String(employee.job_title || "بدون مسمى");
      acc[title] = (acc[title] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const canReviewLeaveRequest = (reqRecord: Record<string, unknown>) => {
    const currentStep = Number(reqRecord.current_step || 1);
    const status = typeof reqRecord.status === "string" ? reqRecord.status : "pending";
    const canReviewCurrentStep = role === "Admin"
      || role === "Superadmin"
      || (role === "Training_Manager" && currentStep <= 1 && isManagedRequest(reqRecord))
      || (role === "Sales_Manager" && currentStep <= 1)
      || (role === "HR_Admin" && currentStep >= 2);

    return canApprove
      && status === "pending"
      && !isOwnRequest(reqRecord)
      && canReviewCurrentStep;
  };
  const requestsByEmployeeId = visibleRequests.reduce<Map<string, Record<string, unknown>[]>>((map, request) => {
    const employeeId = String((request as Record<string, unknown>).employee_id || "");
    if (!employeeId) return map;
    const current = map.get(employeeId) || [];
    current.push(request as Record<string, unknown>);
    map.set(employeeId, current);
    return map;
  }, new Map());
  const balancesByEmployeeId = new Map<string, Record<string, unknown>>(
    balances.map((employeeBalance) => [String(employeeBalance.employee_id || ""), employeeBalance])
  );
  const visibleRequestEmployeeIds = new Set(requestsByEmployeeId.keys());
  const employeeProfilePool = isSelfServiceView
    ? []
    : role === "Training_Manager"
      ? employees.filter((employee) => getLeaveApprovalManagerId(employee) === currentUser?.employeeId || visibleRequestEmployeeIds.has(String(employee.id || "")))
      : role === "Sales_Manager"
        ? employees.filter((employee) => {
            const jobTitle = String(employee.job_title || "").toLowerCase();
            return visibleRequestEmployeeIds.has(String(employee.id || "")) || jobTitle.includes("sales") || jobTitle.includes("مبيعات");
          })
        : employees;
  const normalizedEmployeeSearch = employeeSearch.trim().toLowerCase();
  const leaveProfileEmployees = employeeProfilePool
    .filter((employee) => {
      if (!normalizedEmployeeSearch) return true;
      const searchable = [
        employee.full_name,
        employee.name,
        employee.email,
        employee.employee_code,
        employee.job_title,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return searchable.includes(normalizedEmployeeSearch);
    })
    .sort((first, second) => {
      const firstPending = (requestsByEmployeeId.get(String(first.id || "")) || []).filter((request) => String(request.status || "") === "pending").length;
      const secondPending = (requestsByEmployeeId.get(String(second.id || "")) || []).filter((request) => String(request.status || "") === "pending").length;
      if (firstPending !== secondPending) return secondPending - firstPending;
      return String(first.full_name || first.name || "").localeCompare(String(second.full_name || second.name || ""), "ar");
    });

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
          <p className="text-gray-500 text-sm mt-1">{pageDescription}</p>
        </div>
        {isSelfServiceView && (
          <CreateLeaveDialog
            onSuccess={refetch}
            description={isHRAdmin ? "إرسال طلب إجازة لاعتماد المشرف العام." : undefined}
          />
        )}
      </div>

      {isSelfServiceView && balances.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardContent className="py-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">رصيد مرضية</p>
              <p className="font-semibold text-gray-900">{sickRemaining} يوم</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">رصيد سنوية</p>
              <p className="font-semibold text-gray-900">{vacationRemaining} يوم</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">رصيد طارئة</p>
              <p className="font-semibold text-gray-900">{emergencyRemaining} يوم</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isSelfServiceView && (role === "Admin" || role === "HR_Admin" || role === "Superadmin") && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-none shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs text-gray-500">المتدربون الحاليون</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{traineesCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs text-gray-500">موظفون في إجازة اليوم</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{employeesOnLeaveIds.size}</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs text-gray-500">داخل فترة التجربة</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{probationCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs text-gray-500">أكثر المسميات</p>
              <div className="mt-2 space-y-1 text-xs text-gray-600">
                {jobTitleSummary.length > 0
                  ? jobTitleSummary.map(([title, count]) => <p key={title}>{title}: {count}</p>)
                  : <p>لا توجد بيانات</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!isSelfServiceView && (
        <EmployeeLeaveDirectory
          employees={leaveProfileEmployees}
          requestsByEmployeeId={requestsByEmployeeId}
          balancesByEmployeeId={balancesByEmployeeId}
          searchValue={employeeSearch}
          onSearchChange={setEmployeeSearch}
          canApprove={canApprove}
          canReviewRequest={canReviewLeaveRequest}
          onDecisionSuccess={refetch}
        />
      )}

      {!isSelfServiceView && (role === "Admin" || role === "HR_Admin" || role === "Superadmin") && (
        <details className="rounded-lg bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            إدارة أرصدة الإجازات وسجل الحركات
          </summary>
          <div className="mt-4">
            <LeaveBalanceManager
              employees={employees}
              balances={balances}
              orgId={currentUser?.orgId || ""}
              actorUserId={currentUser?.id || ""}
              onChanged={refetchBalances}
            />
          </div>
        </details>
      )}

      {isSelfServiceView && (
      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">الموظف</TableHead>
                <TableHead className="font-semibold text-gray-600">النوع</TableHead>
                <TableHead className="font-semibold text-gray-600">التواريخ</TableHead>
                <TableHead className="font-semibold text-gray-600">الأيام</TableHead>
                <TableHead className="font-semibold text-gray-600">المرفق</TableHead>
                <TableHead className="font-semibold text-gray-600">مرحلة الاعتماد</TableHead>
                <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                <TableHead className="font-semibold text-gray-600">السبب</TableHead>
                {canApprove && <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRequests.map((req) => {
                const reqRecord = req as Record<string, unknown>;
                const reqId = String(reqRecord.id ?? "");
                const currentStep = Number(reqRecord.current_step || 1);
                const canReviewCurrentStep = role === "Admin"
                  || (role === "Training_Manager" && currentStep <= 1 && isManagedRequest(reqRecord))
                  || (role === "Sales_Manager" && currentStep <= 1)
                  || (role === "HR_Admin" && currentStep >= 2);
                const canReviewRequest = canApprove
                  && !isOwnRequest(reqRecord)
                  && canReviewCurrentStep;
                const employee = (reqRecord.employee ?? null) as Record<string, unknown> | null;
                const employeeName = typeof employee?.full_name === "string" ? employee.full_name : "—";
                const leaveType = typeof reqRecord.leave_type === "string" ? reqRecord.leave_type : "—";
                const startDateStr = typeof reqRecord.start_date === "string" ? reqRecord.start_date : "";
                const endDateStr = typeof reqRecord.end_date === "string" ? reqRecord.end_date : "";
                const status = typeof reqRecord.status === "string" ? reqRecord.status : "pending";
                const reason = typeof reqRecord.reason === "string" ? reqRecord.reason : "—";
                const storedDayCount = Number(reqRecord.days_count || 0);
                const dayCount = storedDayCount > 0 ? storedDayCount : inclusiveDays(startDateStr, endDateStr);
                const attachmentUrl = typeof reqRecord.attachment_url === "string" ? reqRecord.attachment_url : "";
                const attachmentName = typeof reqRecord.attachment_name === "string" ? reqRecord.attachment_name : "عرض المرفق";
                return (
                  <TableRow key={reqId}>
                    <TableCell className="font-medium text-gray-900">{employeeName}</TableCell>
                    <TableCell className="text-gray-600">{leaveTypeLabels[leaveType] || leaveType}</TableCell>
                    <TableCell className="text-gray-600">{startDateStr || "—"} ← {endDateStr || "—"}</TableCell>
                    <TableCell className="text-gray-600">{dayCount || "—"}</TableCell>
                    <TableCell className="text-gray-600">
                      {attachmentUrl ? (
                        <AttachmentLink bucket="balance-attachments" attachment={{ path: attachmentUrl, url: attachmentUrl }} className="text-brand hover:text-brand-dark">
                          {attachmentName}
                        </AttachmentLink>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-600">{getWorkflowStageLabel(reqRecord)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyle[status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                        {statusLabels[status] || status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{reason}</TableCell>
                    {canApprove && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <LeaveDecisionDialog
                            reqRecord={reqRecord}
                            decision="approved"
                            leaveType={leaveType}
                            disabled={status !== "pending" || !canReviewRequest}
                            onSuccess={refetch}
                          />
                          <LeaveDecisionDialog
                            reqRecord={reqRecord}
                            decision="rejected"
                            leaveType={leaveType}
                            disabled={status !== "pending" || !canReviewRequest}
                            onSuccess={refetch}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {visibleRequests.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">{emptyTitle}</p>
              <p className="text-xs text-gray-500 mt-1">{emptyDescription}</p>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function EmployeeLeaveDirectory({
  employees,
  requestsByEmployeeId,
  balancesByEmployeeId,
  searchValue,
  onSearchChange,
  canApprove,
  canReviewRequest,
  onDecisionSuccess,
}: {
  employees: Record<string, unknown>[];
  requestsByEmployeeId: Map<string, Record<string, unknown>[]>;
  balancesByEmployeeId: Map<string, Record<string, unknown>>;
  searchValue: string;
  onSearchChange: (value: string) => void;
  canApprove: boolean;
  canReviewRequest: (request: Record<string, unknown>) => boolean;
  onDecisionSuccess: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-950">ملفات إجازات الموظفين</h2>
          <p className="mt-1 text-sm text-gray-500">كل موظف في كارت مستقل، وافتح الملف لمراجعة الرصيد والطلبات والتاريخ.</p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="ابحث باسم الموظف أو الكود..."
            className="pr-9"
          />
        </div>
      </div>

      {employees.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {employees.map((employee) => {
            const employeeId = String(employee.id || "");
            const requests = requestsByEmployeeId.get(employeeId) || [];
            const balance = balancesByEmployeeId.get(employeeId) || {};
            return (
              <EmployeeLeaveCard
                key={employeeId}
                employee={employee}
                requests={requests}
                balance={balance}
                canApprove={canApprove}
                canReviewRequest={canReviewRequest}
                onDecisionSuccess={onDecisionSuccess}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg bg-white py-12 text-center shadow-sm">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-900">لا يوجد موظفون مطابقون للبحث</p>
          <p className="mt-1 text-xs text-gray-500">غيّر كلمة البحث لعرض ملفات أخرى.</p>
        </div>
      )}
    </section>
  );
}

function EmployeeLeaveCard({
  employee,
  requests,
  balance,
  canApprove,
  canReviewRequest,
  onDecisionSuccess,
}: {
  employee: Record<string, unknown>;
  requests: Record<string, unknown>[];
  balance: Record<string, unknown>;
  canApprove: boolean;
  canReviewRequest: (request: Record<string, unknown>) => boolean;
  onDecisionSuccess: () => void;
}) {
  const employeeName = getEmployeeName(employee);
  const employeeCode = getText(employee.employee_code, "");
  const jobTitle = getText(employee.job_title, "بدون مسمى");
  const stats = getLeaveStats(requests);
  const latestRequest = getLatestLeaveRequest(requests);
  const currentStatus = stats.onLeaveToday
    ? "في إجازة اليوم"
    : stats.pending > 0
      ? `${stats.pending} طلب قيد الاعتماد`
      : "لا توجد طلبات معلقة";
  const currentStatusClass = stats.onLeaveToday
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : stats.pending > 0
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-green-50 text-green-700 border-green-200";

  return (
    <Card className="border-none shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-gray-950">{employeeName}</h3>
            <p className="mt-1 truncate text-sm text-gray-500">{jobTitle}</p>
            {employeeCode && <p className="mt-1 text-xs text-gray-400">{employeeCode}</p>}
          </div>
          <Badge variant="outline" className={currentStatusClass}>{currentStatus}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-500">الطلبات</p>
            <p className="mt-1 font-semibold text-gray-950">{requests.length}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-500">مقبول</p>
            <p className="mt-1 font-semibold text-green-700">{stats.approved}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-500">مرفوض</p>
            <p className="mt-1 font-semibold text-red-600">{stats.rejected}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
          <p className="rounded-md border border-gray-100 px-2 py-2">سنوي: <span className="font-semibold text-gray-950">{formatDays(balance.vacation_remaining)}</span></p>
          <p className="rounded-md border border-gray-100 px-2 py-2">مرضي: <span className="font-semibold text-gray-950">{formatDays(balance.sick_remaining)}</span></p>
          <p className="rounded-md border border-gray-100 px-2 py-2">طارئ: <span className="font-semibold text-gray-950">{formatDays(balance.emergency_remaining)}</span></p>
        </div>

        <div className="min-h-[52px] rounded-lg border border-dashed border-gray-200 p-3 text-sm">
          <p className="text-xs font-medium text-gray-500">آخر طلب</p>
          {latestRequest ? (
            <p className="mt-1 text-gray-800">
              {leaveTypeLabels[getText(latestRequest.leave_type, "")] || getText(latestRequest.leave_type, "إجازة")}
              {" · "}
              {getDateRange(latestRequest)}
            </p>
          ) : (
            <p className="mt-1 text-gray-500">لا توجد طلبات مسجلة.</p>
          )}
        </div>

        <EmployeeLeaveProfileDialog
          employee={employee}
          requests={requests}
          balance={balance}
          canApprove={canApprove}
          canReviewRequest={canReviewRequest}
          onDecisionSuccess={onDecisionSuccess}
        />
      </CardContent>
    </Card>
  );
}

function EmployeeLeaveProfileDialog({
  employee,
  requests,
  balance,
  canApprove,
  canReviewRequest,
  onDecisionSuccess,
}: {
  employee: Record<string, unknown>;
  requests: Record<string, unknown>[];
  balance: Record<string, unknown>;
  canApprove: boolean;
  canReviewRequest: (request: Record<string, unknown>) => boolean;
  onDecisionSuccess: () => void;
}) {
  const employeeName = getEmployeeName(employee);
  const stats = getLeaveStats(requests);
  const approvedDays = requests
    .filter((request) => String(request.status || "") === "approved")
    .reduce((total, request) => total + getLeaveDays(request), 0);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="w-full" />}>
        عرض ملف الإجازات
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {getText(employee.employee_code, "بدون كود")} · {getText(employee.job_title, "بدون مسمى")} · {getDepartmentName(employee)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs text-gray-500">إجمالي الطلبات</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{requests.length}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-xs text-amber-700">قيد الاعتماد</p>
              <p className="mt-1 text-2xl font-semibold text-amber-800">{stats.pending}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <p className="text-xs text-green-700">أيام معتمدة</p>
              <p className="mt-1 text-2xl font-semibold text-green-800">{approvedDays}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-xs text-blue-700">الحالة اليوم</p>
              <p className="mt-1 text-lg font-semibold text-blue-900">{stats.onLeaveToday ? "في إجازة" : "متاح"}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">الأرصدة الحالية</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-100 p-4">
                <p className="text-xs text-gray-500">الإجازة السنوية</p>
                <p className="mt-1 text-xl font-semibold text-gray-950">{formatDays(balance.vacation_remaining)}</p>
              </div>
              <div className="rounded-lg border border-gray-100 p-4">
                <p className="text-xs text-gray-500">الإجازة المرضية</p>
                <p className="mt-1 text-xl font-semibold text-gray-950">{formatDays(balance.sick_remaining)}</p>
              </div>
              <div className="rounded-lg border border-gray-100 p-4">
                <p className="text-xs text-gray-500">الإجازة الطارئة</p>
                <p className="mt-1 text-xl font-semibold text-gray-950">{formatDays(balance.emergency_remaining)}</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">طلبات الإجازة</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50">
                    <TableHead>النوع</TableHead>
                    <TableHead>التواريخ</TableHead>
                    <TableHead>الأيام</TableHead>
                    <TableHead>مرحلة الاعتماد</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المرفق</TableHead>
                    <TableHead>السبب</TableHead>
                    {canApprove && <TableHead className="text-right">الإجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => {
                    const requestId = String(request.id || "");
                    const leaveType = getText(request.leave_type, "");
                    const status = getText(request.status, "pending");
                    const attachmentUrl = getText(request.attachment_url, "");
                    const attachmentName = getText(request.attachment_name, "عرض المرفق");
                    const reviewable = canReviewRequest(request);
                    return (
                      <TableRow key={requestId}>
                        <TableCell>{leaveTypeLabels[leaveType] || leaveType || "إجازة"}</TableCell>
                        <TableCell>{getDateRange(request)}</TableCell>
                        <TableCell>{getLeaveDays(request)}</TableCell>
                        <TableCell>{getWorkflowStageLabel(request)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusStyle[status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                            {statusLabels[status] || status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {attachmentUrl ? (
                            <AttachmentLink bucket="balance-attachments" attachment={{ path: attachmentUrl, url: attachmentUrl }} className="text-brand hover:text-brand-dark">
                              {attachmentName}
                            </AttachmentLink>
                          ) : "لا يوجد"}
                        </TableCell>
                        <TableCell className="max-w-[220px] whitespace-normal text-gray-600">{getText(request.reason, "-")}</TableCell>
                        {canApprove && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <LeaveDecisionDialog
                                reqRecord={request}
                                decision="approved"
                                leaveType={leaveType}
                                disabled={status !== "pending" || !reviewable}
                                onSuccess={onDecisionSuccess}
                              />
                              <LeaveDecisionDialog
                                reqRecord={request}
                                decision="rejected"
                                leaveType={leaveType}
                                disabled={status !== "pending" || !reviewable}
                                onSuccess={onDecisionSuccess}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {requests.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500">
                  لا توجد طلبات إجازة لهذا الموظف حتى الآن.
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getText(value: unknown, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function getEmployeeName(employee: Record<string, unknown>) {
  return getText(employee.full_name, getText(employee.name, "موظف"));
}

function getDepartmentName(employee: Record<string, unknown>) {
  const department = employee.department as Record<string, unknown> | null | undefined;
  return getText(department?.name, "بدون قسم");
}

function getLeaveDays(request: Record<string, unknown>) {
  const storedDayCount = Number(request.days_count || 0);
  if (storedDayCount > 0) return storedDayCount;
  return inclusiveDays(getText(request.start_date), getText(request.end_date));
}

function getDateRange(request: Record<string, unknown>) {
  const startDate = getText(request.start_date, "-");
  const endDate = getText(request.end_date, "-");
  return `${startDate} - ${endDate}`;
}

function getLatestLeaveRequest(requests: Record<string, unknown>[]) {
  return [...requests].sort((first, second) => {
    const firstDate = getText(first.requested_at, getText(first.start_date));
    const secondDate = getText(second.requested_at, getText(second.start_date));
    return secondDate.localeCompare(firstDate);
  })[0] || null;
}

type LeaveStats = {
  pending: number;
  approved: number;
  rejected: number;
  onLeaveToday: boolean;
};

function getLeaveStats(requests: Record<string, unknown>[]): LeaveStats {
  const todayIso = new Date().toISOString().split("T")[0];
  return requests.reduce(
    (stats: LeaveStats, request) => {
      const status = String(request.status || "");
      if (status === "pending") stats.pending += 1;
      if (status === "approved") stats.approved += 1;
      if (status === "rejected") stats.rejected += 1;
      if (
        status === "approved"
        && getText(request.start_date) <= todayIso
        && getText(request.end_date) >= todayIso
      ) {
        stats.onLeaveToday = true;
      }
      return stats;
    },
    { pending: 0, approved: 0, rejected: 0, onLeaveToday: false } as LeaveStats
  );
}

function formatDays(value: unknown) {
  const number = Number(value || 0);
  const safeNumber = Number.isFinite(number) ? number : 0;
  return `${safeNumber.toFixed(2)} يوم`;
}

function LeaveBalanceManager({
  employees,
  balances,
  orgId,
  actorUserId,
  onChanged,
}: {
  employees: Record<string, unknown>[];
  balances: Record<string, unknown>[];
  orgId: string;
  actorUserId: string;
  onChanged: () => void;
}) {
  const [transactions, setTransactions] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);

  const loadTransactions = async () => {
    if (!orgId) return;
    const result = await getLeaveBalanceTransactions(orgId);
    setTransactions(result.data || []);
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const balancesByEmployeeId = new Map(balances.map((balance) => [String(balance.employee_id || ""), balance]));

  const syncBalances = async () => {
    if (!orgId) return;
    setSyncing(true);
    for (const employee of employees) {
      const employeeId = String(employee.id || "");
      if (!employeeId) continue;
      await ensureEmployeeLeaveBalance({
        orgId,
        employeeId,
        hiringDate: typeof employee.hiring_date === "string" ? employee.hiring_date : null,
        accrualStartDate: typeof employee.leave_accrual_start_date === "string" ? employee.leave_accrual_start_date : null,
        manualAdjustment: typeof employee.leave_balance_manual_adjustment === "number" || typeof employee.leave_balance_manual_adjustment === "string"
          ? employee.leave_balance_manual_adjustment
          : 0,
        actorUserId,
      });
    }
    setSyncing(false);
    setMessage("تم تحديث وإنشاء أرصدة الإجازات للموظفين.");
    onChanged();
    loadTransactions();
  };

  return (
    <>
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <Card className="border-none shadow-sm">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">إدارة أرصدة الإجازات</h2>
              <p className="mt-1 text-sm text-gray-500">الرصيد السنوي الرسمي يأتي من جدول الأرصدة، مع سجل لكل إضافة أو خصم أو تعديل.</p>
            </div>
            <Button variant="outline" onClick={syncBalances} disabled={syncing}>
              {syncing ? "جار التحديث..." : "مزامنة الأرصدة"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead>سنوية</TableHead>
                  <TableHead>مرضية</TableHead>
                  <TableHead>طارئة</TableHead>
                  <TableHead>المستحق تلقائيًا</TableHead>
                  <TableHead>تعديل يدوي</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((employee) => {
                  const employeeId = String(employee.id || "");
                  const balance = balancesByEmployeeId.get(employeeId) || {};
                  return (
                    <TableRow key={employeeId}>
                      <TableCell>
                        <p className="font-medium text-gray-950">{String(employee.full_name || employee.name || "موظف")}</p>
                        <p className="text-xs text-gray-500">{String(employee.employee_code || "")}</p>
                      </TableCell>
                      <TableCell>{Number(balance.vacation_remaining || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>{Number(balance.sick_remaining || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>{Number(balance.emergency_remaining || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>{Number(balance.vacation_accrued_days || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>{Number(balance.manual_adjustment || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>
                        <LeaveBalanceAdjustDialog
                          employee={employee}
                          orgId={orgId}
                          actorUserId={actorUserId}
                          onChanged={() => {
                            onChanged();
                            loadTransactions();
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">آخر حركات الرصيد</h3>
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحركة</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>بعد الحركة</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.slice(0, 12).map((transaction) => {
                  const employee = (transaction.employee ?? null) as Record<string, unknown> | null;
                  return (
                    <TableRow key={String(transaction.id)}>
                      <TableCell>{transaction.created_at ? new Date(String(transaction.created_at)).toLocaleDateString("ar-SA") : "-"}</TableCell>
                      <TableCell>{String(employee?.full_name || "-")}</TableCell>
                      <TableCell>{leaveTypeLabels[String(transaction.leave_type || "")] || String(transaction.leave_type || "-")}</TableCell>
                      <TableCell>{transactionTypeLabel(String(transaction.transaction_type || ""))}</TableCell>
                      <TableCell className={Number(transaction.amount || 0) < 0 ? "text-red-600" : "text-green-700"}>
                        {Number(transaction.amount || 0).toFixed(2)} يوم
                      </TableCell>
                      <TableCell>{Number(transaction.balance_after || 0).toFixed(2)} يوم</TableCell>
                      <TableCell>{String(transaction.reason || "-")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {transactions.length === 0 && <p className="py-6 text-center text-sm text-gray-500">لا توجد حركات رصيد بعد.</p>}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function transactionTypeLabel(type: string) {
  if (type === "initial") return "رصيد افتتاحي";
  if (type === "accrual") return "استحقاق تلقائي";
  if (type === "manual_adjustment") return "تعديل يدوي";
  if (type === "leave_deduction") return "خصم إجازة";
  return type || "-";
}

function LeaveBalanceAdjustDialog({
  employee,
  orgId,
  actorUserId,
  onChanged,
}: {
  employee: Record<string, unknown>;
  orgId: string;
  actorUserId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "vacation", amount: "", reason: "" });

  const submit = async () => {
    const amount = Number(form.amount);
    if (!amount) {
      setError("قيمة التعديل مطلوبة. استخدم رقم موجب للإضافة أو سالب للخصم.");
      return;
    }
    if (!form.reason.trim()) {
      setError("سبب التعديل مطلوب.");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await adjustLeaveBalance({
      orgId,
      employeeId: String(employee.id || ""),
      leaveType: form.leave_type as "sick" | "vacation" | "emergency",
      amount,
      reason: form.reason.trim(),
      actorUserId,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ leave_type: "vacation", amount: "", reason: "" });
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>تعديل</DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>تعديل رصيد الإجازات</DialogTitle>
          <DialogDescription>
            تعديل رصيد {String(employee.full_name || employee.name || "الموظف")}. الأرقام السالبة تخصم من الرصيد.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>نوع الرصيد</Label>
            <Select value={form.leave_type} onValueChange={(value) => setForm((prev) => ({ ...prev, leave_type: value || "vacation" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">سنوية</SelectItem>
                <SelectItem value="sick">مرضية</SelectItem>
                <SelectItem value="emergency">طارئة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>قيمة التعديل بالأيام</Label>
            <Input type="number" step="0.25" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="مثال: 2 أو -1" />
          </div>
          <div className="space-y-2">
            <Label>سبب التعديل *</Label>
            <Input value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} placeholder="مثال: تسوية رصيد بداية السنة" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={submit} disabled={submitting}>
            {submitting ? "جار الحفظ..." : "حفظ التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Leave Decision Dialog (replaces window.prompt/alert) ─── */

function LeaveDecisionDialog({
  reqRecord,
  decision,
  leaveType,
  disabled,
  onSuccess,
}: {
  reqRecord: Record<string, unknown>;
  decision: "approved" | "rejected";
  leaveType: string;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isApprove = decision === "approved";

  const handleDecide = async () => {
    setSubmitting(true);
    setError("");
    const { data, error: decisionError } = await advanceLeaveApproval(
      reqRecord,
      decision,
      { userId: currentUser?.id, employeeId: currentUser?.employeeId, role: currentUser?.role },
      note
    );
    setSubmitting(false);

    if (decisionError) {
      setError(decisionError.message);
      return;
    }

    if (currentUser?.orgId && reqRecord.employee_id) {
      const finalStatus = String(data?.status || "");
      const nextStep = Number(data?.current_step || reqRecord.current_step || 1);
      if (decision === "approved" && finalStatus === "pending" && nextStep >= 2) {
        await fetch("/api/leave-requests/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "manager_approved", requestId: reqRecord.id }),
        });
      }
      if (finalStatus === "approved" || decision === "rejected") {
        await notifyLeaveDecision(currentUser.orgId, String(reqRecord.employee_id), leaveType, decision);
      }
    }

    setNote("");
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button
          variant="ghost"
          size="sm"
          className={isApprove ? "text-green-600 hover:text-green-700" : "text-red-600 hover:text-red-700"}
          disabled={disabled}
        />
      }>
        {isApprove ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{isApprove ? "اعتماد طلب الإجازة" : "رفض طلب الإجازة"}</DialogTitle>
          <DialogDescription>
            {isApprove
              ? "هل تريد اعتماد هذا الطلب؟ يمكنك إضافة ملاحظة."
              : "هل تريد رفض هذا الطلب؟ يُرجى ذكر سبب الرفض."}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <Label>{isApprove ? "ملاحظة (اختياري)" : "سبب الرفض"}</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isApprove ? "ملاحظة الاعتماد..." : "سبب الرفض..."}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button
            className={isApprove ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
            onClick={handleDecide}
            disabled={submitting || (!isApprove && !note.trim())}
          >
            {submitting ? "جار المعالجة..." : isApprove ? "اعتماد" : "رفض"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateLeaveDialog({
  onSuccess,
  description = "إرسال طلب إجازة للاعتماد.",
}: {
  onSuccess: () => void;
  description?: string;
}) {
  const { currentUser, refresh } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "vacation", start_date: "", end_date: "", reason: "" });
  const [attachment, setAttachment] = useState<File | null>(null);
  const calculatedDays = inclusiveDays(form.start_date, form.end_date);
  const attachmentRequired = leaveTypeRequiresAttachment(form.leave_type);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId) {
      setError("تعذر تحديد بيانات المستخدم الحالية.");
      return;
    }

    const parsed = leaveRequestFormSchema.safeParse(form);
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      return;
    }

    if (attachmentRequired && !attachment) {
      setError("هذا النوع من الإجازات يتطلب إرفاق مستند قبل الإرسال.");
      return;
    }

    setSubmitting(true);
    setError("");

    const { error: err } = await createLeaveRequest(parsed.data, attachment);

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    await refresh();
    setSubmitting(false);
    setOpen(false);
    setForm({ leave_type: "vacation", start_date: "", end_date: "", reason: "" });
    setAttachment(null);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        طلب إجازة
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>طلب إجازة</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>نوع الإجازة</Label>
            <Select value={form.leave_type} onValueChange={(v) => set("leave_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {leaveTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>تاريخ البداية</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>تاريخ النهاية</Label>
              <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>السبب (اختياري)</Label>
            <Input value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="اذكر سبب الإجازة..." />
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            عدد الأيام: <span className="font-semibold text-gray-950">{calculatedDays || 0}</span>
          </div>
          <div className="space-y-2">
            <Label>المرفق {attachmentRequired ? "*" : "(اختياري)"}</Label>
            <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
            {attachmentRequired && (
              <p className="text-xs text-gray-500">مطلوب لهذا النوع: مرضية، زواج، أو وفاة.</p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.start_date || !form.end_date || (attachmentRequired && !attachment)}>
            {submitting ? "جار الإرسال..." : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

