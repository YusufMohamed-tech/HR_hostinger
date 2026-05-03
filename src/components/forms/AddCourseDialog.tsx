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
import { createCourse } from "@/lib/services/learning";

interface Props {
  onSuccess: () => void;
}

export function AddCourseDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.title || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await createCourse(
      {
        org_id: currentUser.orgId,
        title: form.title,
        description: form.description || undefined,
        status: "Active",
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
    setForm({ title: "", description: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-brand hover:bg-brand-dark text-white" />}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Course
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add Course</DialogTitle>
          <DialogDescription>Create a new learning course for employees.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Course Title *</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Safety Onboarding" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Introductory safety training..." />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.title}>
            {submitting ? "Creating..." : "Create Course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
