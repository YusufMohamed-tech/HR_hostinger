"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { useLocations } from "@/hooks/use-data";
import { createShift } from "@/lib/services/schedule";

interface Props {
  onSuccess: () => void;
}

export function AddShiftDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const { data: locations } = useLocations();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    location_id: "",
    shift_date: "",
    start_time: "08:00",
    end_time: "16:00",
    required_headcount: "1",
    status: "Planned",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.shift_date || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const startDt = `${form.shift_date}T${form.start_time}:00`;
    const endDt = `${form.shift_date}T${form.end_time}:00`;

    const { error: err } = await createShift(
      {
        org_id: currentUser.orgId,
        location_id: form.location_id || undefined,
        shift_date: form.shift_date,
        start_time: startDt,
        end_time: endDt,
        required_headcount: parseInt(form.required_headcount) || 1,
        status: form.status,
      },
      currentUser.id
    );

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ location_id: "", shift_date: "", start_time: "08:00", end_time: "16:00", required_headcount: "1", status: "Planned" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Create Shift
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Shift</DialogTitle>
          <DialogDescription>Define shift timing, location, and headcount.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={form.shift_date} onChange={(e) => set("shift_date", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={form.location_id} onValueChange={(v) => set("location_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {locations.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Headcount</Label>
              <Input type="number" value={form.required_headcount} onChange={(e) => set("required_headcount", e.target.value)} min="1" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Planned">Planned</SelectItem>
                  <SelectItem value="Published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.shift_date}>
            {submitting ? "Creating..." : "Create Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
