"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare, ListChecks, Paperclip, Send, Timer } from "lucide-react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoleContext } from "@/providers/RoleProvider";
import { useTasks } from "@/hooks/use-data";
import { updateMyTaskAssignment, createMyTaskUpdate } from "@/lib/services/tasks";
import { PageSkeleton } from "@/components/Skeletons";

const statusStyles: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  delayed: "bg-slate-100 text-slate-600 border-slate-200",
};

const statusLabels: Record<string, string> = {
  pending: "معلق",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  delayed: "متأخر",
};

const priorityLabels: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط",
  high: "عالي",
  urgent: "عاجل",
};

type TaskRecord = Record<string, unknown>;

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

export default function MyTasksPage() {
  const { currentUser } = useRoleContext();
  const { data: tasks, loading, refetch } = useTasks();
  const searchParams = useSearchParams();
  const selectedTaskId = searchParams.get("task") || "";

  useEffect(() => {
    if (!selectedTaskId || loading) return;
    document.getElementById(`task-${selectedTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedTaskId, loading]);

  if (loading) return <PageSkeleton />;

  const myTasks = (tasks as TaskRecord[]).filter((t) => {
    const assignments = Array.isArray(t.assignments) ? (t.assignments as TaskRecord[]) : [];
    return assignments.some(
      (a) => String((a.employee as TaskRecord | undefined)?.id ?? "") === currentUser?.employeeId
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مهامي</h1>
        <p className="text-gray-500 text-sm mt-1">المهام المكلَّف بها، تابع تقدمها وأرسل رسائلك.</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {myTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckSquare className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">لا توجد مهام مكلَّف بها</p>
              <p className="text-xs text-gray-500 mt-1">ستظهر هنا المهام التي يتم إسنادها إليك.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-600">المهمة</TableHead>
                  <TableHead className="font-semibold text-gray-600">الأولوية</TableHead>
                  <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                  <TableHead className="font-semibold text-gray-600">الاستحقاق</TableHead>
                  <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myTasks.map((taskRecord) => {
                  const assignments = Array.isArray(taskRecord.assignments)
                    ? (taskRecord.assignments as TaskRecord[])
                    : [];
                  const myAssignment = assignments.find(
                    (a) => String((a.employee as TaskRecord | undefined)?.id ?? "") === currentUser?.employeeId
                  );
                  const updates = Array.isArray(taskRecord.updates)
                    ? (taskRecord.updates as TaskRecord[])
                    : [];
                  const latestUpdate = updates
                    .slice()
                    .sort((a, b) => {
                      const aTime = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
                      const bTime = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
                      return bTime - aTime;
                    })[0];
                  const taskId = String(taskRecord.id ?? "");
                  const title = typeof taskRecord.title === "string" ? taskRecord.title : "—";
                  const description = typeof taskRecord.description === "string" ? taskRecord.description : "";
                  const priority = typeof taskRecord.priority === "string" ? taskRecord.priority : "medium";
                  const status = typeof myAssignment?.status === "string"
                    ? myAssignment.status
                    : typeof taskRecord.status === "string" ? taskRecord.status : "pending";
                  const dueDate = typeof taskRecord.due_date === "string" ? taskRecord.due_date : "—";
                  return (
                    <TableRow
                      key={taskId}
                      id={`task-${taskId}`}
                      className={selectedTaskId === taskId ? "bg-amber-50 ring-1 ring-amber-300" : undefined}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{title}</span>
                          <span className="text-xs text-gray-500">
                            {description}
                            {latestUpdate?.note ? ` · ${latestUpdate.note}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600">{priorityLabels[priority] || priority}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusStyles[status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                          {statusLabels[status] || status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-600">{dueDate}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <TaskHistoryDialog title={title} updates={updates} />
                          {myAssignment && (
                            <TaskMessageUpdateDialog
                              taskId={taskId}
                              status={status}
                              onSuccess={refetch}
                            />
                          )}
                          {myAssignment && (
                            <TaskUpdateButtons
                              assignmentId={String(myAssignment.id ?? "")}
                              onSuccess={refetch}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskUpdateButtons({
  assignmentId,
  onSuccess,
}: {
  assignmentId: string;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState("in_progress");
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const openStatusDialog = (status: string) => {
    setTargetStatus(status);
    setError("");
    setOpen(true);
  };

  const updateStatus = async () => {
    setSubmitting(true);
    setError("");
    const { error: assignmentError } = await updateMyTaskAssignment({
      assignment_id: assignmentId,
      status: targetStatus,
      note: note.trim(),
      attachments,
    });
    if (assignmentError) { setError(assignmentError.message); setSubmitting(false); return; }
    setSubmitting(false);
    setOpen(false);
    setNote("");
    setAttachments([]);
    onSuccess();
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" className="text-blue-600 hover:bg-blue-50" disabled={submitting} onClick={() => openStatusDialog("in_progress")} title="قيد التنفيذ">
        <Timer className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" className="text-green-600 hover:bg-green-50" disabled={submitting} onClick={() => openStatusDialog("completed")} title="مكتمل">
        <CheckSquare className="w-4 h-4" />
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>تحديث حالة المهمة</DialogTitle>
            <DialogDescription>
              {targetStatus === "completed" ? "أكّد إنجاز المهمة ويمكنك إرفاق إثبات." : "ابدأ تنفيذ المهمة ويمكنك إرسال رسالة أو مرفق."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="space-y-2">
              <Label>رسالة اختيارية</Label>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="اكتب أي تفاصيل مرتبطة بالتحديث..." />
            </div>
            <TaskAttachmentPicker attachments={attachments} onChange={setAttachments} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button className="bg-brand hover:bg-brand-dark text-white" onClick={updateStatus} disabled={submitting}>
              {submitting ? "جارٍ الحفظ..." : "حفظ التحديث"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskHistoryDialog({ title, updates }: { title: string; updates: TaskRecord[] }) {
  const sorted = updates.slice().sort((a, b) => {
    const aT = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const bT = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    return bT - aT;
  });

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="سجل التحديثات" />}>
        <ListChecks className="w-4 h-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>سجل تحديثات المهمة</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {sorted.map((u, i) => {
            const emp = (u.employee ?? null) as TaskRecord | null;
            const empName = typeof emp?.full_name === "string" ? emp.full_name : "";
            const status = typeof u.status === "string" ? u.status : "";
            const note = typeof u.note === "string" ? u.note : "لا توجد رسالة";
            const createdAt = typeof u.created_at === "string" ? u.created_at : "";
            const attachments = Array.isArray(u.attachments) ? u.attachments as TaskRecord[] : [];
            return (
              <div key={`${createdAt}-${i}`} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={statusStyles[status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                    {statusLabels[status] || status}
                  </Badge>
                  <span className="text-xs text-gray-500">{createdAt ? new Date(createdAt).toLocaleString("ar-EG") : ""}</span>
                </div>
                <p className="text-sm text-gray-700 mt-2">{note}</p>
                {empName && <p className="text-xs text-gray-500 mt-1">بواسطة {empName}</p>}
                {attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map((attachment, attachmentIndex) => {
                      const url = String(attachment.url || "");
                      const filename = String(attachment.filename || "ملف");
                      const type = String(attachment.type || "");
                      return (
                        <a key={`${url}-${attachmentIndex}`} href={url} target="_blank" rel="noreferrer" className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-brand hover:bg-brand-light">
                          {type.startsWith("image/") ? "صورة" : "ملف"}: {filename}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {sorted.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">لا توجد تحديثات بعد.</div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>إغلاق</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskMessageUpdateDialog({ taskId, status, onSuccess }: {
  taskId: string; status: string; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!note.trim() && attachments.length === 0) return;
    setSubmitting(true);
    const { error: updateError } = await createMyTaskUpdate({
      task_id: taskId,
      status,
      progress: status === "completed" ? 100 : 50,
      note: note.trim() || "تم إرفاق ملف على المهمة.",
      attachments,
    });
    if (updateError) { setError(updateError.message); setSubmitting(false); return; }
    setSubmitting(false); setOpen(false); setNote(""); setAttachments([]); onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="إرسال رسالة" />}>
        <Send className="w-4 h-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>إرسال رسالة</DialogTitle>
          <DialogDescription>أرسل تحديثًا أو ملفًا متعلقًا بهذه المهمة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label>الرسالة</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اكتب رسالتك بخصوص المهمة..." />
          <TaskAttachmentPicker attachments={attachments} onChange={setAttachments} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || (!note.trim() && attachments.length === 0)}>
            {submitting ? "جارٍ الإرسال..." : "إرسال الرسالة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
