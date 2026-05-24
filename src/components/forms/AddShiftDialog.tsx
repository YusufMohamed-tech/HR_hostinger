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
    name: "Morning Shift",
    shift_type: "morning",
    start_time: "08:00",
    end_time: "16:00",
    location_id: "",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.name || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createShift({
      org_id: currentUser.orgId,
      name: form.name,
      shift_type: form.shift_type,
      start_time: form.start_time,
      end_time: form.end_time,
      location_id: form.location_id || undefined,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ name: "Morning Shift", shift_type: "morning", start_time: "08:00", end_time: "16:00", location_id: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 mr-2" />
        إنشاء وردية
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>إنشاء قالب وردية</DialogTitle>
          <DialogDescription>تحديد نوع الوردية ووقتها وموقعها.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الاسم *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Morning Shift" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نوع الوردية</Label>
              <Select value={form.shift_type} onValueChange={(v) => set("shift_type", v || "")}>
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
              <Select value={form.location_id} onValueChange={(v) => set("location_id", v || "")}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={String(l.id)} value={String(l.id)}>{String(l.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>وقت البداية</Label>
              <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>وقت النهاية</Label>
              <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name}>
            {submitting ? "جار الإنشاء..." : "إنشاء وردية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
