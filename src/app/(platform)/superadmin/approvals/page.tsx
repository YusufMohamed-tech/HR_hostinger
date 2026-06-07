"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Check, Paperclip, Plus, UserCog, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/Skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createSuperadminTask,
  decideSuperadminLeaveRequest,
  getSuperadminLeaveRequests,
  getSuperadminTaskAssignees,
  type SuperadminLeaveRequest,
  type SuperadminTaskAssignee,
} from "@/lib/services/superadmin-workflows";

const leaveTypeLabels: Record<string, string> = {
  sick: "مرضية",
  vacation: "سنوية",
  emergency: "طارئة",
};

const statusLabels: Record<string, string> = {
  pending: "بانتظار القرار",
  approved: "معتمدة",
  rejected: "مرفوضة",
};

const statusClasses: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

const roleLabels: Record<string, string> = {
  hr_admin: "HR Admin",
  hr_recruitment: "HR Recruitment",
};

function TaskAttachmentPicker({
  attachments,
  onChange,
}: {
  attachments: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>المرفقات</Label>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-600 hover:bg-brand-light">
        <Paperclip className="h-4 w-4" />
        <span>اختر ملفات أو صور</span>
        <input
          className="sr-only"
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.gif,.pdf,.docx,.xlsx"
          onChange={(event) => onChange(Array.from(event.target.files || []))}
        />
      </label>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((file) => (
            <span key={`${file.name}-${file.size}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
              {file.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SuperadminApprovalsPage() {
  const [requests, setRequests] = useState<SuperadminLeaveRequest[]>([]);
  const [assignees, setAssignees] = useState<SuperadminTaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    const [leaveResult, assigneeResult] = await Promise.all([
      getSuperadminLeaveRequests(),
      getSuperadminTaskAssignees(),
    ]);

    if (leaveResult.error || assigneeResult.error) {
      setError(leaveResult.error?.message || assigneeResult.error?.message || "تعذر تحميل البيانات.");
      setRequests([]);
      setAssignees([]);
    } else {
      setError("");
      setRequests(leaveResult.data || []);
      setAssignees(assigneeResult.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const pending = requests.filter((request) => request.status === "pending").length;
    const approved = requests.filter((request) => request.status === "approved").length;
    const rejected = requests.filter((request) => request.status === "rejected").length;
    return [
      { label: "طلبات معلقة", value: pending, icon: CalendarCheck },
      { label: "معتمدة", value: approved, icon: Check },
      { label: "مرفوضة", value: rejected, icon: X },
      { label: "HR / Recruiters", value: assignees.length, icon: UserCog },
    ];
  }, [requests, assignees]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">اعتمادات HR والمهام</h1>
          <p className="mt-1 text-sm text-slate-500">
            مراجعة إجازات HR و Recruiters من المشرف العام، وإسناد مهام مباشرة لهم عند الحاجة.
          </p>
        </div>
        <CreateTaskDialog assignees={assignees} onSuccess={loadData} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-none shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">{stat.label}</CardTitle>
                <Icon className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-950">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>طلبات الإجازة</CardTitle>
          <CardDescription>طلبات الإجازة الصادرة من HR Admin أو HR Recruitment فقط.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">الموظف</TableHead>
                <TableHead className="font-semibold text-gray-600">المنظمة</TableHead>
                <TableHead className="font-semibold text-gray-600">الدور</TableHead>
                <TableHead className="font-semibold text-gray-600">الإجازة</TableHead>
                <TableHead className="font-semibold text-gray-600">المدة</TableHead>
                <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                <TableHead className="font-semibold text-gray-600">السبب</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">القرار</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">{request.employee?.full_name || "بدون اسم"}</span>
                      <span className="text-xs text-slate-500">{request.employee?.email || request.employee?.job_title || ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    <div className="flex flex-col">
                      <span>{request.organization?.name || "-"}</span>
                      <span className="text-xs text-slate-400">{request.organization?.slug || ""}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                      {roleLabels[request.requester_role] || request.requester_role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{leaveTypeLabels[request.leave_type] || request.leave_type}</TableCell>
                  <TableCell className="text-slate-600">
                    {request.start_date} إلى {request.end_date}
                    <span className="block text-xs text-slate-400">{request.days} يوم</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusClasses[request.status] || "border-slate-200 bg-slate-50 text-slate-700"}>
                      {statusLabels[request.status] || request.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-slate-600">{request.reason || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <LeaveDecisionDialog request={request} decision="approved" onSuccess={loadData} />
                      <LeaveDecisionDialog request={request} decision="rejected" onSuccess={loadData} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {requests.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarCheck className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-900">لا توجد طلبات إجازة من HR أو Recruiters</p>
              <p className="mt-1 text-xs text-gray-500">ستظهر هنا الطلبات التي تحتاج مراجعة المشرف العام.</p>
            </div>
          )}

          {error && <div className="border-t px-4 py-3 text-sm text-red-600">{error}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function LeaveDecisionDialog({
  request,
  decision,
  onSuccess,
}: {
  request: SuperadminLeaveRequest;
  decision: "approved" | "rejected";
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isApprove = decision === "approved";
  const disabled = request.status !== "pending";

  const handleDecision = async () => {
    setSubmitting(true);
    setError("");
    const result = await decideSuperadminLeaveRequest({
      request_id: request.id,
      decision,
      note,
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setNote("");
    setOpen(false);
    await onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={isApprove
              ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              : "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"}
            disabled={disabled}
          />
        }
      >
        {isApprove ? <Check className="ml-2 h-4 w-4" /> : <X className="ml-2 h-4 w-4" />}
        {isApprove ? "اعتماد" : "رفض"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isApprove ? "اعتماد طلب الإجازة" : "رفض طلب الإجازة"}</DialogTitle>
          <DialogDescription>
            {request.employee?.full_name || "الموظف"} - {leaveTypeLabels[request.leave_type] || request.leave_type}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <div className="space-y-2">
            <Label>{isApprove ? "ملاحظة اختيارية" : "سبب الرفض"}</Label>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button
            className={isApprove ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-600 text-white hover:bg-red-700"}
            onClick={handleDecision}
            disabled={submitting || (!isApprove && !note.trim())}
          >
            {submitting ? "جار الحفظ..." : isApprove ? "اعتماد" : "رفض"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskDialog({
  assignees,
  onSuccess,
}: {
  assignees: SuperadminTaskAssignee[];
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [form, setForm] = useState({
    assignee_key: "",
    title: "",
    description: "",
    priority: "medium",
    due_date: "",
  });

  const selectedAssignee = assignees.find((assignee) => `${assignee.org_id}:${assignee.user_id}` === form.assignee_key);

  const set = (key: keyof typeof form, value: string | null) => {
    setForm((previous) => ({ ...previous, [key]: value ?? "" }));
  };

  const handleSubmit = async () => {
    if (!selectedAssignee) {
      setError("اختر HR أو Recruiter للتكليف.");
      return;
    }
    if (form.title.trim().length < 2) {
      setError("عنوان المهمة مطلوب.");
      return;
    }

    setSubmitting(true);
    setError("");
    const result = await createSuperadminTask({
      target_org_id: selectedAssignee.org_id,
      assignee_user_id: selectedAssignee.user_id,
      title: form.title,
      description: form.description,
      priority: form.priority,
      due_date: form.due_date,
      attachments,
    });
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setOpen(false);
    setForm({ assignee_key: "", title: "", description: "", priority: "medium", due_date: "" });
    setAttachments([]);
    await onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}>
        <Plus className="ml-2 h-4 w-4" />
        إسناد مهمة
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>إسناد مهمة إلى HR أو Recruiter</DialogTitle>
          <DialogDescription>المهمة ستظهر للمستخدم داخل صفحة مهامه في منظمة العمل الخاصة به.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>المكلف</Label>
            <Select value={form.assignee_key} onValueChange={(value) => set("assignee_key", value)}>
              <SelectTrigger><SelectValue placeholder="اختر HR أو Recruiter" /></SelectTrigger>
              <SelectContent>
                {assignees.map((assignee) => {
                  const name = assignee.profile?.full_name || assignee.profile?.email || assignee.user_id;
                  const orgName = assignee.organization?.name || assignee.org_id;
                  return (
                    <SelectItem key={`${assignee.org_id}:${assignee.user_id}`} value={`${assignee.org_id}:${assignee.user_id}`}>
                      {name} - {roleLabels[assignee.role] || assignee.role} - {orgName}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>عنوان المهمة</Label>
            <Input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="مثال: تجهيز بديل أثناء الإجازة" />
          </div>
          <div className="space-y-2">
            <Label>الوصف</Label>
            <Input value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="تفاصيل المهمة" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الأولوية</Label>
              <Select value={form.priority} onValueChange={(value) => set("priority", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">منخفض</SelectItem>
                  <SelectItem value="medium">متوسط</SelectItem>
                  <SelectItem value="high">عالي</SelectItem>
                  <SelectItem value="urgent">عاجل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>تاريخ الاستحقاق</Label>
              <Input type="date" value={form.due_date} onChange={(event) => set("due_date", event.target.value)} />
            </div>
          </div>
          <TaskAttachmentPicker attachments={attachments} onChange={setAttachments} />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "جار الإسناد..." : "إسناد المهمة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
