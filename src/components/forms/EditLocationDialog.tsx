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
import { useEmployees } from "@/hooks/use-data";
import { updateLocation } from "@/lib/services/locations";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  location: any;
  onSuccess: () => void;
}

export function EditLocationDialog({ location, onSuccess }: Props) {
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    type: "branch",
    latitude: "",
    longitude: "",
    radius_meters: "100",
    manager_employee_id: "",
  });

  useEffect(() => {
    if (location && open) {
      setForm({
        name: location.name || "",
        type: location.type || "branch",
        latitude: location.latitude ? String(location.latitude) : "",
        longitude: location.longitude ? String(location.longitude) : "",
        radius_meters: location.radius_meters ? String(location.radius_meters) : "100",
        manager_employee_id: location.manager_employee_id || "",
      });
    }
  }, [location, open]);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.name) return;
    setSubmitting(true);
    setError("");

    const { error: err } = await updateLocation(location.id, {
      name: form.name,
      type: form.type,
      latitude: form.latitude ? parseFloat(form.latitude) : undefined,
      longitude: form.longitude ? parseFloat(form.longitude) : undefined,
      radius_meters: form.radius_meters ? parseInt(form.radius_meters, 10) : undefined,
      manager_employee_id: form.manager_employee_id || undefined,
    });

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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>Update location details and geofence radius.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Location Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Location Type</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v || "")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">Branch</SelectItem>
                  <SelectItem value="booth">Booth</SelectItem>
                  <SelectItem value="office">Office</SelectItem>
                  <SelectItem value="area">Area</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Manager</Label>
              <Select value={form.manager_employee_id} onValueChange={(v) => set("manager_employee_id", v || "")}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={String(emp.id)} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Latitude</Label>
              <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Longitude</Label>
              <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Radius (m)</Label>
              <Input type="number" value={form.radius_meters} onChange={(e) => set("radius_meters", e.target.value)} />
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
