"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Package, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { createAssetAssignment, getAssets, updateAssetAssignment } from "@/lib/services/assets";

export default function AssetsPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUser?.role !== "Employee";

  const loadAssets = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = await getAssets(currentUser.orgId);
    setAssets(data || []);
    setLoading(false);
  }, [currentUser?.orgId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Handover</h1>
          <p className="text-sm text-gray-500">Track company-owned assets issued to employees.</p>
        </div>
        {isAdmin && <AssignAssetDialog employees={employees} onSuccess={loadAssets} />}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead>Employee</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => {
                const employee = (asset.employee ?? null) as Record<string, unknown> | null;
                const status = typeof asset.status === "string" ? asset.status : "assigned";
                return (
                  <TableRow key={String(asset.id)}>
                    <TableCell className="font-medium">{String(employee?.full_name || "Unknown")}</TableCell>
                    <TableCell>{String(asset.asset_name || asset.asset_type || "Asset")}</TableCell>
                    <TableCell>{String(asset.serial_number || "-")}</TableCell>
                    <TableCell>{String(asset.assigned_date || "-")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status === "assigned" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-700"}>
                        {status}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={status !== "assigned"}
                          onClick={async () => {
                            await updateAssetAssignment(String(asset.id), {
                              status: "returned",
                              returned_date: new Date().toISOString().slice(0, 10),
                            });
                            loadAssets();
                          }}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!loading && assets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No asset handovers yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignAssetDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", asset_name: "", asset_type: "", serial_number: "", notes: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.employee_id || !form.asset_name.trim()) {
      setError("Employee and asset name are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: err } = await createAssetAssignment({
      org_id: currentUser.orgId,
      employee_id: form.employee_id,
      asset_name: form.asset_name.trim(),
      asset_type: form.asset_type.trim() || "Company Asset",
      serial_number: form.serial_number.trim() || undefined,
      notes: form.notes.trim() || undefined,
      status: "assigned",
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOpen(false);
    setForm({ employee_id: "", asset_name: "", asset_type: "", serial_number: "", notes: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="h-4 w-4 mr-2" /> Assign Asset
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Asset</DialogTitle>
          <DialogDescription>Record an official company asset handover.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={form.employee_id} onValueChange={(value) => set("employee_id", value)}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name || "Employee")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Asset Name</Label>
              <Input value={form.asset_name} onChange={(event) => set("asset_name", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Input value={form.asset_type} onChange={(event) => set("asset_type", event.target.value)} placeholder="Laptop, phone, device" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Serial Number</Label>
            <Input value={form.serial_number} onChange={(event) => set("serial_number", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
