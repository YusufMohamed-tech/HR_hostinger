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
import { createKpiDefinition } from "@/lib/services/analytics";

interface Props {
  onSuccess: () => void;
}

export function AddKpiDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    unit: "",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createKpiDefinition(
      {
        org_id: currentUser.orgId,
        name: form.name,
        description: form.description || undefined,
        unit: form.unit || undefined,
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
    setForm({ name: "", description: "", unit: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Define KPI
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Define KPI</DialogTitle>
          <DialogDescription>Create a new key performance indicator to track.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>KPI Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Attendance Rate" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Percentage of on-time check-ins" />
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="%" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name}>
            {submitting ? "Creating..." : "Create KPI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
