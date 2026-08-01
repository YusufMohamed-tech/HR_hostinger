"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptProductEmployeeHandover,
  createProductEmployeeHandover,
  getMyProductEmployeeCustody,
  getProductEmployeeCustodyManager,
  newInventoryCommandId,
  saveProductInventoryOperationalAssignment,
} from "@/lib/services/product-inventory";
import type {
  ProductEmployeeCustodyDashboardData,
  ProductEmployeeCustodyManagerData,
  ProductInventoryOperationalAssignment,
} from "@/types/product-inventory";
import { CheckCircle2, ClipboardCheck, PackageCheck, RefreshCcw, Search, Send, Users } from "lucide-react";

function statusLabel(value: string) {
  return ({
    active: "نشط",
    inactive: "غير نشط",
    issued: "بانتظار الاستلام",
    accepted: "مستلم",
    completed: "مكتمل",
    cancelled: "ملغي",
    in_transit: "قيد التسليم",
    with_custodian: "في العهدة",
    return_pending: "مرتجع قيد الموافقة",
    return_approved: "مرتجع بانتظار التسليم",
  } as Record<string, string>)[value] ?? value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyAssignment = {
  employee_id: "",
  project_id: "",
  location_id: "",
  city: "",
  position_code: "OGSV1" as "OGPM" | "OGSV1",
  responsibility: "supervisor" as "project_manager" | "supervisor",
  can_receive_custody: true,
  can_sell: false,
  can_request_return: true,
  can_approve_return: false,
  status: "active" as "active" | "inactive",
  effective_from: today(),
  effective_to: "",
};

const employeeCustodyTabs = ["handover", "assignments", "report", "history"] as const;
type EmployeeCustodyTab = (typeof employeeCustodyTabs)[number];

export function ProductEmployeeCustodyManagerScreen() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductEmployeeCustodyManagerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [assignment, setAssignment] = useState(emptyAssignment);
  const [editing, setEditing] = useState<ProductInventoryOperationalAssignment | null>(null);
  const [handover, setHandover] = useState({ assignment_id: "", warehouse_id: "", notes: "", require_acknowledgment: true });
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [serialSearch, setSerialSearch] = useState("");

  async function load() {
    setLoading(true);
    const result = await getProductEmployeeCustodyManager();
    setLoading(false);
    if (result.error) setMessage(result.error);
    else setData(result.data);
  }

  useEffect(() => { void load(); }, []);

  const filteredUnits = useMemo(() => {
    const search = serialSearch.trim().toLowerCase();
    if (!search) return data?.available_units ?? [];
    return (data?.available_units ?? []).filter((unit) =>
      unit.raw_serial_number.toLowerCase().includes(search)
      || unit.product?.name?.toLowerCase().includes(search)
    );
  }, [data?.available_units, serialSearch]);

  function resetAssignment() {
    setEditing(null);
    setAssignment(emptyAssignment);
  }

  function editAssignment(row: ProductInventoryOperationalAssignment) {
    setEditing(row);
    setAssignment({
      employee_id: row.employee_id,
      project_id: row.project_id,
      location_id: row.location_id ?? "",
      city: row.city,
      position_code: row.position_code,
      responsibility: row.responsibility,
      can_receive_custody: row.can_receive_custody,
      // Employee custody currently has no sale command. Keep the stored
      // capability off until that separate workflow exists.
      can_sell: false,
      can_request_return: row.can_request_return,
      can_approve_return: row.can_approve_return,
      status: row.status,
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? "",
    });
  }

  async function saveAssignment() {
    if (!assignment.employee_id || !assignment.project_id || !assignment.city.trim()) {
      setMessage("اختر الموظف والمشروع واكتب المدينة.");
      return;
    }
    setWorking(true);
    setMessage("");
    const result = await saveProductInventoryOperationalAssignment({
      ...(editing ? { assignment_id: editing.id, expected_version: editing.version } : {}),
      ...assignment,
      can_sell: false,
      location_id: assignment.location_id || undefined,
      effective_to: assignment.effective_to || undefined,
    });
    setWorking(false);
    if (result.error) return setMessage(result.error);
    resetAssignment();
    setMessage("تم حفظ التكليف التشغيلي.");
    await load();
  }

  async function issueHandover() {
    if (!handover.assignment_id || !handover.warehouse_id || selectedUnits.length === 0) {
      setMessage("اختر التكليف والمخزن وسيريالاً واحداً على الأقل.");
      return;
    }
    setWorking(true);
    setMessage("");
    const result = await createProductEmployeeHandover({
      handover_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      assignment_id: handover.assignment_id,
      warehouse_id: handover.warehouse_id,
      require_acknowledgment: handover.require_acknowledgment,
      notes: handover.notes,
      unit_ids: selectedUnits,
    });
    setWorking(false);
    if (result.error) return setMessage(result.error);
    setSelectedUnits([]);
    setHandover((current) => ({ ...current, notes: "" }));
    setMessage("تم إصدار التسليم وإسناد السيريالات للمستلم المحدد.");
    await load();
  }

  if (loading && !data) return <div className="p-8 text-center text-slate-500">جاري تحميل إدارة العهد...</div>;

  const activeAssignments = (data?.assignments ?? []).filter((row) => row.status === "active" && row.can_receive_custody);
  const requestedTab = searchParams.get("tab");
  const activeTab: EmployeeCustodyTab = employeeCustodyTabs.includes(requestedTab as EmployeeCustodyTab)
    ? requestedTab as EmployeeCustodyTab
    : "handover";

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 md:text-3xl">تسليم وعهد أجهزة الراوتر</h1>
          <p className="mt-1 text-sm text-slate-500">تكليف OGPM/OGSV1 وتسليم السيريالات حسب المشروع والمدينة.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/sales/inventory">المخزون</Link></Button>
          <Button variant="outline" onClick={() => void load()}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button>
        </div>
      </div>
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}

      <Tabs value={activeTab} className="space-y-4">
        <TabsContent value="handover" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />بيانات التسليم</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label>المستلم / المشروع / المدينة</Label><Select value={handover.assignment_id} onValueChange={(value) => setHandover({ ...handover, assignment_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر تكليفاً نشطاً" /></SelectTrigger><SelectContent>{activeAssignments.map((row) => <SelectItem key={row.id} value={row.id}>{row.employee?.full_name} · {row.position_code} · {row.project?.name} · {row.city}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>المخزن المصدر</Label><Select value={handover.warehouse_id} onValueChange={(value) => setHandover({ ...handover, warehouse_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر المخزن" /></SelectTrigger><SelectContent>{data?.warehouses.map((row) => <SelectItem key={row.id} value={row.id}>{row.name_ar}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 md:col-span-2"><Label>ملاحظات</Label><Textarea value={handover.notes} onChange={(event) => setHandover({ ...handover, notes: event.target.value })} placeholder="مرجع أو ملاحظة التسليم" /></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={handover.require_acknowledgment} onCheckedChange={(checked) => setHandover({ ...handover, require_acknowledgment: checked === true })} />يتطلب قبولاً وتوقيعاً من المستلم</label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center justify-between gap-3"><span>اختيار السيريالات ({selectedUnits.length})</span><div className="relative w-full max-w-sm"><Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pr-9" value={serialSearch} onChange={(event) => setSerialSearch(event.target.value)} placeholder="بحث بالسيريال أو المنتج" /></div></CardTitle></CardHeader>
            <CardContent className="max-h-[420px] overflow-auto p-0">
              <Table><TableHeader><TableRow><TableHead className="w-12"></TableHead><TableHead>السيريال</TableHead><TableHead>المنتج</TableHead><TableHead>السعر</TableHead><TableHead>المخزن</TableHead></TableRow></TableHeader><TableBody>{filteredUnits.map((unit) => <TableRow key={unit.id}><TableCell><Checkbox checked={selectedUnits.includes(unit.id)} onCheckedChange={(checked) => setSelectedUnits((current) => checked ? [...current, unit.id] : current.filter((id) => id !== unit.id))} /></TableCell><TableCell className="font-mono">{unit.raw_serial_number}</TableCell><TableCell>{unit.product?.name}</TableCell><TableCell>{Number(unit.planned_sale_price_snapshot).toLocaleString()} {unit.currency}</TableCell><TableCell>{unit.warehouse?.name_ar}</TableCell></TableRow>)}</TableBody></Table>
              {filteredUnits.length === 0 && <p className="p-8 text-center text-sm text-slate-500">لا توجد وحدات جاهزة مطابقة.</p>}
            </CardContent>
          </Card>
          <div className="flex justify-end"><Button disabled={working || selectedUnits.length === 0} onClick={() => void issueHandover()}><PackageCheck className="ml-2 h-4 w-4" />{working ? "جاري الإصدار..." : `إصدار تسليم ${selectedUnits.length} جهاز`}</Button></div>
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4">
          <Card><CardHeader><CardTitle><Users className="ml-2 inline h-5 w-5" />{editing ? "تعديل التكليف" : "تكليف تشغيلي جديد"}</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2"><Label>الموظف</Label><Select value={assignment.employee_id} onValueChange={(value) => setAssignment({ ...assignment, employee_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger><SelectContent>{data?.employees.map((row) => <SelectItem key={row.id} value={row.id}>{row.full_name} {row.employee_code ? `(${row.employee_code})` : ""}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>المشروع</Label><Select value={assignment.project_id} onValueChange={(value) => setAssignment({ ...assignment, project_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر المشروع" /></SelectTrigger><SelectContent>{data?.projects.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>الموقع (اختياري)</Label><Select value={assignment.location_id || "none"} onValueChange={(value) => { const selected = value || "none"; const location = data?.locations.find((row) => row.id === selected); setAssignment({ ...assignment, location_id: selected === "none" ? "" : selected, city: location?.city || assignment.city }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون موقع محدد</SelectItem>{data?.locations.filter((row) => !assignment.project_id || !row.project_id || row.project_id === assignment.project_id).map((row) => <SelectItem key={row.id} value={row.id}>{row.name}{row.city ? ` · ${row.city}` : ""}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>المدينة</Label><Input value={assignment.city} onChange={(event) => setAssignment({ ...assignment, city: event.target.value })} /></div>
            <div className="space-y-2"><Label>الكود والمسؤولية</Label><Select value={assignment.position_code} onValueChange={(value) => { if (value) setAssignment({ ...assignment, position_code: value, responsibility: value === "OGPM" ? "project_manager" : "supervisor", can_approve_return: value === "OGPM" }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="OGPM">OGPM · مدير مشروع</SelectItem><SelectItem value="OGSV1">OGSV1 · مشرف</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>الحالة</Label><Select value={assignment.status} onValueChange={(value) => { if (value) setAssignment({ ...assignment, status: value }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">نشط</SelectItem><SelectItem value="inactive">غير نشط</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>ساري من</Label><Input type="date" value={assignment.effective_from} onChange={(event) => setAssignment({ ...assignment, effective_from: event.target.value })} /></div>
            <div className="space-y-2"><Label>حتى (اختياري)</Label><Input type="date" value={assignment.effective_to} onChange={(event) => setAssignment({ ...assignment, effective_to: event.target.value })} /></div>
            <div className="flex flex-wrap items-end gap-4 text-sm"><label className="flex items-center gap-2"><Checkbox checked={assignment.can_receive_custody} onCheckedChange={(checked) => setAssignment({ ...assignment, can_receive_custody: checked === true })} />استلام عهدة</label><label className="flex items-center gap-2"><Checkbox checked={assignment.can_approve_return} onCheckedChange={(checked) => setAssignment({ ...assignment, can_approve_return: checked === true })} />اعتماد مرتجع</label></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 md:col-span-3">صلاحية البيع غير متاحة لعهد OGPM/OGSV1. البيع يتم من خلال هوية مندوب ميداني أو تاجر مرتبطة ومفعلة.</div>
            <div className="flex gap-2 md:col-span-3"><Button disabled={working} onClick={() => void saveAssignment()}>{working ? "جاري الحفظ..." : "حفظ التكليف"}</Button>{editing && <Button variant="outline" onClick={resetAssignment}>إلغاء التعديل</Button>}</div>
          </CardContent></Card>
          <Card><CardContent className="overflow-auto p-0"><Table><TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>الكود</TableHead><TableHead>المشروع</TableHead><TableHead>المدينة</TableHead><TableHead>الصلاحيات</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{data?.assignments.map((row) => <TableRow key={row.id}><TableCell>{row.employee?.full_name}</TableCell><TableCell><Badge variant="outline">{row.position_code}</Badge></TableCell><TableCell>{row.project?.name}</TableCell><TableCell>{row.city}</TableCell><TableCell className="text-xs">{row.can_receive_custody ? "استلام" : ""}{row.can_approve_return ? " · اعتماد مرتجع" : ""}</TableCell><TableCell>{statusLabel(row.status)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => editAssignment(row)}>تعديل</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="report"><Card><CardHeader><CardTitle>العهد حسب المشروع والمدينة والمستلم</CardTitle></CardHeader><CardContent className="overflow-auto p-0"><Table><TableHeader><TableRow><TableHead>المشروع</TableHead><TableHead>المدينة</TableHead><TableHead>المستلم</TableHead><TableHead>الكود</TableHead><TableHead>استلم</TableHead><TableHead>جاهز للبيع</TableHead><TableHead>مرتجع معلق</TableHead><TableHead>بانتظار التسليم</TableHead><TableHead>في عهدته فعلياً</TableHead><TableHead>مباع</TableHead><TableHead>مرتجع</TableHead></TableRow></TableHeader><TableBody>{data?.report.map((row) => <TableRow key={row.assignment_id}><TableCell>{row.project_name}</TableCell><TableCell>{row.city}</TableCell><TableCell>{row.recipient_name}</TableCell><TableCell>{row.position_code}</TableCell><TableCell>{row.received_units}</TableCell><TableCell>{row.ready_to_sell_units}</TableCell><TableCell>{row.return_pending_units}</TableCell><TableCell>{row.awaiting_delivery_units}</TableCell><TableCell className="font-semibold">{row.physically_held_units}</TableCell><TableCell>{row.sold_units}</TableCell><TableCell>{row.returned_units}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

        <TabsContent value="history"><Card><CardContent className="overflow-auto p-0"><Table><TableHeader><TableRow><TableHead>رقم التسليم</TableHead><TableHead>المستلم</TableHead><TableHead>الكود</TableHead><TableHead>المشروع / المدينة</TableHead><TableHead>العدد</TableHead><TableHead>الحالة</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader><TableBody>{data?.handovers.map((row) => <TableRow key={row.id}><TableCell className="font-mono">{row.handover_no}</TableCell><TableCell>{row.recipient_name_snapshot}</TableCell><TableCell>{row.position_code_snapshot}</TableCell><TableCell>{row.project_name_snapshot} · {row.city_snapshot}</TableCell><TableCell>{row.lines?.length ?? 0}</TableCell><TableCell>{statusLabel(row.status)}</TableCell><TableCell>{new Date(row.issued_at).toLocaleDateString("ar-EG")}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}

export function ProductEmployeeCustodyRecipientScreen() {
  const [data, setData] = useState<ProductEmployeeCustodyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const signatureRefs = useRef<Record<string, SignatureCanvas | null>>({});

  async function load() {
    setLoading(true);
    const result = await getMyProductEmployeeCustody();
    setLoading(false);
    if (result.error) setMessage(result.error);
    else setData(result.data);
  }
  useEffect(() => { void load(); }, []);

  async function accept(handoverId: string, version: number) {
    const signature = signatureRefs.current[handoverId];
    if (!signature || signature.isEmpty()) return setMessage("يجب التوقيع قبل تأكيد الاستلام.");
    setWorkingId(handoverId);
    setMessage("");
    const result = await acceptProductEmployeeHandover(handoverId, {
      command_id: newInventoryCommandId(),
      expected_version: version,
      signature_data: signature.toDataURL("image/png"),
    });
    setWorkingId("");
    if (result.error) return setMessage(result.error);
    setMessage("تم تأكيد الاستلام وإضافة الأجهزة إلى عهدتك.");
    await load();
  }

  if (loading && !data) return <div className="p-8 text-center text-slate-500">جاري تحميل عهدتك...</div>;
  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold md:text-3xl">عهدة أجهزة الراوتر</h1><p className="mt-1 text-sm text-slate-500">{data?.employee.full_name} · راجع كل سيريال قبل التوقيع.</p></div><Button variant="outline" asChild><Link href="/sales/inventory/returns">طلب مرتجع</Link></Button></div>
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
      <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-slate-500">بانتظار قبولك</p><p className="mt-2 text-3xl font-bold">{data?.pending_handovers.length ?? 0}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-slate-500">في عهدتك فعلياً</p><p className="mt-2 text-3xl font-bold">{data?.units.filter((unit) => ["with_custodian", "return_pending", "return_approved"].includes(unit.status)).length ?? 0}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-slate-500">جاهز للبيع</p><p className="mt-2 text-3xl font-bold">{data?.units.filter((unit) => unit.status === "with_custodian").length ?? 0}</p></CardContent></Card></div>
      {(data?.pending_handovers ?? []).map((handover) => <Card key={handover.id} className="border-amber-200"><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>{handover.handover_no}</span><Badge variant="outline">{handover.position_code_snapshot} · {handover.project_name_snapshot} · {handover.city_snapshot}</Badge></CardTitle></CardHeader><CardContent className="space-y-4"><div className="overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>السيريال</TableHead><TableHead>المنتج</TableHead><TableHead>سعر البيع</TableHead></TableRow></TableHeader><TableBody>{handover.lines?.map((line) => <TableRow key={line.id}><TableCell className="font-mono">{line.unit?.raw_serial_number}</TableCell><TableCell>{line.unit?.product?.name}</TableCell><TableCell>{Number(line.planned_sale_price_snapshot).toLocaleString()} {line.currency}</TableCell></TableRow>)}</TableBody></Table></div><div><Label>التوقيع الإلكتروني *</Label><div className="mt-2 overflow-hidden rounded-lg border bg-white"><SignatureCanvas ref={(instance) => { signatureRefs.current[handover.id] = instance; }} penColor="#0f172a" canvasProps={{ className: "h-40 w-full", style: { width: "100%", height: "160px" } }} /></div><Button className="mt-2" size="sm" variant="outline" onClick={() => signatureRefs.current[handover.id]?.clear()}>مسح التوقيع</Button></div><Button disabled={workingId === handover.id} onClick={() => void accept(handover.id, handover.version)}><ClipboardCheck className="ml-2 h-4 w-4" />{workingId === handover.id ? "جاري التأكيد..." : `أؤكد استلام ${handover.lines?.length ?? 0} جهاز`}</Button></CardContent></Card>)}
      {(data?.pending_handovers.length ?? 0) === 0 && <Card><CardContent className="flex items-center gap-3 p-6 text-green-800"><CheckCircle2 className="h-6 w-6" /><span>لا توجد تسليمات جديدة بانتظار قبولك.</span></CardContent></Card>}
      <Card><CardHeader><CardTitle>السيريالات الحالية في عهدتك</CardTitle></CardHeader><CardContent className="overflow-auto p-0"><Table><TableHeader><TableRow><TableHead>السيريال</TableHead><TableHead>المنتج</TableHead><TableHead>المشروع</TableHead><TableHead>المدينة</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>{data?.units.map((unit) => <TableRow key={unit.id}><TableCell className="font-mono">{unit.raw_serial_number}</TableCell><TableCell>{unit.product?.name}</TableCell><TableCell>{data.assignments.find((row) => row.id === unit.current_custodian_assignment_id)?.project?.name || "—"}</TableCell><TableCell>{unit.current_city_snapshot}</TableCell><TableCell>{statusLabel(unit.status)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    </div>
  );
}
