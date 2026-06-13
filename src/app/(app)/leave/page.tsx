"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Check, X } from "lucide-react";
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

      {!isSelfServiceView && (role === "Admin" || role === "HR_Admin" || role === "Superadmin") && (
        <LeaveBalanceManager
          employees={employees}
          balances={balances}
          orgId={currentUser?.orgId || ""}
          actorUserId={currentUser?.id || ""}
          onChanged={refetchBalances}
        />
      )}

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
                        <a className="text-brand hover:text-brand-dark" href={attachmentUrl} target="_blank" rel="noreferrer">
                          {attachmentName}
                        </a>
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
    </div>
  );
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

