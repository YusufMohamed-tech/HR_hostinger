"use client";

import React, { useState } from "react";
import { CalendarDays, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/feedback-dialog";
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
import { useEmployees, useShifts, useEmployeeShifts, useLocations } from "@/hooks/use-data";
import { assignEmployeeShift, deleteShift, removeEmployeeShift, updateShift } from "@/lib/services/schedule";
import { AddShiftDialog } from "@/components/forms/AddShiftDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function SchedulePage() {
  const { currentUser } = useRoleContext();
  const { data: shifts, loading: loadingShifts, refetch: refetchShifts } = useShifts();
  const { data: employees } = useEmployees();
  const canManageSchedule = ["Superadmin", "Admin", "HR_Admin"].includes(currentUser?.role || "");
  const assignmentEmployeeId = canManageSchedule ? undefined : currentUser?.employeeId;
  const { data: assignments, loading: loadingAssignments, refetch: refetchAssignments } = useEmployeeShifts(assignmentEmployeeId, {
    requireEmployee: !canManageSchedule,
  });

  if (loadingShifts || loadingAssignments) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الجداول</h1>
          <p className="text-gray-500 text-sm mt-1">
            إدارة قوالب الورديات وتعيين الجداول للموظفين.
          </p>
        </div>
        {canManageSchedule && (
          <div className="flex flex-col sm:flex-row gap-2">
            <AddShiftDialog onSuccess={refetchShifts} existingShifts={shifts} />
            <AssignShiftDialog
              employees={employees}
              shifts={shifts}
              onSuccess={refetchAssignments}
            />
          </div>
        )}
      </div>

      {canManageSchedule && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-0">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">الورديات</h2>
              <p className="mt-1 text-sm text-gray-500">قوالب الورديات المتاحة لاستخدامها عند إسناد الجداول.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-600">اسم الوردية</TableHead>
                  <TableHead className="font-semibold text-gray-600">النوع</TableHead>
                  <TableHead className="font-semibold text-gray-600">الوقت</TableHead>
                  <TableHead className="font-semibold text-gray-600">الموقع</TableHead>
                  <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((shift) => {
                  const shiftRecord = shift as Record<string, unknown>;
                  const shiftId = String(shiftRecord.id ?? "");
                  const shiftName = typeof shiftRecord.name === "string" ? shiftRecord.name : "—";
                  const shiftType = typeof shiftRecord.shift_type === "string" ? shiftRecord.shift_type : "—";
                  const shiftStart = typeof shiftRecord.start_time === "string" ? shiftRecord.start_time : "—";
                  const shiftEnd = typeof shiftRecord.end_time === "string" ? shiftRecord.end_time : "—";
                  const shiftLocation = (shiftRecord.location ?? null) as Record<string, unknown> | null;
                  const shiftLocationName = typeof shiftLocation?.name === "string" ? shiftLocation.name : "—";

                  return (
                    <TableRow key={shiftId}>
                      <TableCell className="font-medium text-gray-900">{shiftName}</TableCell>
                      <TableCell className="text-gray-600">{shiftType}</TableCell>
                      <TableCell className="text-gray-600">{shiftStart} - {shiftEnd}</TableCell>
                      <TableCell className="text-gray-600">{shiftLocationName}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <EditShiftDialog
                            shift={shiftRecord}
                            existingShifts={shifts}
                            onSuccess={() => {
                              refetchShifts();
                              refetchAssignments();
                            }}
                          />
                          <ConfirmActionButton
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            title="حذف الوردية"
                            description="حذف الوردية سيحذف إسناداتها من الموظفين. هل تريد المتابعة؟"
                            confirmLabel="حذف"
                            destructive
                            onConfirm={async () => {
                              await deleteShift(shiftId);
                              refetchShifts();
                              refetchAssignments();
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </ConfirmActionButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {shifts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-900">لا توجد ورديات بعد</p>
                <p className="text-xs text-gray-500 mt-1">أنشئ وردية أولًا ثم اسندها للموظفين.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">{canManageSchedule ? "إسنادات الورديات" : "ورديتي"}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {canManageSchedule ? "الموظفون المرتبطون بورديات محددة وتواريخ الإسناد." : "الوردية المسندة لك وتفاصيل الموقع والوقت."}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">الموظف</TableHead>
                <TableHead className="font-semibold text-gray-600">الوردية</TableHead>
                <TableHead className="font-semibold text-gray-600">النوع</TableHead>
                <TableHead className="font-semibold text-gray-600">الوقت</TableHead>
                <TableHead className="font-semibold text-gray-600">الموقع</TableHead>
                <TableHead className="font-semibold text-gray-600">التواريخ</TableHead>
                {canManageSchedule && <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>}
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
                    {canManageSchedule && (
                      <TableCell className="text-right">
                        <ConfirmActionButton
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          title="حذف إسناد الوردية"
                          description="سيتم حذف إسناد هذه الوردية من الموظف. هل تريد المتابعة؟"
                          confirmLabel="حذف"
                          destructive
                          onConfirm={async () => {
                            await removeEmployeeShift(assignmentId);
                            refetchAssignments();
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </ConfirmActionButton>
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
              <p className="text-sm font-medium text-gray-900">لا توجد إسنادات بعد</p>
              <p className="text-xs text-gray-500 mt-1">أسند وردية للبدء في بناء الجداول.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditShiftDialog({
  shift,
  existingShifts,
  onSuccess,
}: {
  shift: Record<string, unknown>;
  existingShifts: Record<string, unknown>[];
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const { data: locations } = useLocations();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: String(shift.name || ""),
    shift_type: String(shift.shift_type || "morning"),
    start_time: String(shift.start_time || "08:00"),
    end_time: String(shift.end_time || "16:00"),
    location_id: String(shift.location_id || ""),
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    const shiftId = String(shift.id || "");
    const orgId = currentUser?.orgId || String(shift.org_id || "");
    const normalizedName = form.name.trim().toLowerCase();

    if (!shiftId || !orgId || !normalizedName) return;

    const hasDuplicate = existingShifts.some((existingShift) =>
      String(existingShift.id || "") !== shiftId &&
      String(existingShift.name || "").trim().toLowerCase() === normalizedName
    );

    if (hasDuplicate) {
      setError("يوجد وردية بنفس الاسم بالفعل. اختر اسمًا مختلفًا.");
      return;
    }

    setSubmitting(true);
    setError("");

    const { error: err } = await updateShift(shiftId, {
      org_id: orgId,
      name: form.name,
      shift_type: form.shift_type,
      start_time: form.start_time,
      end_time: form.end_time,
      location_id: form.location_id || null,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" title="تعديل الوردية" />}>
        <Pencil className="w-4 h-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>تعديل الوردية</DialogTitle>
          <DialogDescription>عدّل اسم الوردية ووقتها والموقع المرتبط بها.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الاسم *</Label>
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نوع الوردية</Label>
              <Select value={form.shift_type} onValueChange={(value) => set("shift_type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">صباحية</SelectItem>
                  <SelectItem value="night">ليلية</SelectItem>
                  <SelectItem value="flexible">مرنة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الموقع</Label>
              <Select value={form.location_id} onValueChange={(value) => set("location_id", value)}>
                <SelectTrigger><SelectValue placeholder="اختر الموقع" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={String(location.id)} value={String(location.id)}>
                      {String(location.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>وقت البداية</Label>
              <Input type="time" value={form.start_time} onChange={(event) => set("start_time", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>وقت النهاية</Label>
              <Input type="time" value={form.end_time} onChange={(event) => set("end_time", event.target.value)} />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
            {submitting ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        إسناد وردية
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>إسناد وردية</DialogTitle>
          <DialogDescription>ربط قالب وردية بموظف.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الموظف *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الوردية *</Label>
            <Select value={form.shift_id} onValueChange={(v) => set("shift_id", v)}>
              <SelectTrigger><SelectValue placeholder="اختر الوردية" /></SelectTrigger>
              <SelectContent>
                {shifts.map((shift) => (
                  <SelectItem key={shift.id} value={String(shift.id)}>{String(shift.name)}</SelectItem>
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
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.employee_id || !form.shift_id}>
            {submitting ? "جار الإسناد..." : "إسناد وردية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
