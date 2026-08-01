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
  createProductTraderSale,
  getAgentProductTraderWorkspace,
  getMerchantProductTraderWorkspace,
  getProductTraderFinanceWorkspace,
  issueProductTraderHandover,
  productTraderCommandId,
  requestProductTraderPriceOverride,
  requestProductTraderReturn,
  reportProductTraderLoss,
  recoverProductTraderLoss,
  getProductTraderOversight,
  rejectProductTraderHandover,
  reviewProductTraderPriceOverride,
  reviewProductTraderCollection,
  reviewProductTraderReturn,
  submitProductTraderCollection,
} from "@/lib/services/product-trader";
import type { ProductTraderHandover, ProductTraderPriceOverride, ProductTraderSale, ProductTraderWorkspace } from "@/types/product-trader";

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
      <Card><CardHeader><CardTitle>دفعات التجار بانتظار التأكيد</CardTitle></CardHeader><CardContent className="space-y-2">{data?.collections.filter((item)=>item.status==="submitted").map((item)=><div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><span>{item.merchant?.business_name} · {item.amount} ر.س</span><div className="flex gap-2"><Button size="sm" onClick={async()=>{const result=await reviewProductTraderCollection(item.id,item.version,"confirmed");setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم تأكيد الدفعة."});await load();}}>تأكيد</Button><Button size="sm" variant="destructive" onClick={async()=>{const reason=window.prompt("سبب الرفض:")||"";if(!reason)return;const result=await reviewProductTraderCollection(item.id,item.version,"rejected",reason);setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم رفض الدفعة."});await load();}}>رفض</Button></div></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>مرتجعات وفاقد التجار</CardTitle></CardHeader><CardContent className="space-y-2">{data?.returns.filter((item)=>item.status==="requested").map((item)=><div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><span>{item.unit?.product?.name} · {item.unit?.raw_serial_number} · {item.reason}</span><div className="flex gap-2"><Button size="sm" onClick={async()=>{const result=await reviewProductTraderReturn(item.id,item.version,"received","استلام وفحص المندوب");setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم استلام المرتجع وإسقاطه من عهدة التاجر."});await load();}}>استلام</Button><Button size="sm" variant="destructive" onClick={async()=>{const result=await reviewProductTraderReturn(item.id,item.version,"rejected","رفض بعد الفحص");setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم رفض المرتجع."});await load();}}>رفض</Button></div></div>)}{data?.losses.filter((item)=>item.status!=="recovered").map((item)=><div key={item.id} className="flex items-center justify-between rounded-lg border border-red-200 p-3"><span>فاقد: {item.unit?.raw_serial_number} · {item.reason}</span><Button size="sm" variant="outline" onClick={async()=>{const result=await recoverProductTraderLoss(item.id,"sellable","تم العثور عليه واستلامه");setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم إثبات استرداد الجهاز."});await load();}}>إثبات الاسترداد</Button></div>)}</CardContent></Card>
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
  const pay=async()=>{const amount=window.prompt("قيمة الدفعة:");if(!amount)return;const method=(window.prompt("طريقة الدفع: cash أو bank_transfer","cash")||"cash");const result=await submitProductTraderCollection({amount:Number(amount),payment_method:method});setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم إرسال الدفعة للمندوب للتأكيد."});await load();};
  return <MerchantShell title="منتجاتي" subtitle="استلم الأجهزة بالسيريال وتابع العهدة.">
    <NoticeBanner notice={notice} />{data && !data.enabled ? <DisabledBanner /> : null}
    <div className="grid gap-4 sm:grid-cols-4"><Card><CardContent className="p-4"><p className="text-sm text-slate-500">في عهدتي</p><p className="text-3xl font-bold">{data?.held_units.filter((unit) => unit.status === "with_merchant").length || 0}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-slate-500">بانتظار الاستلام</p><p className="text-3xl font-bold text-amber-600">{pending.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-slate-500">المستحق للشركة</p><p className="text-2xl font-bold text-red-600">{Number(data?.balances[0]?.outstanding||0).toLocaleString("ar-EG")}</p><Button size="sm" className="mt-2" onClick={pay}>إرسال دفعة</Button></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-slate-500">عمولاتي</p><p className="text-2xl font-bold text-emerald-600">{Number(data?.balances[0]?.merchant_commission||0).toLocaleString("ar-EG")}</p><Button className="mt-2" variant="outline" onClick={load}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button></CardContent></Card></div>
    {pending.map((handover) => <MerchantHandoverCard key={handover.id} handover={handover} requireSignature={Boolean(data?.require_signature)} onDone={complete} />)}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />الأجهزة المستلمة</CardTitle></CardHeader><CardContent className="space-y-2">{data?.held_units.filter((unit) => unit.status === "with_merchant").map((unit) => <div key={unit.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><span>{unit.product?.name || "منتج"}</span><span className="mr-3 font-mono text-xs">{unit.raw_serial_number}</span></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={async()=>{const reason=window.prompt("سبب المرتجع:");const evidence=window.prompt("رابط/مسار صورة حالة الجهاز:");if(!reason||!evidence)return;const result=await requestProductTraderReturn({unit_id:unit.id,reason,condition:"sealed",evidence_path:evidence});setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم إرسال طلب المرتجع."});await load();}}>إرجاع</Button><Button size="sm" variant="destructive" onClick={async()=>{const reason=window.prompt("سبب الفقد أو التلف:");const evidence=window.prompt("رابط/مسار الإثبات:");if(!reason||!evidence)return;const result=await reportProductTraderLoss({unit_id:unit.id,loss_type:"missing",reason,evidence_path:evidence});setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم تسجيل البلاغ وإشعار الإدارة."});await load();}}>بلاغ فاقد</Button></div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>سجل التسليم</CardTitle></CardHeader><CardContent className="space-y-2">{data?.handovers.map((handover) => <HandoverSummary key={handover.id} handover={handover} />)}</CardContent></Card>
  </MerchantShell>;
}

export function MerchantProductSaleScreen() {
  const [data, setData] = useState<ProductTraderWorkspace | null>(null);
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");
  const [payment, setPayment] = useState("cash");
  const [customer, setCustomer] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const result = await getMerchantProductTraderWorkspace();
    if (result.error) setNotice({ tone: "error", text: result.error.message }); else setData(result.data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const unit = data?.held_units.find((item) => item.id === unitId);
  const approvedOverride = data?.price_overrides.find((item) => item.unit_id === unitId && item.status === "approved" && Number(item.approved_price) === Number(price));
  const outsideRange = Boolean(unit && price && (Number(price) < Number(unit.minimum_sale_price_snapshot) || Number(price) > Number(unit.maximum_sale_price_snapshot)));
  const sell = async () => {
    if (!unitId || !price) return setNotice({ tone: "error", text: "اختر الجهاز وأدخل سعر البيع." });
    setSaving(true);
    const result = await createProductTraderSale({ sale_id: crypto.randomUUID(), unit_id: unitId, sale_price: Number(price), payment_method: payment, customer_name: customer || undefined, price_override_id: approvedOverride?.id });
    setSaving(false);
    if (result.error) return setNotice({ tone: "error", text: result.error.message });
    setUnitId(""); setPrice(""); setCustomer(""); setNotice({ tone: "success", text: "تم تسجيل البيع وإسقاط الجهاز من عهدتك." }); await load();
  };
  const requestPrice = async () => {
    const reason = window.prompt("اكتب سبب طلب السعر الاستثنائي:");
    if (!reason || !unitId || !price) return;
    const result = await requestProductTraderPriceOverride({ unit_id: unitId, sale_price: Number(price), reason });
    setNotice(result.error ? { tone: "error", text: result.error.message } : { tone: "success", text: "أُرسل الطلب إلى مدير المالية للمراجعة." }); await load();
  };
  return <MerchantShell title="بيع منتج" subtitle="البيع بالسيريال وضمن نطاق السعر الذي حددته المالية.">
    <NoticeBanner notice={notice} />
    <Card><CardHeader><CardTitle>بيانات البيع</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="space-y-2"><Label>الجهاز</Label><select className="h-10 w-full rounded-md border bg-white px-3" value={unitId} onChange={(event) => { const id=event.target.value; setUnitId(id); const picked=data?.held_units.find((item)=>item.id===id); setPrice(String(picked?.planned_sale_price_snapshot || "")); }}><option value="">اختر بالسيريال</option>{data?.held_units.filter((item)=>item.status==="with_merchant").map((item)=><option key={item.id} value={item.id}>{item.product?.name} · {item.raw_serial_number}</option>)}</select></div>
      {unit ? <div className="rounded-lg bg-slate-50 p-3 text-sm">السعر المخطط: {unit.planned_sale_price_snapshot} · النطاق: {unit.minimum_sale_price_snapshot} — {unit.maximum_sale_price_snapshot} {unit.currency}</div> : null}
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>سعر البيع</Label><Input type="number" value={price} onChange={(event)=>setPrice(event.target.value)} /></div><div className="space-y-2"><Label>طريقة الدفع</Label><select className="h-10 w-full rounded-md border bg-white px-3" value={payment} onChange={(event)=>setPayment(event.target.value)}><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="card">بطاقة</option><option value="electronic">إلكتروني</option><option value="credit">آجل</option></select></div></div>
      <div className="space-y-2"><Label>اسم العميل (اختياري)</Label><Input value={customer} onChange={(event)=>setCustomer(event.target.value)} /></div>
      {outsideRange && !approvedOverride ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">السعر خارج النطاق ويحتاج موافقة المالية. <Button className="mr-2" size="sm" variant="outline" onClick={requestPrice}>طلب موافقة</Button></div> : null}
      {approvedOverride ? <p className="text-sm text-emerald-700">السعر الاستثنائي معتمد ويمكن استخدامه مرة واحدة.</p> : null}
      <Button onClick={sell} disabled={saving || !unitId || !price || (outsideRange && !approvedOverride)}>تسجيل البيع</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>آخر المبيعات</CardTitle></CardHeader><CardContent className="space-y-2">{data?.sales.map((sale)=><div key={sale.id} className="flex justify-between rounded-lg border p-3 text-sm"><span>{sale.sale_no}</span><span>{Number(sale.total_amount).toLocaleString("ar-EG")} · عمولتك {Number(sale.merchant_commission_amount).toLocaleString("ar-EG")}</span></div>)}</CardContent></Card>
  </MerchantShell>;
}

export function FinanceProductTraderPricingScreen() {
  const [sales, setSales] = useState<ProductTraderSale[]>([]);
  const [overrides, setOverrides] = useState<ProductTraderPriceOverride[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const load = useCallback(async()=>{ const result=await getProductTraderFinanceWorkspace(); if(result.error)setNotice({tone:"error",text:result.error.message}); else {setSales(result.data?.sales||[]);setOverrides(result.data?.price_overrides||[]);} },[]);
  useEffect(()=>{void load();},[load]);
  const review=async(item:ProductTraderPriceOverride,decision:"approved"|"rejected")=>{const note=window.prompt("ملاحظة القرار (اختياري):")||undefined;const result=await reviewProductTraderPriceOverride(item.id,{expected_version:item.version,decision,review_note:note});setNotice(result.error?{tone:"error",text:result.error.message}:{tone:"success",text:"تم حفظ قرار المالية."});await load();};
  return <div className="space-y-6" dir="rtl"><div><h1 className="text-3xl font-bold">مبيعات وأسعار التجار</h1><p className="text-slate-500">مراجعة استثناءات السعر ومراقبة المبيعات بالسيريال.</p></div><NoticeBanner notice={notice}/>
    <Card><CardHeader><CardTitle>طلبات الأسعار المعلقة</CardTitle></CardHeader><CardContent className="space-y-2">{overrides.filter((item)=>item.status==="pending").map((item)=><div key={item.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{item.merchant?.business_name} · {item.unit?.product?.name}</p><p className="text-xs text-slate-500">{item.unit?.raw_serial_number} · السعر المطلوب {item.requested_price} {item.currency} · {item.reason}</p></div><div className="flex gap-2"><Button size="sm" onClick={()=>review(item,"approved")}>اعتماد</Button><Button size="sm" variant="destructive" onClick={()=>review(item,"rejected")}>رفض</Button></div></div>)}{!overrides.some((item)=>item.status==="pending")?<p className="text-sm text-slate-500">لا توجد طلبات معلقة.</p>:null}</CardContent></Card>
    <Card><CardHeader><CardTitle>المبيعات</CardTitle></CardHeader><CardContent className="space-y-2">{sales.map((sale)=><div key={sale.id} className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4"><span>{sale.sale_no}</span><span>{sale.merchant?.business_name}</span><span>{sale.total_amount}</span><Badge variant="outline">{sale.accounting_status}</Badge></div>)}</CardContent></Card>
  </div>;
}

export function ProductTraderOversightScreen(){
  const[data,setData]=useState<Record<string,unknown>|null>(null);const[notice,setNotice]=useState<Notice>(null);
  useEffect(()=>{getProductTraderOversight().then((result)=>{if(result.error)setNotice({tone:"error",text:result.error.message});else setData(result.data);});},[]);
  const balances=(data?.balances||[]) as Array<{merchant_id:string;business_name:string;outstanding:number;sales_total:number;confirmed_collections:number}>;
  const handovers=(data?.handovers||[]) as ProductTraderHandover[];const returns=(data?.returns||[]) as Array<{id:string;status:string}>;const losses=(data?.losses||[]) as Array<{id:string;status:string}>;
  return <div className="space-y-6" dir="rtl"><div><h1 className="text-3xl font-bold">متابعة منتجات التجار</h1><p className="text-slate-500">صورة تشغيلية للـ on-ground والمالية بدون إتاحة تغيير التكلفة أو السعر.</p></div><NoticeBanner notice={notice}/><div className="grid gap-4 sm:grid-cols-4"><Card><CardContent className="p-4"><p className="text-sm">التجار</p><p className="text-3xl font-bold">{balances.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm">تسليمات معلقة</p><p className="text-3xl font-bold">{handovers.filter((item)=>item.status==="issued").length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm">مرتجعات مفتوحة</p><p className="text-3xl font-bold">{returns.filter((item)=>item.status==="requested").length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm">فاقد مفتوح</p><p className="text-3xl font-bold text-red-600">{losses.filter((item)=>item.status!=="recovered").length}</p></CardContent></Card></div><Card><CardHeader><CardTitle>أرصدة التجار</CardTitle></CardHeader><CardContent className="space-y-2">{balances.map((item)=><div key={item.merchant_id} className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4"><span>{item.business_name}</span><span>مبيعات {item.sales_total}</span><span>محصل {item.confirmed_collections}</span><strong className="text-red-600">مستحق {item.outstanding}</strong></div>)}</CardContent></Card></div>;
}
