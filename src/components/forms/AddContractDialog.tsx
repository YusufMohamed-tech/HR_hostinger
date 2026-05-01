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
import { useEmployees } from "@/hooks/use-data";
import { createContract } from "@/lib/services/contracts";

interface Props {
  onSuccess: () => void;
}

export function AddContractDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    employee_id: "",
    start_date: "",
    end_date: "",
    base_salary: "",
    currency: "SAR",
    status: "active",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.employee_id || !form.start_date || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createContract(
      {
        org_id: currentUser.orgId,
        employee_id: form.employee_id,
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        base_salary: form.base_salary ? Number(form.base_salary) : undefined,
        currency: form.currency,
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
    setForm({ employee_id: "", start_date: "", end_date: "", base_salary: "", currency: "SAR", status: "active" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Contract
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Contract</DialogTitle>
          <DialogDescription>Create a new employment contract.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Employee *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {employees.map((emp: any) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name || emp.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date *</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Base Salary</Label>
              <Input type="number" value={form.base_salary} onChange={(e) => set("base_salary", e.target.value)} placeholder="8000" />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.employee_id || !form.start_date}>
            {submitting ? "Adding..." : "Add Contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
