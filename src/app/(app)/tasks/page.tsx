"use client";

import React, { useState } from "react";
import { CheckSquare, Plus, Timer } from "lucide-react";
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
import { useTasks, useEmployees, useLocations } from "@/hooks/use-data";
import { createTask, assignTask, updateTask, updateTaskAssignment, createTaskUpdate } from "@/lib/services/tasks";
import { PageSkeleton } from "@/components/Skeletons";

const statusStyles: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  delayed: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function TasksPage() {
  const { currentUser } = useRoleContext();
  const { data: tasks, loading, refetch } = useTasks();
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();

  const isAdmin = currentUser?.role === "Admin";

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-gray-500 text-sm mt-1">Assign, track, and complete operational work.</p>
        </div>
        {isAdmin && (
          <CreateTaskDialog
            employees={employees}
            locations={locations}
            onSuccess={refetch}
          />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Task</TableHead>
                <TableHead className="font-semibold text-gray-600">Priority</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="font-semibold text-gray-600">Due</TableHead>
                <TableHead className="font-semibold text-gray-600">Location</TableHead>
                <TableHead className="font-semibold text-gray-600">Assignees</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const assignments = task.assignments || [];
                const myAssignment = assignments.find((a: Record<string, unknown>) => a.employee?.id === currentUser?.employeeId);
                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{task.title}</span>
                        <span className="text-xs text-gray-500">{task.description || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">{task.priority || "medium"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyles[task.status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{task.due_date || "—"}</TableCell>
                    <TableCell className="text-gray-600">{task.location?.name || "—"}</TableCell>
                    <TableCell className="text-gray-600">
                      {assignments.length ? assignments.map((a: Record<string, unknown>) => a.employee?.full_name).join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {myAssignment && (
                        <TaskUpdateButtons
                          assignmentId={myAssignment.id}
                          taskId={task.id}
                          orgId={currentUser?.orgId || ""}
                          employeeId={currentUser?.employeeId || ""}
                          onSuccess={refetch}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckSquare className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No tasks yet</p>
              <p className="text-xs text-gray-500 mt-1">Create your first task to start assigning work.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateTaskDialog({
  employees,
  locations,
  onSuccess,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  locations: any[];
  onSuccess: () => void;
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
    location_id: "",
    employee_id: "",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.title) return;
    setSubmitting(true);
    setError("");

    const { data, error: err } = await createTask({
      org_id: currentUser.orgId,
      title: form.title,
      description: form.description || undefined,
      priority: form.priority,
      due_date: form.due_date || undefined,
      location_id: form.location_id || undefined,
      created_by: currentUser.id,
    });

    if (err || !data) {
      setError(err?.message || "Failed to create task");
      setSubmitting(false);
      return;
    }

    if (form.employee_id) {
      await assignTask({
        org_id: currentUser.orgId,
        task_id: data.id,
        employee_id: form.employee_id,
        status: "pending",
      });
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ title: "", description: "", priority: "medium", due_date: "", location_id: "", employee_id: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 mr-2" />
        Create Task
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>Assign work with priority and due dates.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Audit check-in logs" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Details and expectations" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={form.location_id} onValueChange={(v) => set("location_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{String(loc.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assign To</Label>
              <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.title}>
            {submitting ? "Creating..." : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskUpdateButtons({
  assignmentId,
  taskId,
  orgId,
  employeeId,
  onSuccess,
}: {
  assignmentId: string;
  taskId: string;
  orgId: string;
  employeeId: string;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const updateStatus = async (status: string) => {
    setSubmitting(true);
    setError("");

    const { error: assignmentError } = await updateTaskAssignment(assignmentId, { status });
    if (assignmentError) {
      setError(assignmentError.message);
      setSubmitting(false);
      return;
    }

    const { error: taskError } = await updateTask(taskId, { status });
    const { error: updateError } = await createTaskUpdate({
      org_id: orgId,
      task_id: taskId,
      employee_id: employeeId || undefined,
      status,
      progress: status === "completed" ? 100 : 50,
      note: status === "completed" ? "Marked complete" : "Started work",
    });

    if (taskError || updateError) {
      setError(taskError?.message || updateError?.message || "Failed to update task");
    }

    setSubmitting(false);
    onSuccess();
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="text-blue-600 hover:text-blue-700"
        disabled={submitting}
        onClick={() => updateStatus("in_progress")}
      >
        <Timer className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-green-600 hover:text-green-700"
        disabled={submitting}
        onClick={() => updateStatus("completed")}
      >
        <CheckSquare className="w-4 h-4" />
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
