"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, PackageCheck, RefreshCcw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelProductReturn,
  getProductReturnWorkspace,
  newInventoryCommandId,
  receiveProductReturn,
  reviewProductReturn,
  submitProductReturn,
} from "@/lib/services/product-inventory";
import type { ProductReturnRequest, ProductReturnWorkspaceData } from "@/types/product-inventory";

type Condition = "sealed" | "good" | "open_box" | "damaged" | "unknown";
type Disposition = "sellable" | "quarantine" | "damaged";

const statusLabels: Record<string, string> = {
  pending_approval: "قيد الاعتماد",
  approved_awaiting_delivery: "معتمد · بانتظار التسليم",
  rejected: "مرفوض",
  partially_received: "استلام جزئي",
  received: "تم الاستلام",
  cancelled: "ملغي",
  pending: "قيد الاعتماد",
  awaiting_delivery: "بانتظار التسليم",
  received_sellable: "مستلم · صالح للبيع",
  received_quarantine: "مستلم · حجر وفحص",
  received_damaged: "مستلم · تالف",
  approved: "موافق",
};

const conditionLabels: Record<Condition, string> = {
  sealed: "مغلق",
  good: "جيد",
  open_box: "مفتوح",
  damaged: "تالف",
  unknown: "غير محدد",
};

function statusLabel(value: string) {
  return statusLabels[value] ?? value;
}

export function ProductReturnWorkflowScreen() {
  const [data, setData] = useState<ProductReturnWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    unit_id: "",
    warehouse_id: "",
    reason_summary: "",
    requester_note: "",
    claimed_condition: "good" as Condition,
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [receiptNotes, setReceiptNotes] = useState<Record<string, string>>({});
  const [receiptRows, setReceiptRows] = useState<Record<string, {
    scanned_serial: string;
    disposition: Disposition;
    condition_received: Condition;
    inspection_note: string;
  }>>({});

  async function load() {
    setLoading(true);
    const result = await getProductReturnWorkspace();
    setLoading(false);
    if (result.error) setMessage(result.error);
    else {
      setData(result.data);
      setForm((current) => ({
        ...current,
        warehouse_id: current.warehouse_id || result.data?.warehouses.find((row) => row.is_default)?.id || result.data?.warehouses[0]?.id || "",
      }));
    }
  }

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => ({
    pending: data?.requests.filter((request) => request.status === "pending_approval").length ?? 0,
    delivery: data?.requests.filter((request) => ["approved_awaiting_delivery", "partially_received"].includes(request.status)).length ?? 0,
    completed: data?.requests.filter((request) => request.status === "received").length ?? 0,
  }), [data?.requests]);

  function canReview(request: ProductReturnRequest) {
    if (request.status !== "pending_approval") return false;
    return request.approvals?.some((approval) => (
      approval.decision === "pending"
      && ((approval.approver_type === "finance_manager" && data?.access.can_review_finance)
        || (approval.approver_type === "project_manager" && approval.is_assigned_to_me))
    )) ?? false;
  }

  async function submit() {
    const minimumPhotos = data?.settings.minimum_return_photos ?? 1;
    if (!form.unit_id || !form.warehouse_id || form.reason_summary.trim().length < 3 || form.requester_note.trim().length < 3) {
      return setMessage("اختر السيريال والمخزن واكتب سببًا وملاحظة واضحة.");
    }
    if (photos.length < minimumPhotos || photos.length > (data?.settings.maximum_return_photos ?? 3)) {
      return setMessage(`أرفق من ${minimumPhotos} إلى ${data?.settings.maximum_return_photos ?? 3} صور للسيريال.`);
    }
    setWorking("submit");
    setMessage("");
    const result = await submitProductReturn({
      return_request_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      warehouse_id: form.warehouse_id,
      reason_summary: form.reason_summary,
      lines: [{
        line_id: crypto.randomUUID(),
        unit_id: form.unit_id,
        requester_note: form.requester_note,
        claimed_condition: form.claimed_condition,
        photos: photos.map((file) => ({
          file,
          attachment_id: crypto.randomUUID(),
          managed_file_id: crypto.randomUUID(),
        })),
      }],
    });
    setWorking("");
    if (result.error) return setMessage(result.error);
    setForm((current) => ({ ...current, unit_id: "", reason_summary: "", requester_note: "" }));
    setPhotos([]);
    setMessage("تم إرسال طلب المرتجع بالصور، وتم إيقاف الجهاز عن البيع لحين اكتمال الدورة.");
    await load();
  }

  async function review(request: ProductReturnRequest, decision: "approved" | "rejected") {
    setWorking(`${decision}:${request.id}`);
    setMessage("");
    const result = await reviewProductReturn(request.id, {
      command_id: newInventoryCommandId(),
      expected_version: request.version,
      decision,
      decision_note: reviewNotes[request.id] || "",
    });
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage(decision === "approved" ? "تم اعتماد طلب المرتجع." : "تم رفض طلب المرتجع وإعادة الجهاز لحالته السابقة في العهدة.");
    await load();
  }

  async function cancel(request: ProductReturnRequest) {
    setWorking(`cancel:${request.id}`);
    setMessage("");
    const result = await cancelProductReturn(request.id, request.version, newInventoryCommandId());
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage("تم إلغاء طلب المرتجع.");
    await load();
  }

  function receiptRow(lineId: string, serial: string) {
    return receiptRows[lineId] ?? {
      scanned_serial: serial,
      disposition: "sellable" as Disposition,
      condition_received: "good" as Condition,
      inspection_note: "",
    };
  }

  function updateReceiptRow(lineId: string, serial: string, patch: Partial<ReturnType<typeof receiptRow>>) {
    setReceiptRows((current) => ({ ...current, [lineId]: { ...receiptRow(lineId, serial), ...patch } }));
  }

  async function receive(request: ProductReturnRequest) {
    const lines = request.lines?.filter((line) => line.status === "awaiting_delivery") ?? [];
    if (lines.length === 0) return setMessage("لا توجد سيريالات بانتظار الاستلام.");
    if (lines.some((line) => !receiptRow(line.id, line.serial_snapshot).scanned_serial.trim())) {
      return setMessage("امسح أو اكتب السيريال الفعلي لكل جهاز مستلم.");
    }
    setWorking(`receive:${request.id}`);
    setMessage("");
    const result = await receiveProductReturn(request.id, {
      command_id: newInventoryCommandId(),
      receipt_id: crypto.randomUUID(),
      expected_version: request.version,
      warehouse_id: request.warehouse_id,
      notes: receiptNotes[request.id] || "",
      lines: lines.map((line) => {
        const value = receiptRow(line.id, line.serial_snapshot);
        return { request_line_id: line.id, ...value };
      }),
    });
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage("تم الاستلام الفعلي؛ أُسقطت الأجهزة من العهدة وحدّث المخزون حسب نتيجة الفحص.");
    await load();
  }

  if (loading && !data) return <div className="p-8 text-center text-slate-500">جاري تحميل دورة المرتجعات...</div>;

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 md:text-3xl">مرتجعات أجهزة الراوتر</h1>
          <p className="mt-1 text-sm text-slate-500">طلب بالصورة · اعتماد المشروع وFinance · استلام فعلي بمسح السيريال.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href={data?.access.can_receive ? "/sales/inventory" : "/sales/inventory/custody"}>العودة</Link></Button>
          <Button variant="outline" onClick={() => void load()}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-sm text-slate-500">قيد الاعتماد</p><p className="mt-2 text-3xl font-bold">{totals.pending}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-slate-500">بانتظار Finance</p><p className="mt-2 text-3xl font-bold">{totals.delivery}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-slate-500">مستلم فعليًا</p><p className="mt-2 text-3xl font-bold">{totals.completed}</p></CardContent></Card>
      </div>

      {data?.access.can_submit && (data.eligible_units.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" />طلب مرتجع جديد</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>السيريال من عهدتك</Label><Select value={form.unit_id} onValueChange={(value) => setForm({ ...form, unit_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر الجهاز" /></SelectTrigger><SelectContent>{data.eligible_units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.raw_serial_number} · {unit.product?.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>مخزن التسليم إلى Finance</Label><Select value={form.warehouse_id} onValueChange={(value) => setForm({ ...form, warehouse_id: value || "" })}><SelectTrigger><SelectValue placeholder="اختر المخزن" /></SelectTrigger><SelectContent>{data.warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2 md:col-span-2"><Label>سبب المرتجع</Label><Textarea value={form.reason_summary} onChange={(event) => setForm({ ...form, reason_summary: event.target.value })} placeholder="سبب مختصر يظهر للموافقين" /></div>
            <div className="space-y-2"><Label>حالة الجهاز حسب مقدم الطلب</Label><Select value={form.claimed_condition} onValueChange={(value) => value && setForm({ ...form, claimed_condition: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(conditionLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>ملاحظة السيريال</Label><Input value={form.requester_note} onChange={(event) => setForm({ ...form, requester_note: event.target.value })} placeholder="مثال: الكرتونة مغلقة والكابل موجود" /></div>
            <div className="space-y-2 md:col-span-2"><Label>صور الجهاز ({data.settings.minimum_return_photos}–{data.settings.maximum_return_photos})</Label><Input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setPhotos(Array.from(event.target.files ?? []).slice(0, data.settings.maximum_return_photos))} /><p className="text-xs text-slate-500">JPG/PNG/WebP، حد أقصى 8MB للصورة. تحفظ الصور بشكل خاص وتفحص قبل التسجيل.</p></div>
            <div className="md:col-span-2"><Button disabled={working === "submit"} onClick={() => void submit()}><Camera className="ml-2 h-4 w-4" />{working === "submit" ? "جاري الرفع..." : "إرسال طلب المرتجع بالصور"}</Button></div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(data?.requests ?? []).map((request) => {
          const awaitingLines = request.lines?.filter((line) => line.status === "awaiting_delivery") ?? [];
          return (
            <Card key={request.id}>
              <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{request.return_no}</span><Badge variant="outline">{statusLabel(request.status)}</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm md:grid-cols-4"><p><span className="text-slate-500">المشروع:</span> {request.project_name_snapshot}</p><p><span className="text-slate-500">المدينة:</span> {request.city_snapshot}</p><p><span className="text-slate-500">الكود:</span> {request.position_code_snapshot}</p><p><span className="text-slate-500">التاريخ:</span> {new Date(request.submitted_at).toLocaleString("ar-EG")}</p></div>
                <p className="rounded-lg bg-slate-50 p-3 text-sm">{request.reason_summary}</p>
                <div className="overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>السيريال</TableHead><TableHead>المنتج</TableHead><TableHead>الملاحظة</TableHead><TableHead>الحالة</TableHead><TableHead>الصور</TableHead></TableRow></TableHeader><TableBody>{request.lines?.map((line) => <TableRow key={line.id}><TableCell className="font-mono">{line.serial_snapshot}</TableCell><TableCell>{line.product_name_snapshot}</TableCell><TableCell>{line.requester_note}</TableCell><TableCell>{statusLabel(line.status)}</TableCell><TableCell><div className="flex flex-wrap gap-1">{line.attachments?.map((attachment, index) => <Button key={attachment.id} size="sm" variant="outline" asChild><a href={`/api/sales/inventory/return-requests/${request.id}/attachments/${attachment.id}`} target="_blank" rel="noreferrer">صورة {index + 1}</a></Button>)}</div></TableCell></TableRow>)}</TableBody></Table></div>
                <div className="flex flex-wrap gap-2">{request.approvals?.map((approval) => <Badge key={approval.id} variant={approval.decision === "approved" ? "default" : "outline"}>{approval.approver_type === "finance_manager" ? "Finance" : "OGPM"}: {statusLabel(approval.decision)}</Badge>)}</div>

                {canReview(request) && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4"><Label>ملاحظة الاعتماد</Label><Textarea value={reviewNotes[request.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))} /><div className="flex gap-2"><Button disabled={working.includes(request.id)} onClick={() => void review(request, "approved")}><CheckCircle2 className="ml-2 h-4 w-4" />اعتماد</Button><Button variant="destructive" disabled={working.includes(request.id)} onClick={() => void review(request, "rejected")}><AlertTriangle className="ml-2 h-4 w-4" />رفض</Button></div></div>}
                {request.can_cancel && <Button variant="outline" disabled={working.includes(request.id)} onClick={() => void cancel(request)}>إلغاء الطلب</Button>}

                {data?.access.can_receive && awaitingLines.length > 0 && <div className="space-y-4 rounded-lg border border-green-200 bg-green-50 p-4"><div><h3 className="font-semibold">الاستلام الفعلي لدى Finance</h3><p className="mt-1 text-xs text-green-900">لا تُسقط العهدة إلا بعد مطابقة السيريال هنا.</p></div>{awaitingLines.map((line) => { const value = receiptRow(line.id, line.serial_snapshot); return <div key={line.id} className="grid gap-3 rounded-lg bg-white p-3 md:grid-cols-4"><div className="space-y-1"><Label>السيريال الممسوح</Label><Input dir="ltr" value={value.scanned_serial} onChange={(event) => updateReceiptRow(line.id, line.serial_snapshot, { scanned_serial: event.target.value })} /></div><div className="space-y-1"><Label>نتيجة الفحص</Label><Select value={value.disposition} onValueChange={(selected) => selected && updateReceiptRow(line.id, line.serial_snapshot, { disposition: selected })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sellable">صالح للبيع</SelectItem><SelectItem value="quarantine">حجر وفحص</SelectItem><SelectItem value="damaged">تالف</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label>الحالة المستلمة</Label><Select value={value.condition_received} onValueChange={(selected) => selected && updateReceiptRow(line.id, line.serial_snapshot, { condition_received: selected })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(conditionLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>ملاحظة الفحص</Label><Input value={value.inspection_note} onChange={(event) => updateReceiptRow(line.id, line.serial_snapshot, { inspection_note: event.target.value })} /></div></div>; })}<div className="space-y-1"><Label>ملاحظة محضر الاستلام</Label><Textarea value={receiptNotes[request.id] || ""} onChange={(event) => setReceiptNotes((current) => ({ ...current, [request.id]: event.target.value }))} /></div><Button disabled={working.includes(request.id)} onClick={() => void receive(request)}><PackageCheck className="ml-2 h-4 w-4" />تأكيد استلام {awaitingLines.length} جهاز</Button></div>}
              </CardContent>
            </Card>
          );
        })}
        {(data?.requests.length ?? 0) === 0 && <Card><CardContent className="p-8 text-center text-sm text-slate-500">لا توجد طلبات مرتجع ضمن نطاقك.</CardContent></Card>}
      </div>
    </div>
  );
}
