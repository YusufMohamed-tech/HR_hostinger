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
import { createLocation } from "@/lib/services/locations";
import { locationFormSchema, getValidationMessage } from "@/lib/validation";
import { LocationMapPicker } from "@/components/locations/LocationMapPicker";

interface Props {
  onSuccess: () => void;
}

export function AddLocationDialog({ onSuccess }: Props) {
  const { currentUser } = useRoleContext();
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

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  const setMapCoordinates = (latitude: string, longitude: string) => {
    setForm((prev) => ({ ...prev, latitude, longitude }));
  };

  const handleSubmit = async () => {
    if (!currentUser?.orgId) return;
    setSubmitting(true);
    setError("");

    const parsed = locationFormSchema.safeParse(form);
    if (!parsed.success) {
      setError(getValidationMessage(parsed.error));
      setSubmitting(false);
      return;
    }

    const { error: err } = await createLocation({
      org_id: currentUser.orgId,
      name: parsed.data.name,
      type: parsed.data.type,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      radius_meters: parsed.data.radius_meters,
      manager_employee_id: parsed.data.manager_employee_id,
    });

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setForm({ name: "", type: "branch", latitude: "", longitude: "", radius_meters: "100", manager_employee_id: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="w-4 h-4 mr-2" />
        إضافة موقع
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pt-4 pr-12">
          <DialogTitle>إضافة موقع</DialogTitle>
          <DialogDescription>تسجيل فرع أو كشك أو مكتب جديد مع إعدادات النطاق الجغرافي.</DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <Label>اسم الموقع *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nasr City Branch" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نوع الموقع</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v || "")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">فرع</SelectItem>
                  <SelectItem value="booth">كشك</SelectItem>
                  <SelectItem value="office">مكتب</SelectItem>
                  <SelectItem value="area">منطقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>المدير</Label>
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
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>خط العرض</Label>
              <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="24.7136" />
            </div>
            <div className="space-y-2">
              <Label>خط الطول</Label>
              <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="46.6753" />
            </div>
            <div className="space-y-2">
              <Label>النطاق (متر)</Label>
              <Input type="number" value={form.radius_meters} onChange={(e) => set("radius_meters", e.target.value)} />
            </div>
          </div>
          <LocationMapPicker
            latitude={form.latitude}
            longitude={form.longitude}
            radiusMeters={form.radius_meters}
            onChange={setMapCoordinates}
          />
        </div>

        {error && <p className="shrink-0 px-4 text-sm text-red-600">{error}</p>}

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-b-xl">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.name}>
            {submitting ? "جار الإضافة..." : "إضافة موقع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
