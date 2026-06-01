"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare, ListChecks, MessageSquare, Pencil, Plus, Send, Timer } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoleContext } from "@/providers/RoleProvider";
import { useTasks, useEmployees } from "@/hooks/use-data";
import { createManagerTask, createTask, assignTask, updateManagerTask, updateMyTaskAssignment, updateTask, updateTaskAssignment, createTaskUpdate, createMyTaskUpdate, sendTaskMessage } from "@/lib/services/tasks";
import { notifyTaskAssigned } from "@/lib/services/notification-triggers";
import { PageSkeleton } from "@/components/Skeletons";
import { getValidationMessage, taskFormSchema } from "@/lib/validation";

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

function TasksTable({
  tasks,
  currentUser,
  refetch,
  employees,
  canEdit,
  managerMode,
  selectedTaskId,
}: {
  tasks: TaskRecord[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentUser: any;
  refetch: () => void;
  employees: TaskRecord[];
  canEdit: boolean;
  managerMode: boolean;
  selectedTaskId: string;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckSquare className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-900">لا توجد مهام حتى الآن</p>
        <p className="text-xs text-gray-500 mt-1">أنشئ أول مهمة لبدء إسناد الأعمال.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
          <TableHead className="font-semibold text-gray-600">المهمة</TableHead>
          <TableHead className="font-semibold text-gray-600">الأولوية</TableHead>
          <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
          <TableHead className="font-semibold text-gray-600">الاستحقاق</TableHead>
          <TableHead className="font-semibold text-gray-600">المكلفون</TableHead>
          <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((taskRecord) => {
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
          const firstAssignment = assignments[0];
          const firstAssignee = (firstAssignment?.employee ?? null) as TaskRecord | null;
          const assignmentStatus = typeof firstAssignment?.status === "string" ? firstAssignment.status : "";
          const myAssignmentStatus = typeof myAssignment?.status === "string" ? myAssignment.status : "";
          const status = myAssignmentStatus || assignmentStatus || (typeof taskRecord.status === "string" ? taskRecord.status : "pending");
          const dueDate = typeof taskRecord.due_date === "string" ? taskRecord.due_date : "—";
          const assignees = assignments
            .map((a) => {
              const emp = (a.employee ?? null) as TaskRecord | null;
              return typeof emp?.full_name === "string" ? emp.full_name : null;
            })
            .filter((n): n is string => Boolean(n));

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
              <TableCell className="text-gray-600">
                {assignees.length ? assignees.join("، ") : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <TaskHistoryDialog title={title} updates={updates} />
                  {canEdit && (
                    <EditTaskDialog
                      task={taskRecord}
                      employees={employees}
                      managerMode={managerMode}
                      onSuccess={refetch}
                    />
                  )}
                  {canEdit && firstAssignee && (
                    <TaskMessageDialog
                      taskId={taskId}
                      assigneeId={String(firstAssignee.id || "")}
                      assigneeName={String(firstAssignee.full_name || "الموظف")}
                      onSuccess={refetch}
                    />
                  )}
                  {myAssignment && (
                    <TaskNoteDialog
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
  );
}

export default function TasksPage() {
  const { currentUser } = useRoleContext();
  const { data: tasks, loading, refetch } = useTasks();
  const { data: employees } = useEmployees();
  const searchParams = useSearchParams();
  const selectedTaskId = searchParams.get("task") || "";

  useEffect(() => {
    if (!selectedTaskId || loading) return;
    document.getElementById(`task-${selectedTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedTaskId, loading]);

  const isOrgAdmin = ["Superadmin", "Admin"].includes(currentUser?.role || "");
  const isHrAdmin = currentUser?.role === "HR_Admin";
  const canAssignTasks = isOrgAdmin || isHrAdmin;
  const isManager = currentUser?.role === "Training_Manager";

  if (loading) return <PageSkeleton />;

  const allTaskRecords = tasks as TaskRecord[];
  const teamEmployees = isManager
    ? employees.filter((employee) => String((employee as TaskRecord).manager_id || "") === currentUser?.employeeId)
    : employees;
  const teamEmployeeIds = new Set(teamEmployees.map((employee) => String((employee as TaskRecord).id || "")));

  const myTasks = allTaskRecords.filter((t) => {
    const assignments = Array.isArray(t.assignments) ? (t.assignments as TaskRecord[]) : [];
    return assignments.some(
      (a) => String((a.employee as TaskRecord | undefined)?.id ?? "") === currentUser?.employeeId
    );
  });
  const managerTasks = allTaskRecords.filter((task) => {
    const assignments = Array.isArray(task.assignments) ? (task.assignments as TaskRecord[]) : [];
    return assignments.some((assignment) => {
      const employeeId = String((assignment.employee as TaskRecord | undefined)?.id ?? "");
      return employeeId === currentUser?.employeeId || teamEmployeeIds.has(employeeId);
    });
  });
  const hrCreatedTasks = allTaskRecords.filter((task) => String(task.created_by || "") === currentUser?.id);
  const visibleTasks = isOrgAdmin ? allTaskRecords : isHrAdmin ? hrCreatedTasks : isManager ? managerTasks : myTasks;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{canAssignTasks || isManager ? "إسناد المهام" : "مهامي"}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {canAssignTasks || isManager ? "إسناد ومتابعة المهام التشغيلية وتتبعها." : "المهام المكلَّف بها، تابع تقدمها وأضف ملاحظاتك."}
          </p>
        </div>
        {(canAssignTasks || isManager) && (
          <CreateTaskDialog employees={teamEmployees} onSuccess={refetch} managerMode={isManager} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <TasksTable
            tasks={visibleTasks}
            currentUser={currentUser}
            refetch={refetch}
            employees={teamEmployees}
            canEdit={canAssignTasks || isManager}
            managerMode={isManager}
            selectedTaskId={selectedTaskId}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CreateTaskDialog({
  employees,
  onSuccess,
  managerMode = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any[];
  onSuccess: () => void;
  managerMode?: boolean;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    due_date: "",
    employee_id: "",
    initial_message: "",
  });

  const set = (key: string, value: string | null) =>
    setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId) return;
    if (!form.employee_id) {
      setError(managerMode ? "اختر موظفًا من فريقك لتكليفه بالمهمة." : "اختر الموظف المكلف بالمهمة.");
      return;
    }

    const parsed = taskFormSchema.safeParse({ ...form, location_id: "" });
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      return;
    }

    setSubmitting(true);
    setError("");

    const { data, error: err } = managerMode
      ? await createManagerTask({
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority,
          due_date: parsed.data.due_date,
          employee_id: parsed.data.employee_id,
          initial_message: form.initial_message.trim(),
        })
      : await createTask({
          org_id: currentUser.orgId,
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority,
          due_date: parsed.data.due_date,
          location_id: null,
          created_by: currentUser.id,
        });

    if (err || !data) {
      setError(err?.message || "فشل إنشاء المهمة");
      setSubmitting(false);
      return;
    }

    if (!managerMode && parsed.data.employee_id) {
      await assignTask({
        org_id: currentUser.orgId,
        task_id: data.id,
        employee_id: parsed.data.employee_id,
        status: "pending",
      });
      await createTaskUpdate({
        org_id: currentUser.orgId,
        task_id: data.id,
        employee_id: currentUser.employeeId || undefined,
        status: "pending",
        progress: 0,
        note: form.initial_message.trim() || "تم إسناد المهمة.",
      });
      await notifyTaskAssigned(currentUser.orgId, parsed.data.employee_id, parsed.data.title, String(data.id));
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ title: "", description: "", priority: "medium", due_date: "", employee_id: "", initial_message: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 ml-2" />
        إنشاء مهمة
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>إنشاء مهمة جديدة</DialogTitle>
          <DialogDescription>حدد تفاصيل المهمة وكلّف بها الموظف المناسب.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>العنوان *</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="مثال: مراجعة سجلات الحضور"
            />
          </div>
          <div className="space-y-2">
            <Label>الوصف</Label>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="تفاصيل المهمة والتوقعات"
            />
          </div>
          <div className="space-y-2">
            <Label>رسالة للموظف</Label>
            <Input
              value={form.initial_message}
              onChange={(e) => set("initial_message", e.target.value)}
              placeholder="اكتب تعليمات أو رسالة تظهر للموظف في سجل المهمة"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الأولوية</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
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
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>تكليف إلى</Label>
              <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)}>
                      {String(emp.full_name || emp.name)}
                    </SelectItem>
                ))}
                {employees.length === 0 && (
                  <SelectItem value="__empty" disabled>
                    لا يوجد موظفون في فريقك
                  </SelectItem>
                )}
              </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            onClick={handleSubmit}
            disabled={submitting || !form.title}
          >
            {submitting ? "جارٍ الإنشاء..." : "إنشاء المهمة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  const updateStatus = async (status: string) => {
    setSubmitting(true);
    setError("");

    const { error: assignmentError } = await updateMyTaskAssignment({
      assignment_id: assignmentId,
      status,
    });
    if (assignmentError) {
      setError(assignmentError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSuccess();
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
        disabled={submitting}
        onClick={() => updateStatus("in_progress")}
        title="قيد التنفيذ"
      >
        <Timer className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-green-600 hover:text-green-700 hover:bg-green-50"
        disabled={submitting}
        onClick={() => updateStatus("completed")}
        title="مكتمل"
      >
        <CheckSquare className="w-4 h-4" />
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function EditTaskDialog({
  task,
  employees,
  managerMode,
  onSuccess,
}: {
  task: TaskRecord;
  employees: TaskRecord[];
  managerMode: boolean;
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const assignments = Array.isArray(task.assignments) ? (task.assignments as TaskRecord[]) : [];
  const firstAssignment = assignments[0];
  const assignedEmployee = (firstAssignment?.employee ?? null) as TaskRecord | null;
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: String(task.title || ""),
    description: String(task.description || ""),
    priority: String(task.priority || "medium"),
    due_date: typeof task.due_date === "string" ? task.due_date : "",
    employee_id: String(assignedEmployee?.id || ""),
  });

  const set = (key: string, value: string | null) =>
    setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId) return;
    if (!form.employee_id) {
      setError(managerMode ? "اختر موظفًا من فريقك." : "اختر الموظف المكلف بالمهمة.");
      return;
    }

    const parsed = taskFormSchema.safeParse({ ...form, location_id: "" });
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      return;
    }

    const taskId = String(task.id || "");
    setSubmitting(true);
    setError("");

    const { error: taskError } = managerMode
      ? await updateManagerTask(taskId, {
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority,
          due_date: parsed.data.due_date,
          employee_id: parsed.data.employee_id,
        })
      : await updateTask(taskId, {
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority,
          due_date: parsed.data.due_date,
          location_id: null,
        });

    if (taskError) {
      setError(taskError.message);
      setSubmitting(false);
      return;
    }

    if (!managerMode) {
      const assignmentId = String(firstAssignment?.id || "");
      const assignmentError = assignmentId
        ? (await updateTaskAssignment(assignmentId, { employee_id: parsed.data.employee_id })).error
        : (await assignTask({
            org_id: currentUser.orgId,
            task_id: taskId,
            employee_id: parsed.data.employee_id,
            status: "pending",
          })).error;

      if (assignmentError) {
        setError(assignmentError.message);
        setSubmitting(false);
        return;
      }

      await createTaskUpdate({
        org_id: currentUser.orgId,
        task_id: taskId,
        employee_id: currentUser.employeeId || undefined,
        status: String(task.status || "pending"),
        progress: 0,
        note: "تم تعديل تفاصيل المهمة.",
      });
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="تعديل المهمة" />}>
        <Pencil className="w-4 h-4" />
        <span className="sr-only">تعديل</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>تعديل المهمة</DialogTitle>
          <DialogDescription>عدّل تفاصيل المهمة والموظف المكلف بها.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>العنوان *</Label>
            <Input value={form.title} onChange={(event) => set("title", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الوصف</Label>
            <Input value={form.description} onChange={(event) => set("description", event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الأولوية</Label>
              <Select value={form.priority} onValueChange={(value) => set("priority", value)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
          <div className="space-y-2">
            <Label>تكليف إلى</Label>
            <Select value={form.employee_id} onValueChange={(value) => set("employee_id", value)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.title}>
            {submitting ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskHistoryDialog({
  title,
  updates,
}: {
  title: string;
  updates: TaskRecord[];
}) {
  const sortedUpdates = updates
    .slice()
    .sort((a, b) => {
      const aTime = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
      const bTime = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
      return bTime - aTime;
    });

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="سجل التحديثات" />}>
        <ListChecks className="w-4 h-4" />
        <span className="sr-only">السجل</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>سجل تحديثات المهمة</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {sortedUpdates.map((update, index) => {
            const employee = (update.employee ?? null) as TaskRecord | null;
            const employeeName = typeof employee?.full_name === "string" ? employee.full_name : "";
            const status = typeof update.status === "string" ? update.status : "update";
            const note = typeof update.note === "string" ? update.note : "لا توجد ملاحظة";
            const createdAt = typeof update.created_at === "string" ? update.created_at : "";

            return (
              <div
                key={`${createdAt || "update"}-${index}`}
                className="rounded-lg border border-gray-200 px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className={statusStyles[status] || "bg-gray-100 text-gray-600 border-gray-200"}
                  >
                    {statusLabels[status] || status}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {createdAt ? new Date(createdAt).toLocaleString("ar-EG") : ""}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-700">{note}</p>
                  {employeeName && (
                    <p className="text-xs text-gray-500">بواسطة {employeeName}</p>
                  )}
                </div>
              </div>
            );
          })}
          {sortedUpdates.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
              لا توجد تحديثات بعد.
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>إغلاق</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskMessageDialog({
  taskId,
  assigneeId,
  assigneeName,
  onSuccess,
}: {
  taskId: string;
  assigneeId: string;
  assigneeName: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    setError("");

    const { error: messageError } = await sendTaskMessage({
      task_id: taskId,
      employee_id: assigneeId,
      message: message.trim(),
    });

    if (messageError) {
      setError(messageError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setMessage("");
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" title={`إرسال رسالة إلى ${assigneeName}`} />}>
        <MessageSquare className="w-4 h-4" />
        <span className="sr-only">إرسال رسالة</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>إرسال رسالة إلى {assigneeName}</DialogTitle>
          <DialogDescription>ستظهر الرسالة داخل سجل المهمة وسيصل إشعار للموظف.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          <div className="space-y-2">
            <Label>الرسالة</Label>
            <Input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="اكتب رسالتك للموظف..."
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            onClick={handleSubmit}
            disabled={submitting || !message.trim()}
          >
            <Send className="w-4 h-4 ml-2" />
            {submitting ? "جارٍ الإرسال..." : "إرسال"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskNoteDialog({
  taskId,
  status,
  onSuccess,
}: {
  taskId: string;
  status: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    setError("");

    const { error: updateError } = await createMyTaskUpdate({
      task_id: taskId,
      status,
      progress: status === "completed" ? 100 : 50,
      note: note.trim(),
    });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setNote("");
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="إضافة ملاحظة" />}>
        <MessageSquare className="w-4 h-4" />
        <span className="sr-only">إضافة ملاحظة</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>إضافة ملاحظة</DialogTitle>
          <DialogDescription>شارك تقدمك أو أي سياق متعلق بهذه المهمة.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          <div className="space-y-2">
            <Label>الملاحظة</Label>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="مثال: بدأت العمل، واجهت عائقاً..."
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            onClick={handleSubmit}
            disabled={submitting || !note.trim()}
          >
            {submitting ? "جارٍ الحفظ..." : "حفظ الملاحظة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
