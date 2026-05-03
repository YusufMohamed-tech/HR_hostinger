"use client";

import React, { useState } from "react";
import { Clock, Trash2, Plus, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useRoleContext } from "@/providers/RoleProvider";
import { useEmployees } from "@/hooks/use-data";
import { createAvailability, deleteAvailability, getAvailability } from "@/lib/services/availability";
import { PageSkeleton } from "@/components/Skeletons";
import { useEffect, useCallback } from "react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AvailabilityPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [availability, setAvailability] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAvailability = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = await getAvailability(currentUser.orgId);
    setAvailability(data || []);
    setLoading(false);
  }, [currentUser?.orgId]);

  useEffect(() => { fetchAvailability(); }, [fetchAvailability]);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this availability entry?")) return;
    await deleteAvailability(id, currentUser?.orgId || "", currentUser?.id);
    fetchAvailability();
  };

  const isAdmin = currentUser?.role === "Super Admin" || currentUser?.role === "Admin" || currentUser?.role === "Team Leader";

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employee Availability</h1>
          <p className="text-gray-500 text-sm mt-1">
            Declare available hours per weekday for scheduling.
          </p>
        </div>
        {isAdmin && <AddAvailabilityDialog employees={employees} onSuccess={fetchAvailability} />}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Availability Matrix
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Day</TableHead>
                <TableHead className="font-semibold text-gray-600">Start</TableHead>
                <TableHead className="font-semibold text-gray-600">End</TableHead>
                <TableHead className="font-semibold text-gray-600">Notes</TableHead>
                {isAdmin && <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {availability.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-gray-900">{row.employee?.full_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      {WEEKDAYS[row.weekday] || row.weekday}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600">{row.start_time || "—"}</TableCell>
                  <TableCell className="text-gray-600">{row.end_time || "—"}</TableCell>
                  <TableCell className="text-gray-500 text-xs">{row.notes || "—"}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(row.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {availability.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No availability data</p>
              <p className="text-xs text-gray-500 mt-1">Add employee availability to enable smart scheduling.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Add Availability Dialog ─── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AddAvailabilityDialog({ employees, onSuccess }: { employees: any[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", weekday: "1", start_time: "08:00", end_time: "16:00", notes: "" });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.employee_id || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createAvailability(
      {
        org_id: currentUser.orgId,
        employee_id: form.employee_id,
        weekday: parseInt(form.weekday),
        start_time: form.start_time,
        end_time: form.end_time,
        notes: form.notes || undefined,
      },
      currentUser.id
    );

    if (err) { setError(err.message); setSubmitting(false); return; }
    setSubmitting(false);
    setOpen(false);
    setForm({ employee_id: "", weekday: "1", start_time: "08:00", end_time: "16:00", notes: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 mr-2" />
        Add Availability
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Availability</DialogTitle>
          <DialogDescription>Set an employee&apos;s available hours for a weekday.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Employee *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name || emp.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Weekday *</Label>
            <Select value={form.weekday} onValueChange={(v) => set("weekday", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, i) => (
                  <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Prefers morning shifts" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.employee_id}>
            {submitting ? "Adding..." : "Add Availability"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
