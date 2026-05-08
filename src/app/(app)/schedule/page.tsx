"use client";

import React, { useState } from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useEmployees, useShifts, useEmployeeShifts } from "@/hooks/use-data";
import { assignEmployeeShift, removeEmployeeShift } from "@/lib/services/schedule";
import { AddShiftDialog } from "@/components/forms/AddShiftDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function SchedulePage() {
  const { currentUser } = useRoleContext();
  const { data: shifts, loading: loadingShifts, refetch: refetchShifts } = useShifts();
  const { data: employees } = useEmployees();
  const { data: assignments, loading: loadingAssignments, refetch: refetchAssignments } = useEmployeeShifts();

  const isAdmin = currentUser?.role === "Admin";

  if (loadingShifts || loadingAssignments) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage shift templates and assign schedules to employees.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2">
            <AddShiftDialog onSuccess={refetchShifts} />
            <AssignShiftDialog
              employees={employees}
              shifts={shifts}
              onSuccess={refetchAssignments}
            />
          </div>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Shift</TableHead>
                <TableHead className="font-semibold text-gray-600">Type</TableHead>
                <TableHead className="font-semibold text-gray-600">Time</TableHead>
                <TableHead className="font-semibold text-gray-600">Location</TableHead>
                <TableHead className="font-semibold text-gray-600">Dates</TableHead>
                {isAdmin && <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => {
                const assignmentRecord = assignment as Record<string, unknown>;
                const assignmentId = String(assignmentRecord.id ?? "");
                const employee = (assignmentRecord.employee ?? null) as Record<string, unknown> | null;
                const employeeName = typeof employee?.full_name === "string" ? employee.full_name : "—";
                const shift = (assignmentRecord.shift ?? null) as Record<string, unknown> | null;
                const shiftName = typeof shift?.name === "string" ? shift.name : "—";
                const shiftType = typeof shift?.shift_type === "string" ? shift.shift_type : "—";
                const shiftStart = typeof shift?.start_time === "string" ? shift.start_time : "—";
                const shiftEnd = typeof shift?.end_time === "string" ? shift.end_time : "—";
                const shiftLocation = (shift?.location ?? null) as Record<string, unknown> | null;
                const shiftLocationName = typeof shiftLocation?.name === "string" ? shiftLocation.name : "—";
                const startDate = typeof assignmentRecord.start_date === "string" ? assignmentRecord.start_date : "—";
                const endDate = typeof assignmentRecord.end_date === "string" ? assignmentRecord.end_date : "";

                return (
                  <TableRow key={assignmentId}>
                    <TableCell className="font-medium text-gray-900">
                      {employeeName}
                    </TableCell>
                    <TableCell className="text-gray-700">{shiftName}</TableCell>
                    <TableCell className="text-gray-600">{shiftType}</TableCell>
                    <TableCell className="text-gray-600">
                      {shiftStart} - {shiftEnd}
                    </TableCell>
                    <TableCell className="text-gray-600">{shiftLocationName}</TableCell>
                    <TableCell className="text-gray-600">
                      {startDate} {endDate ? `→ ${endDate}` : ""}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={async () => {
                            if (!confirm("Remove this assignment?")) return;
                            await removeEmployeeShift(assignmentId);
                            refetchAssignments();
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {assignments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No assignments yet</p>
              <p className="text-xs text-gray-500 mt-1">Assign a shift to start building schedules.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignShiftDialog({
  employees,
  shifts,
  onSuccess,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shifts: any[];
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", shift_id: "", start_date: "", end_date: "" });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.employee_id || !form.shift_id) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await assignEmployeeShift({
      org_id: currentUser.orgId,
      employee_id: form.employee_id,
      shift_id: form.shift_id,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ employee_id: "", shift_id: "", start_date: "", end_date: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Assign Shift
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Assign Shift</DialogTitle>
          <DialogDescription>Attach a shift template to an employee.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Employee *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Shift *</Label>
            <Select value={form.shift_id} onValueChange={(v) => set("shift_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {shifts.map((shift) => (
                  <SelectItem key={shift.id} value={String(shift.id)}>{String(shift.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.employee_id || !form.shift_id}>
            {submitting ? "Assigning..." : "Assign Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
