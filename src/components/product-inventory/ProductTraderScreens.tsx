"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCcw, Send, Store, XCircle } from "lucide-react";
import { AgentShell } from "@/components/field-agents/AgentScreens";
import { MerchantShell } from "@/components/merchants/MerchantScreens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptProductTraderHandover,
  cancelProductTraderHandover,
  getAgentProductTraderWorkspace,
  getMerchantProductTraderWorkspace,
  issueProductTraderHandover,
  productTraderCommandId,
  rejectProductTraderHandover,
} from "@/lib/services/product-trader";
import type { ProductTraderHandover, ProductTraderWorkspace } from "@/types/product-trader";

type Notice = { tone: "success" | "error"; text: string } | null;
type Decision = "accepted" | "missing" | "damaged";

const statusLabels: Record<string, string> = {
  issued: "بانتظار التاجر", accepted: "مستلم", partially_accepted: "استلام جزئي",
  rejected: "مرفوض", cancelled: "ملغي", expired: "منتهي",
};

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <div className={`rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{notice.text}</div>;
}

function DisabledBanner() {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">توزيع منتجات التجار غير مفعّل حالياً. مدير المالية يستطيع تفعيله بعد مراجعة سياسة التسليم والتوقيع.</div>;
}

function HandoverSummary({ handover }: { handover: ProductTraderHandover }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{handover.handover_no}</span>
          <Badge variant="outline">{statusLabels[handover.status] || handover.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">{handover.merchant?.business_name || "التاجر"} · {handover.lines.length} جهاز · {new Date(handover.issued_at).toLocaleString("ar-EG")}</p>
      </div>
      <div className="text-xs text-slate-500">{handover.lines.map((line) => line.serial_snapshot).join("، ")}</div>
    </div>
  );
}

export function AgentProductTraderScreen() {
  const [data, setData] = useState<ProductTraderWorkspace | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await getAgentProductTraderWorkspace();
    if (result.error) setNotice({ tone: "error", text: result.error.message });
    else setData(result.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const submit = async () => {
    if (!merchantId || selected.length === 0) return setNotice({ tone: "error", text: "اختر التاجر وجهازاً واحداً على الأقل." });
    setSaving(true);
    const result = await issueProductTraderHandover({
      handover_id: crypto.randomUUID(), command_id: productTraderCommandId(), merchant_id: merchantId,
      unit_ids: selected, notes: notes || undefined,
    });
    setSaving(false);
    if (result.error) return setNotice({ tone: "error", text: result.error.message });
    setSelected([]); setNotes("");
    setNotice({ tone: "success", text: "تم إصدار التسليم وإرساله للتاجر للتأكيد." });
    await load();
  };

  const cancel = async (handover: ProductTraderHandover) => {
    if (!window.confirm("إلغاء هذا التسليم وإرجاع الأجهزة إلى عهدتك؟")) return;
    const result = await cancelProductTraderHandover(handover.id, handover.version, "إلغاء من المندوب");
    if (result.error) setNotice({ tone: "error", text: result.error.message });
    else { setNotice({ tone: "success", text: "تم إلغاء التسليم." }); await load(); }
  };

  return (
    <AgentShell title="منتجات التجار" subtitle="سلّم الأجهزة بالسيريال وتابع تأكيد التاجر.">
      <NoticeBanner notice={notice} />
      {data && !data.enabled ? <DisabledBanner /> : null}
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />تسليم جديد</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>التاجر</Label><select className="h-10 w-full rounded-md border bg-white px-3" value={merchantId} onChange={(event) => setMerchantId(event.target.value)}><option value="">اختر التاجر</option>{data?.merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.business_name}</option>)}</select></div>
            <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="اختياري" /></div>
          </div>
          <div className="space-y-2"><Label>الأجهزة الموجودة في عهدتك ({selected.length} محدد)</Label>
            <div className="max-h-72 space-y-2 overflow-auto rounded-lg border p-2">{data?.available_units.length ? data.available_units.map((unit) => <label key={unit.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3"><input type="checkbox" checked={selected.includes(unit.id)} onChange={() => toggle(unit.id)} /><span className="font-medium">{unit.product?.name || "منتج"}</span><span className="font-mono text-xs text-slate-500">{unit.raw_serial_number}</span></label>) : <p className="p-4 text-center text-sm text-slate-500">لا توجد أجهزة متاحة في عهدتك.</p>}</div>
          </div>
          <Button onClick={submit} disabled={saving || !data?.enabled || !merchantId || !selected.length}>إصدار التسليم</Button>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>سجل التسليمات</CardTitle></CardHeader><CardContent className="space-y-2">{data?.handovers.map((handover) => <div key={handover.id} className="space-y-2"><HandoverSummary handover={handover} />{handover.status === "issued" ? <Button size="sm" variant="outline" onClick={() => cancel(handover)}><XCircle className="ml-2 h-4 w-4" />إلغاء</Button> : null}</div>)}</CardContent></Card>
    </AgentShell>
  );
}

function MerchantHandoverCard({ handover, requireSignature, onDone }: { handover: ProductTraderHandover; requireSignature: boolean; onDone: (notice: Notice) => void }) {
  const pending = handover.lines.filter((line) => line.line_status === "pending");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(pending.map((line) => [line.unit_id, "accepted"])));
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    const result = await acceptProductTraderHandover(handover.id, {
      expected_version: handover.version,
      accepted_unit_ids: pending.filter((line) => decisions[line.unit_id] === "accepted").map((line) => line.unit_id),
      rejected_units: pending.filter((line) => decisions[line.unit_id] !== "accepted").map((line) => ({ unit_id: line.unit_id, reason: decisions[line.unit_id] as "missing" | "damaged" })),
      rejection_reason: "نتيجة فحص التاجر عند الاستلام",
      signature_data: requireSignature ? signature : undefined,
    });
    setSaving(false);
    onDone(result.error ? { tone: "error", text: result.error.message } : { tone: "success", text: "تم حفظ نتيجة فحص واستلام الأجهزة." });
  };
  const rejectAll = async () => {
    const reason = window.prompt("اكتب سبب رفض التسليم بالكامل:");
    if (!reason) return;
    const result = await rejectProductTraderHandover(handover.id, handover.version, reason);
    onDone(result.error ? { tone: "error", text: result.error.message } : { tone: "success", text: "تم رفض التسليم وإبلاغ المندوب." });
  };
  return <Card className="border-amber-200"><CardHeader><CardTitle className="text-base">{handover.handover_no} · {pending.length} جهاز</CardTitle></CardHeader><CardContent className="space-y-3">
    {pending.map((line) => <div key={line.id} className="rounded-lg border p-3"><p className="font-medium">{line.product_name_snapshot}</p><p className="font-mono text-xs text-slate-500">{line.serial_snapshot}</p><div className="mt-2 flex flex-wrap gap-2">{(["accepted", "missing", "damaged"] as Decision[]).map((decision) => <Button key={decision} type="button" size="sm" variant={decisions[line.unit_id] === decision ? "default" : "outline"} onClick={() => setDecisions((current) => ({ ...current, [line.unit_id]: decision }))}>{decision === "accepted" ? "موجود وسليم" : decision === "missing" ? "غير موجود" : "تالف"}</Button>)}</div></div>)}
    {requireSignature ? <div className="space-y-2"><Label>تأكيد التوقيع (اكتب الاسم الرباعي)</Label><Input value={signature} onChange={(event) => setSignature(event.target.value)} /></div> : null}
    <div className="flex gap-2"><Button onClick={submit} disabled={saving || (requireSignature && signature.trim().length < 20)}><PackageCheck className="ml-2 h-4 w-4" />اعتماد نتيجة الفحص</Button><Button variant="destructive" onClick={rejectAll}>رفض الكل</Button></div>
  </CardContent></Card>;
}

export function MerchantProductsScreen() {
  const [data, setData] = useState<ProductTraderWorkspace | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const load = useCallback(async () => {
    const result = await getMerchantProductTraderWorkspace();
    if (result.error) setNotice({ tone: "error", text: result.error.message }); else setData(result.data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pending = useMemo(() => data?.handovers.filter((handover) => handover.status === "issued") || [], [data]);
  const complete = (value: Notice) => { setNotice(value); void load(); };
  return <MerchantShell title="منتجاتي" subtitle="استلم الأجهزة بالسيريال وتابع العهدة.">
    <NoticeBanner notice={notice} />{data && !data.enabled ? <DisabledBanner /> : null}
    <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-sm text-slate-500">في عهدتي</p><p className="text-3xl font-bold">{data?.held_units.filter((unit) => unit.status === "with_merchant").length || 0}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-slate-500">بانتظار الاستلام</p><p className="text-3xl font-bold text-amber-600">{pending.length}</p></CardContent></Card><Card><CardContent className="p-4"><Button variant="outline" onClick={load}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button></CardContent></Card></div>
    {pending.map((handover) => <MerchantHandoverCard key={handover.id} handover={handover} requireSignature={Boolean(data?.require_signature)} onDone={complete} />)}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />الأجهزة المستلمة</CardTitle></CardHeader><CardContent className="space-y-2">{data?.held_units.filter((unit) => unit.status === "with_merchant").map((unit) => <div key={unit.id} className="flex items-center justify-between rounded-lg border p-3"><span>{unit.product?.name || "منتج"}</span><span className="font-mono text-xs">{unit.raw_serial_number}</span></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>سجل التسليم</CardTitle></CardHeader><CardContent className="space-y-2">{data?.handovers.map((handover) => <HandoverSummary key={handover.id} handover={handover} />)}</CardContent></Card>
  </MerchantShell>;
}
