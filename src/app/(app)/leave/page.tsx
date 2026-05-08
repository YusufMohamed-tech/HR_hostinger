"use client";

import React, { useState } from "react";
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
import { createLeaveRequest, updateLeaveRequest } from "@/lib/services/leaves";
import { PageSkeleton } from "@/components/Skeletons";

const statusStyle: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export default function LeavePage() {
  const { currentUser } = useRoleContext();
  const { data: leaveRequests, loading, refetch } = useLeaveRequests();
  const { data: balances } = useLeaveBalances(currentUser?.employeeId);
  const isAdmin = currentUser?.role === "Admin";
  const visibleRequests = isAdmin
    ? leaveRequests
    : leaveRequests.filter((req) => String((req as Record<string, unknown>).employee_id ?? "") === currentUser?.employeeId);
  const balance = (balances[0] ?? null) as Record<string, unknown> | null;
  const sickRemaining = typeof balance?.sick_remaining === "number" ? balance.sick_remaining : 0;
  const vacationRemaining = typeof balance?.vacation_remaining === "number" ? balance.vacation_remaining : 0;
  const emergencyRemaining = typeof balance?.emergency_remaining === "number" ? balance.emergency_remaining : 0;

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave Requests</h1>
          <p className="text-gray-500 text-sm mt-1">Submit, approve, and track time-off requests.</p>
        </div>
        {!isAdmin && <CreateLeaveDialog onSuccess={refetch} />}
      </div>

      {!isAdmin && balances.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardContent className="py-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Sick</p>
              <p className="font-semibold text-gray-900">{sickRemaining}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Vacation</p>
              <p className="font-semibold text-gray-900">{vacationRemaining}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Emergency</p>
              <p className="font-semibold text-gray-900">{emergencyRemaining}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Type</TableHead>
                <TableHead className="font-semibold text-gray-600">Dates</TableHead>
                <TableHead className="font-semibold text-gray-600">Days</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="font-semibold text-gray-600">Reason</TableHead>
                {isAdmin && <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRequests.map((req) => {
                const reqRecord = req as Record<string, unknown>;
                const reqId = String(reqRecord.id ?? "");
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
                  <TableCell className="text-gray-600">{leaveType}</TableCell>
                  <TableCell className="text-gray-600">{startDateStr || "—"} → {endDateStr || "—"}</TableCell>
                  <TableCell className="text-gray-600">{dayCount ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusStyle[status] || "bg-gray-100 text-gray-600 border-gray-200"}>
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600">{reason}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 hover:text-green-700"
                          onClick={async () => {
                            await updateLeaveRequest(reqId, { status: "approved", decided_at: new Date().toISOString(), decided_by: currentUser?.id || undefined });
                            refetch();
                          }}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={async () => {
                            await updateLeaveRequest(reqId, { status: "rejected", decided_at: new Date().toISOString(), decided_by: currentUser?.id || undefined });
                            refetch();
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
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
              <p className="text-sm font-medium text-gray-900">No leave requests yet</p>
              <p className="text-xs text-gray-500 mt-1">Submit a request to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateLeaveDialog({ onSuccess }: { onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "vacation", start_date: "", end_date: "", reason: "" });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !currentUser?.employeeId || !form.start_date || !form.end_date) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createLeaveRequest({
      org_id: currentUser.orgId,
      employee_id: currentUser.employeeId,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || undefined,
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
        Request Leave
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Request Leave</DialogTitle>
          <DialogDescription>Submit time off for approval.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Leave Type</Label>
            <Select value={form.leave_type} onValueChange={(v) => set("leave_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sick">Sick</SelectItem>
                <SelectItem value="vacation">Vacation</SelectItem>
                <SelectItem value="emergency">Emergency</SelectItem>
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
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Optional" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.start_date || !form.end_date}>
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
