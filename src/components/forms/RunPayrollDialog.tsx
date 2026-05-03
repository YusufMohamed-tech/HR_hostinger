"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { createPayrollCycle } from "@/lib/services/payroll";

interface Props {
  onSuccess: () => void;
}

export function RunPayrollDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    period_start: "",
    period_end: "",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name || !form.period_start || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createPayrollCycle(
      {
        org_id: currentUser.orgId,
        name: form.name,
        period_start: form.period_start,
        period_end: form.period_end || undefined,
        status: "Draft",
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
    setForm({ name: "", period_start: "", period_end: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Run Payroll
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Run Payroll</DialogTitle>
          <DialogDescription>Create a new payroll cycle for the period.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Cycle Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="May 2026" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Period Start *</Label>
              <Input type="date" value={form.period_start} onChange={(e) => set("period_start", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Input type="date" value={form.period_end} onChange={(e) => set("period_end", e.target.value)} />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name || !form.period_start}>
            {submitting ? "Creating..." : "Create Cycle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
