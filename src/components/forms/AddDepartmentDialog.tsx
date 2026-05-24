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
import { createDepartment } from "@/lib/services/departments";
import { departmentFormSchema, getValidationMessage } from "@/lib/validation";

interface Props {
  onSuccess: () => void;
}

export function AddDepartmentDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [managerId, setManagerId] = useState("");

  const handleSubmit = async () => {
    if (!currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const parsed = departmentFormSchema.safeParse({ name, manager_employee_id: managerId });
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      setSubmitting(false);
      return;
    }

    const { error: err } = await createDepartment({
      org_id: currentUser.orgId,
      name: parsed.data.name,
      manager_employee_id: parsed.data.manager_employee_id,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setName("");
    setManagerId("");
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        إضافة قسم
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>إضافة قسم</DialogTitle>
          <DialogDescription>إنشاء قسم جديد في المنشأة.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>اسم القسم *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Operations" />
          </div>
          <div className="space-y-2">
            <Label>مدير القسم</Label>
            <Select value={managerId} onValueChange={(v) => setManagerId(v || "")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={String(emp.id)} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !name}>
            {submitting ? "جار الإضافة..." : "إضافة قسم"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
