"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { updateLocation } from "@/lib/services/locations";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  location: any;
  onSuccess: () => void;
}

export function EditLocationDialog({ location, onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    city: "",
    geofence_status: "Draft",
  });

  useEffect(() => {
    if (location && open) {
      setForm({
        name: location.name || "",
        city: location.city || "",
        geofence_status: location.geofence || location.geofence_status || "Draft",
      });
    }
  }, [location, open]);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.name || !currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await updateLocation(
      location.id,
      currentUser.orgId,
      { name: form.name, city: form.city, geofence_status: form.geofence_status },
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>Update location details.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Location Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Geofence</Label>
              <Select value={form.geofence_status} onValueChange={(v) => set("geofence_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Enabled">Enabled</SelectItem>
                  <SelectItem value="Disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name}>
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
