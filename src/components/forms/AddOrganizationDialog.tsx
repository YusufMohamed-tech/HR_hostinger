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
import { createOrganization } from "@/lib/services/organizations";

interface Props {
  onSuccess: () => void;
}

export function AddOrganizationDialog({ onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    slug: "",
    plan: "starter",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.name) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createOrganization(form);

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ name: "", slug: "", plan: "starter" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Organization
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Organization</DialogTitle>
          <DialogDescription>Provision a new tenant workspace.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Organization Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Tatwir Retail" />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="tatwir-retail" />
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={form.plan} onValueChange={(v) => set("plan", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="growth">Growth</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name}>
            {submitting ? "Adding..." : "Add Organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
