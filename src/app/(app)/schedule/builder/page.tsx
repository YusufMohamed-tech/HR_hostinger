"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CalendarIcon, Users, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLocations, useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { createShift, createShiftAssignment } from "@/lib/services/schedule";

export default function ShiftBuilderPage() {
  const { currentUser } = useRoleContext();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees();

  const [form, setForm] = useState({
    location_id: "",
    shift_date: "",
    start_time: "08:00",
    end_time: "16:00",
    required_headcount: "12",
  });

  const [createdShiftId, setCreatedShiftId] = useState<string | null>(null);
  const [assignedEmployees, setAssignedEmployees] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSaveShift = async () => {
    if (!form.shift_date || !currentUser?.orgId) return;
    setSaving(true);
    setMessage(null);

    const startDt = `${form.shift_date}T${form.start_time}:00`;
    const endDt = `${form.shift_date}T${form.end_time}:00`;

    const { data, error } = await createShift(
      {
        org_id: currentUser.orgId,
        location_id: form.location_id || undefined,
        shift_date: form.shift_date,
        start_time: startDt,
        end_time: endDt,
        required_headcount: parseInt(form.required_headcount) || 1,
        status: "Planned",
      },
      currentUser.id
    );

    setSaving(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setCreatedShiftId((data as Record<string, unknown>)?.id as string);
    setMessage({ type: "success", text: "Shift created! Now assign employees below." });
  };

  const handleAssign = async (employeeId: string) => {
    if (!createdShiftId || !currentUser?.orgId) return;
    setAssigning(employeeId);

    const { error } = await createShiftAssignment(
      { org_id: currentUser.orgId, shift_id: createdShiftId, employee_id: employeeId },
      currentUser.id
    );

    setAssigning(null);

    if (!error) {
      setAssignedEmployees((prev) => new Set(prev).add(employeeId));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shift Builder</h1>
          <p className="text-gray-500 text-sm mt-1">
            Configure new shifts and assign employees across locations.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/schedule">Back to schedule</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Shift Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={form.location_id} onValueChange={(v) => set("location_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input type="date" value={form.shift_date} onChange={(e) => set("shift_date", e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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
              <Label>Required Headcount</Label>
              <Input type="number" value={form.required_headcount} onChange={(e) => set("required_headcount", e.target.value)} min="1" />
            </div>

            {message && (
              <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {message.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {message.text}
              </div>
            )}

            <Button
              className="bg-brand hover:bg-brand-dark text-white"
              onClick={handleSaveShift}
              disabled={saving || !form.shift_date || !!createdShiftId}
            >
              {saving ? "Saving..." : createdShiftId ? "Shift Created ✓" : "Save Shift"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Assign Employees
              {createdShiftId && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 ml-2">
                  {assignedEmployees.size} assigned
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!createdShiftId && (
              <p className="text-sm text-gray-500 italic">Save the shift first to enable employee assignment.</p>
            )}
            {employees.slice(0, 8).map((employee) => (
              <div key={employee.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{employee.name || employee.full_name}</p>
                  <p className="text-xs text-gray-500">{employee.role} • {employee.location || "—"}</p>
                </div>
                {assignedEmployees.has(employee.id) ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Assigned
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!createdShiftId || assigning === employee.id}
                    onClick={() => handleAssign(employee.id)}
                  >
                    {assigning === employee.id ? "..." : "Assign"}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            Shift Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {createdShiftId ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="grid gap-4 sm:grid-cols-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Date</p>
                  <p className="font-medium">{form.shift_date}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Time</p>
                  <p className="font-medium">{form.start_time} → {form.end_time}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Headcount</p>
                  <p className="font-medium">{assignedEmployees.size} / {form.required_headcount}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Status</p>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Created</Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[120px] rounded-xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-sm text-gray-400">
              Save a shift to see the preview
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
