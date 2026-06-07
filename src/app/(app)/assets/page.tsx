"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Package, PenLine, Plus, RotateCcw, Trash2, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { acknowledgeAssetAssignment, createAssetAssignment, getAssets, getEmployeeAssets, updateAssetAssignment } from "@/lib/services/assets";

const assetStatusLabels: Record<string, string> = {
  assigned: "مُسلَّم",
  returned: "مُستعاد",
  damaged: "تالف",
  lost: "مفقود",
  transferred: "محوَّل",
};

const assetStatusColors: Record<string, string> = {
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  returned: "bg-gray-50 text-gray-600 border-gray-200",
  damaged: "bg-red-50 text-red-700 border-red-200",
  lost: "bg-orange-50 text-orange-700 border-orange-200",
  transferred: "bg-purple-50 text-purple-700 border-purple-200",
};

export default function AssetsPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUser?.role !== "Employee";

  const loadAssets = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = isAdmin && currentUser.role !== "Employee"
      ? await getAssets(currentUser.orgId)
      : currentUser.employeeId
        ? await getEmployeeAssets(currentUser.orgId, currentUser.employeeId)
        : { data: [] };
    setAssets(data || []);
    setLoading(false);
  }, [currentUser?.employeeId, currentUser?.orgId, currentUser?.role, isAdmin]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleStatusChange = async (assetId: string, newStatus: string) => {
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_by: currentUser?.id,
    };
    if (newStatus === "returned") {
      updateData.returned_date = new Date().toISOString().slice(0, 10);
      updateData.returned_by = currentUser?.id;
    }
    await updateAssetAssignment(assetId, updateData as never);
    loadAssets();
  };

  // Summary counts
  const assigned = assets.filter(a => a.status === "assigned").length;
  const returned = assets.filter(a => a.status === "returned").length;
  const damaged = assets.filter(a => a.status === "damaged").length;
  const lost = assets.filter(a => a.status === "lost").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">تسليم الأصول</h1>
          <p className="text-sm text-gray-500">متابعة الأصول المملوكة للشركة والمسلّمة للموظفين.</p>
        </div>
        {isAdmin && <AssignAssetDialog employees={employees} onSuccess={loadAssets} />}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">مُسلَّم</p>
            <p className="text-2xl font-semibold text-blue-600">{assigned}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">مُستعاد</p>
            <p className="text-2xl font-semibold text-gray-600">{returned}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">تالف</p>
            <p className="text-2xl font-semibold text-red-600">{damaged}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">مفقود</p>
            <p className="text-2xl font-semibold text-orange-600">{lost}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead>الموظف</TableHead>
                <TableHead>الأصل</TableHead>
                <TableHead>الرقم التسلسلي</TableHead>
                <TableHead>تاريخ التسليم</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإقرار</TableHead>
                {isAdmin && <TableHead className="text-right">الإجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => {
                const employee = (asset.employee ?? null) as Record<string, unknown> | null;
                const status = typeof asset.status === "string" ? asset.status : "assigned";
                const isActive = status === "assigned";
                return (
                  <TableRow key={String(asset.id)}>
                    <TableCell className="font-medium">{String(employee?.full_name || "غير معروف")}</TableCell>
                    <TableCell>
                      <div>
                        <p>{String(asset.asset_name || asset.asset_type || "أصل")}</p>
                        {Boolean(asset.notes) && <p className="text-xs text-gray-500">{String(asset.notes)}</p>}
                      </div>
                    </TableCell>
                    <TableCell>{String(asset.serial_number || "-")}</TableCell>
                    <TableCell>{String(asset.assigned_date || "-")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={assetStatusColors[status] || "bg-gray-50 text-gray-700"}>
                        {assetStatusLabels[status] || status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {asset.acknowledgment_signature_url ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">تم التوقيع</Badge>
                      ) : isActive ? (
                        <AcknowledgeAssetDialog assetId={String(asset.id)} onSuccess={loadAssets} />
                      ) : "-"}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {isActive ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                              تغيير الحالة
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-gray-700"
                                onClick={() => handleStatusChange(String(asset.id), "returned")}
                              >
                                <RotateCcw className="h-4 w-4 ml-2" /> استعادة
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-purple-600"
                                onClick={() => handleStatusChange(String(asset.id), "transferred")}
                              >
                                <ArrowRightLeft className="h-4 w-4 ml-2" /> تحويل
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => handleStatusChange(String(asset.id), "damaged")}
                              >
                                <AlertTriangle className="h-4 w-4 ml-2" /> تالف
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-orange-600"
                                onClick={() => handleStatusChange(String(asset.id), "lost")}
                              >
                                <Trash2 className="h-4 w-4 ml-2" /> مفقود
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs text-gray-400">لا إجراءات</span>
                        )}
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
              <p className="text-sm font-medium text-gray-900">لا توجد عمليات تسليم أصول حتى الآن</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AcknowledgeAssetDialog({ assetId, onSuccess }: { assetId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PenLine className="h-4 w-4 ml-2" /> توقيع
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إقرار استلام الأصل</DialogTitle>
          <DialogDescription>اكتب اسمك لتأكيد استلام العهدة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label>التوقيع الإلكتروني</Label>
          <Input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="اسمك الكامل..." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            disabled={!signature.trim()}
            onClick={async () => {
              setError("");
              const result = await acknowledgeAssetAssignment(assetId, signature.trim());
              if (result.error) {
                setError(result.error.message);
                return;
              }
              setOpen(false);
              setSignature("");
              onSuccess();
            }}
          >
            تأكيد الاستلام
          </Button>
        </DialogFooter>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </DialogContent>
    </Dialog>
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
      setError("الموظف واسم الأصل مطلوبان.");
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
      assigned_by: currentUser.id,
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
        <Plus className="h-4 w-4 ml-2" /> تسليم أصل
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسليم أصل</DialogTitle>
          <DialogDescription>تسجيل تسليم أصل رسمي مملوك للشركة.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الموظف</Label>
            <Select value={form.employee_id} onValueChange={(value) => set("employee_id", value)}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name || "الموظف")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>اسم الأصل</Label>
              <Input value={form.asset_name} onChange={(event) => set("asset_name", event.target.value)} placeholder="حاسب محمول، جوال..." />
            </div>
            <div className="space-y-2">
              <Label>النوع</Label>
              <Input value={form.asset_type} onChange={(event) => set("asset_type", event.target.value)} placeholder="حاسب، جوال، جهاز" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>الرقم التسلسلي</Label>
            <Input value={form.serial_number} onChange={(event) => set("serial_number", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "جار التسليم..." : "تسليم"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  );
}
