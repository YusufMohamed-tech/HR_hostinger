"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Package, PenLine, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { useEmployees, useLocations } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  acknowledgeAssetAssignment,
  createAssetAssignment,
  createAssetInventory,
  getAssetInventory,
  getAssets,
  getEmployeeAssets,
  updateAssetAssignment,
} from "@/lib/services/assets";

const assetStatusLabels: Record<string, string> = {
  assigned: "مُسلّم",
  returned: "مُستعاد",
  damaged: "تالف",
  lost: "مفقود",
  transferred: "محول",
};

const assetStatusColors: Record<string, string> = {
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  returned: "bg-gray-50 text-gray-600 border-gray-200",
  damaged: "bg-red-50 text-red-700 border-red-200",
  lost: "bg-orange-50 text-orange-700 border-orange-200",
  transferred: "bg-purple-50 text-purple-700 border-purple-200",
  available: "bg-green-50 text-green-700 border-green-200",
};

const assetTypeOptions = ["جوال", "لابتوب", "جهاز بصمة", "جهاز مدى", "شريحة", "عهدة أخرى"];

export default function AssetsPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [inventory, setInventory] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUser?.role !== "Employee";

  const loadAssets = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const assetResult = isAdmin && currentUser.role !== "Employee"
      ? await getAssets(currentUser.orgId)
      : currentUser.employeeId
        ? await getEmployeeAssets(currentUser.orgId, currentUser.employeeId)
        : { data: [] };
    setAssets(assetResult.data || []);

    if (isAdmin && currentUser.role !== "Employee") {
      const inventoryResult = await getAssetInventory(currentUser.orgId);
      setInventory(inventoryResult.data || []);
    } else {
      setInventory([]);
    }

    setLoading(false);
  }, [currentUser?.employeeId, currentUser?.orgId, currentUser?.role, isAdmin]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleStatusChange = async (assetId: string, version: number, newStatus: string) => {
    await updateAssetAssignment(assetId, { status: newStatus, expected_version: version });
    loadAssets();
  };

  const inventoryCounts = useMemo(() => {
    const source = isAdmin ? inventory : assets;
    return {
      total: source.length,
      assigned: source.filter((item) => item.status === "assigned").length,
      returned: source.filter((item) => item.status === "returned").length,
      available: source.filter((item) => item.status === "available").length,
      damaged: source.filter((item) => item.status === "damaged").length,
      lost: source.filter((item) => item.status === "lost").length,
    };
  }, [assets, inventory, isAdmin]);

  const officeSummary = useMemo(() => {
    const rows: Record<string, { total: number; assigned: number; available: number; returned: number }> = {};
    for (const item of inventory) {
      const office = item.office_location as Record<string, unknown> | null;
      const key = String(office?.name || "بدون مكتب");
      rows[key] ||= { total: 0, assigned: 0, available: 0, returned: 0 };
      rows[key].total += 1;
      const status = String(item.status || "available");
      if (status === "assigned") rows[key].assigned += 1;
      if (status === "available") rows[key].available += 1;
      if (status === "returned") rows[key].returned += 1;
    }
    return Object.entries(rows).slice(0, 6);
  }, [inventory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">تسليم الأصول</h1>
          <p className="text-sm text-gray-500">متابعة مخزون الشركة والعهد المسلمة والمستعادة من الموظفين.</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <AddInventoryDialog locations={locations} onSuccess={loadAssets} />
            <AssignAssetDialog employees={employees} inventory={inventory} onSuccess={loadAssets} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <SummaryCard label="إجمالي الأصول" value={inventoryCounts.total} color="text-gray-950" />
        <SummaryCard label="متاح بالمخزون" value={inventoryCounts.available} color="text-green-700" />
        <SummaryCard label="مسلم للموظفين" value={inventoryCounts.assigned} color="text-blue-700" />
        <SummaryCard label="مستعاد" value={inventoryCounts.returned} color="text-gray-700" />
        <SummaryCard label="تالف / مفقود" value={inventoryCounts.damaged + inventoryCounts.lost} color="text-red-700" />
      </div>

      {isAdmin && officeSummary.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardContent className="space-y-3 p-5">
            <h2 className="text-lg font-semibold text-gray-950">ملخص المكاتب الرئيسية</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {officeSummary.map(([office, counts]) => (
                <div key={office} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p className="font-semibold text-gray-950">{office}</p>
                  <p className="mt-1 text-gray-600">الإجمالي {counts.total} · مسلم {counts.assigned} · متاح {counts.available} · مستعاد {counts.returned}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-0">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-950">مخزون الشركة</h2>
              <p className="text-sm text-gray-500">أدخل الرقم التسلسلي مرة واحدة، ثم استخدمه لاحقًا في تسليم العهد.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead>الأصل</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الرقم التسلسلي</TableHead>
                  <TableHead>المكتب</TableHead>
                  <TableHead>قيمة الشراء</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((item) => {
                  const office = item.office_location as Record<string, unknown> | null;
                  const status = String(item.status || "available");
                  return (
                    <TableRow key={String(item.id)}>
                      <TableCell className="font-medium">{String(item.asset_name || "أصل")}</TableCell>
                      <TableCell>{String(item.asset_type || "-")}</TableCell>
                      <TableCell>{String(item.serial_number || "-")}</TableCell>
                      <TableCell>{String(office?.name || "-")}</TableCell>
                      <TableCell>{Number(item.purchase_price || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={assetStatusColors[status] || "bg-gray-50 text-gray-700"}>
                          {assetStatusLabels[status] || (status === "available" ? "متاح" : status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!loading && inventory.length === 0 && <EmptyState title="لا يوجد مخزون أصول حتى الآن" />}
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-950">سجل تسليم العهد</h2>
            <p className="text-sm text-gray-500">كل أصل تم تسليمه لموظف مع حالة الإقرار والإرجاع.</p>
          </div>
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
                        <AcknowledgeAssetDialog assetId={String(asset.id)} version={Number(asset.version || 1)} onSuccess={loadAssets} />
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
                              <DropdownMenuItem className="text-gray-700" onClick={() => handleStatusChange(String(asset.id), Number(asset.version || 1), "returned")}>
                                <RotateCcw className="h-4 w-4 ml-2" /> استعادة
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600" onClick={() => handleStatusChange(String(asset.id), Number(asset.version || 1), "damaged")}>
                                <AlertTriangle className="h-4 w-4 ml-2" /> تالف
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-orange-600" onClick={() => handleStatusChange(String(asset.id), Number(asset.version || 1), "lost")}>
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
          {!loading && assets.length === 0 && <EmptyState title="لا توجد عمليات تسليم أصول حتى الآن" />}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="py-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Package className="h-10 w-10 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-900">{title}</p>
    </div>
  );
}

function AcknowledgeAssetDialog({ assetId, version, onSuccess }: { assetId: string; version: number; onSuccess: () => void }) {
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
              const result = await acknowledgeAssetAssignment(assetId, version, signature.trim());
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

function AddInventoryDialog({ locations, onSuccess }: { locations: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    asset_name: "",
    asset_type: "جوال",
    serial_number: "",
    office_location_id: "",
    purchase_date: "",
    purchase_price: "",
    salvage_value: "0",
    useful_life_months: "60",
    paid_immediately: false,
    notes: "",
  });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.asset_name.trim() || !form.serial_number.trim()) {
      setError("اسم الأصل والرقم التسلسلي مطلوبان.");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await createAssetInventory({
      org_id: currentUser.orgId,
      asset_name: form.asset_name.trim(),
      asset_type: form.asset_type,
      serial_number: form.serial_number.trim(),
      office_location_id: form.office_location_id || undefined,
      purchase_date: form.purchase_date || undefined,
      purchase_price: Number(form.purchase_price || 0),
      salvage_value: Number(form.salvage_value || 0),
      useful_life_months: Number(form.useful_life_months || 60),
      paid_immediately: form.paid_immediately,
      notes: form.notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setForm({ asset_name: "", asset_type: "جوال", serial_number: "", office_location_id: "", purchase_date: "",
      purchase_price: "", salvage_value: "0", useful_life_months: "60", paid_immediately: false, notes: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Boxes className="h-4 w-4 ml-2" /> إضافة أصل للمخزون
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة أصل للمخزون</DialogTitle>
          <DialogDescription>أدخل الرقم التسلسلي مرة واحدة ليصبح متاحًا في دروب ليست التسليم.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>اسم الأصل *</Label>
              <Input value={form.asset_name} onChange={(event) => set("asset_name", event.target.value)} placeholder="iPhone 15" />
            </div>
            <div className="space-y-2">
              <Label>نوع الأصل</Label>
              <Select value={form.asset_type} onValueChange={(value) => set("asset_type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assetTypeOptions.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>قيمة الشراء (ر.س)</Label>
              <Input type="number" min="0" step="0.01" value={form.purchase_price}
                onChange={(event) => set("purchase_price", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>القيمة التخريدية</Label>
              <Input type="number" min="0" step="0.01" value={form.salvage_value}
                onChange={(event) => set("salvage_value", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>العمر الإنتاجي (شهر)</Label>
              <Input type="number" min="1" max="600" value={form.useful_life_months}
                onChange={(event) => set("useful_life_months", event.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.paid_immediately}
              onChange={(event) => setForm((previous) => ({ ...previous, paid_immediately: event.target.checked }))} />
            تم دفع قيمة الأصل فورًا (نقدًا/بنك)
          </label>
          <div className="space-y-2">
            <Label>الرقم التسلسلي *</Label>
            <Input value={form.serial_number} onChange={(event) => set("serial_number", event.target.value)} dir="ltr" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>المكتب / الموقع الرئيسي</Label>
              <Select value={form.office_location_id} onValueChange={(value) => set("office_location_id", value)}>
                <SelectTrigger><SelectValue placeholder="اختر المكتب" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={String(location.id)} value={String(location.id)}>{String(location.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>تاريخ الاستلام</Label>
              <Input type="date" value={form.purchase_date} onChange={(event) => set("purchase_date", event.target.value)} />
            </div>
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
            {submitting ? "جاري الحفظ..." : "حفظ الأصل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignAssetDialog({
  employees,
  inventory,
  onSuccess,
}: {
  employees: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", inventory_id: "", notes: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  const availableInventory = inventory.filter((item) => ["available", "returned"].includes(String(item.status || "available")));
  const selectedInventory = availableInventory.find((item) => String(item.id) === form.inventory_id);

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.employee_id || !form.inventory_id) {
      setError("الموظف والأصل مطلوبان.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: err } = await createAssetAssignment({
      org_id: currentUser.orgId,
      employee_id: form.employee_id,
      inventory_id: form.inventory_id,
      notes: form.notes.trim() || undefined,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOpen(false);
    setForm({ employee_id: "", inventory_id: "", notes: "" });
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
          <DialogDescription>اختر موظفًا ثم اختر الرقم التسلسلي المتاح من مخزون الشركة.</DialogDescription>
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
          <div className="space-y-2">
            <Label>الأصل من المخزون</Label>
            <Select value={form.inventory_id} onValueChange={(value) => set("inventory_id", value)}>
              <SelectTrigger><SelectValue placeholder="اختر الرقم التسلسلي" /></SelectTrigger>
              <SelectContent>
                {availableInventory.map((item) => (
                  <SelectItem key={String(item.id)} value={String(item.id)}>
                    {String(item.asset_name)} · {String(item.serial_number)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedInventory && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              {String(selectedInventory.asset_type || "أصل")} · {String(selectedInventory.serial_number || "-")}
            </div>
          )}
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Input value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </div>
          {availableInventory.length === 0 && <p className="text-sm text-amber-700">لا توجد أصول متاحة. أضف أصلًا للمخزون أولًا.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || availableInventory.length === 0}>
            {submitting ? "جاري التسليم..." : "تسليم"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
