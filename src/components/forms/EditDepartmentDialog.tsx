"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { updateDepartment } from "@/lib/services/departments";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  department: any;
  onSuccess: () => void;
}

export function EditDepartmentDialog({ department, onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (department && open) {
      setName(department.name || "");
    }
  }, [department, open]);

  const handleSubmit = async () => {
    if (!name || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await updateDepartment(
      department.id,
      currentUser.orgId,
      { name },
      currentUser.id
    );

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark" />}>
        <Pencil className="w-3.5 h-3.5 mr-1" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Edit Department</DialogTitle>
          <DialogDescription>Update department name.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Department Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !name}>
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
