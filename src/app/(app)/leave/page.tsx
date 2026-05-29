"use client";

import React, { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoleContext } from "@/providers/RoleProvider";
import { useLeaveRequests, useLeaveBalances } from "@/hooks/use-data";
import { advanceLeaveApproval, createLeaveRequest } from "@/lib/services/leaves";
import { notifyLeaveDecision } from "@/lib/services/notification-triggers";
import { PageSkeleton } from "@/components/Skeletons";
import { getValidationMessage, leaveRequestFormSchema } from "@/lib/validation";

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

const leaveTypeLabels: Record<string, string> = {
  sick: "مرضية",
  vacation: "سنوية",
  emergency: "طارئة",
};

export default function LeavePage() {
  const searchParams = useSearchParams();
  const { currentUser } = useRoleContext();
  const { data: leaveRequests, loading, refetch } = useLeaveRequests();
  const { data: balances } = useLeaveBalances(currentUser?.employeeId);
  const role = currentUser?.role || "";
  const isHRAdmin = role === "HR_Admin";
  const isApprover = ["Superadmin", "Admin", "HR_Admin", "Training_Manager"].includes(role);
  const isSelfServiceView = !isApprover || (isHRAdmin && searchParams.get("view") === "mine");
  const canApprove = isApprover && !isSelfServiceView;
  const isOwnRequest = (req: Record<string, unknown>) => String(req.employee_id ?? "") === currentUser?.employeeId;
  const visibleRequests = isSelfServiceView
    ? leaveRequests.filter((req) => isOwnRequest(req as Record<string, unknown>))
    : isHRAdmin
      ? leaveRequests.filter((req) => !isOwnRequest(req as Record<string, unknown>))
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

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">الموظف</TableHead>
                <TableHead className="font-semibold text-gray-600">النوع</TableHead>
                <TableHead className="font-semibold text-gray-600">التواريخ</TableHead>
                <TableHead className="font-semibold text-gray-600">الأيام</TableHead>
                <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                <TableHead className="font-semibold text-gray-600">السبب</TableHead>
                {canApprove && <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRequests.map((req) => {
                const reqRecord = req as Record<string, unknown>;
                const reqId = String(reqRecord.id ?? "");
                const requesterRole = typeof reqRecord.requester_role === "string" ? reqRecord.requester_role : null;
                const requiresSuperadminApproval = requesterRole === "HR_Admin";
                const canReviewRequest = canApprove
                  && !isOwnRequest(reqRecord)
                  && (!requiresSuperadminApproval || role === "Superadmin");
                const employee = (reqRecord.employee ?? null) as Record<string, unknown> | null;
                const employeeName = typeof employee?.full_name === "string" ? employee.full_name : "—";
                const leaveType = typeof reqRecord.leave_type === "string" ? reqRecord.leave_type : "—";
                const startDateStr = typeof reqRecord.start_date === "string" ? reqRecord.start_date : "";
                const endDateStr = typeof reqRecord.end_date === "string" ? reqRecord.end_date : "";
                const status = typeof reqRecord.status === "string" ? reqRecord.status : "pending";
                const reason = typeof reqRecord.reason === "string" ? reqRecord.reason : "—";
                const startDate = startDateStr ? new Date(startDateStr) : null;
                const endDate = endDateStr ? new Date(endDateStr) : null;
                const dayCount = startDate && endDate
                  ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1)
                  : null;
                return (
                  <TableRow key={reqId}>
                    <TableCell className="font-medium text-gray-900">{employeeName}</TableCell>
                    <TableCell className="text-gray-600">{leaveTypeLabels[leaveType] || leaveType}</TableCell>
                    <TableCell className="text-gray-600">{startDateStr || "—"} ← {endDateStr || "—"}</TableCell>
                    <TableCell className="text-gray-600">{dayCount ?? "—"}</TableCell>
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
      { userId: currentUser?.id, role: currentUser?.role },
      note
    );
    setSubmitting(false);

    if (decisionError) {
      setError(decisionError.message);
      return;
    }

    if (currentUser?.orgId && reqRecord.employee_id) {
      const finalStatus = String(data?.status || "");
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
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "vacation", start_date: "", end_date: "", reason: "" });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !currentUser?.employeeId) return;

    const parsed = leaveRequestFormSchema.safeParse(form);
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    setError("");

    const { error: err } = await createLeaveRequest({
      org_id: currentUser.orgId,
      employee_id: currentUser.employeeId,
      ...parsed.data,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ leave_type: "vacation", start_date: "", end_date: "", reason: "" });
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
                <SelectItem value="sick">مرضية</SelectItem>
                <SelectItem value="vacation">سنوية</SelectItem>
                <SelectItem value="emergency">طارئة</SelectItem>
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
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.start_date || !form.end_date}>
            {submitting ? "جار الإرسال..." : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

