"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Coins,
  Package,
  RotateCcw,
  ShieldAlert,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { AgentShell } from "@/components/field-agents/AgentScreens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import {
  acceptProductHandover,
  getProductAgentDashboard,
  newInventoryCommandId,
  recordAgentProductSale,
  requestProductPriceOverride,
  returnAgentProducts,
} from "@/lib/services/product-inventory";
import type {
  ProductAgentDashboardData,
  ProductHandoverLine,
  ProductInventoryStockRow,
} from "@/types/product-inventory";

type Mode = "dashboard" | "receive" | "sell" | "returns" | "balance";

const productNav = [
  { mode: "dashboard" as const, href: "/agent/products", label: "عهدتي", icon: Package },
  { mode: "receive" as const, href: "/agent/products/receive", label: "استلام", icon: Truck },
  { mode: "sell" as const, href: "/agent/products/sell", label: "بيع منتج", icon: ShoppingCart },
  { mode: "returns" as const, href: "/agent/products/returns", label: "مرتجع", icon: RotateCcw },
  { mode: "balance" as const, href: "/agent/product-balance", label: "رصيد المنتجات", icon: Wallet },
];

function money(value: unknown, currency = "SAR") {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency }).format(Number(value || 0));
}

function ProductNav({ mode }: { mode: Mode }) {
  return (
    <nav className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
      {productNav.map((item) => {
        const Icon = item.icon;
        return (
          <Button key={item.mode} asChild size="sm" variant={mode === item.mode ? "default" : "ghost"}>
            <Link href={item.href}><Icon className="ml-2 h-4 w-4" />{item.label}</Link>
          </Button>
        );
      })}
    </nav>
  );
}

function unitLabel(unit: ProductInventoryStockRow) {
  return `${unit.product?.name || "منتج"} · ${unit.raw_serial_number}`;
}

export function ProductAgentScreen({ mode }: { mode: Mode }) {
  const [data, setData] = useState<ProductAgentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [unitId, setUnitId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "card" | "electronic" | "agent_credit">("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [returnIds, setReturnIds] = useState<Set<string>>(new Set());
  const [returnWarehouseId, setReturnWarehouseId] = useState("");
  const [returnReason, setReturnReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getProductAgentDashboard();
    if (result.data) {
      setData(result.data);
      const sellable = result.data.units.find((unit) => unit.status === "with_agent");
      setUnitId((value) => value && result.data?.units.some((unit) => unit.id === value) ? value : sellable?.id || "");
      setReturnWarehouseId((value) => value || result.data?.warehouses[0]?.id || "");
    }
    setMessage(result.error || "");
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedUnit = data?.units.find((unit) => unit.id === unitId) || null;
  const selectedLine = useMemo(() => {
    if (!data || !selectedUnit) return null;
    return data.handover_lines
      .filter((line) => line.unit_id === selectedUnit.id && line.line_status === "accepted")
      .at(0) || null;
  }, [data, selectedUnit]);
  useEffect(() => {
    if (selectedLine) setSalePrice(String(selectedLine.planned_sale_price_snapshot));
  }, [selectedLine]);

  const numericPrice = Number(salePrice || 0);
  const outsideRange = Boolean(
    selectedLine
    && numericPrice > 0
    && (numericPrice < Number(selectedLine.minimum_sale_price) || numericPrice > Number(selectedLine.maximum_sale_price))
  );
  const approvedOverride = data?.price_overrides.find(
    (request) =>
      request.unit_id === unitId
      && request.status === "approved"
      && Number(request.requested_price) === numericPrice
  );

  const accept = async (handoverId: string, version: number) => {
    setSaving(true);
    const result = await acceptProductHandover(handoverId, version, newInventoryCommandId());
    setSaving(false);
    if (result.error) return setMessage(result.error);
    await load();
  };

  const requestOverride = async () => {
    if (!selectedUnit || numericPrice <= 0 || overrideReason.trim().length < 5) {
      return setMessage("اختر المنتج والسعر واكتب سبباً واضحاً لا يقل عن 5 أحرف.");
    }
    setSaving(true);
    const result = await requestProductPriceOverride({
      request_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      unit_id: selectedUnit.id,
      requested_price: numericPrice,
      reason: overrideReason,
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setOverrideReason("");
    await load();
  };

  const recordSale = async () => {
    if (!selectedUnit || !selectedLine || numericPrice <= 0) {
      return setMessage("اختر وحدة مستلمة وسعر بيع صحيحاً.");
    }
    if (outsideRange && !approvedOverride) {
      return setMessage("هذا السعر خارج النطاق المعتمد. أرسل طلب استثناء وانتظر موافقة المسؤول.");
    }
    setSaving(true);
    const result = await recordAgentProductSale({
      sale_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      unit_id: selectedUnit.id,
      actual_sale_price: numericPrice,
      sale_date: new Date().toISOString().slice(0, 10),
      payment_method: paymentMethod,
      customer_name: customerName,
      customer_phone: customerPhone,
      price_override_request_id: approvedOverride?.id,
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setCustomerName("");
    setCustomerPhone("");
    await load();
  };

  const submitReturn = async () => {
    if (!returnWarehouseId || returnIds.size === 0 || returnReason.trim().length < 3) {
      return setMessage("اختر الوحدات والمستودع واكتب سبب المرتجع.");
    }
    setSaving(true);
    const result = await returnAgentProducts({
      return_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      warehouse_id: returnWarehouseId,
      unit_ids: [...returnIds],
      reason: returnReason,
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setReturnIds(new Set());
    setReturnReason("");
    await load();
  };

  const title = mode === "receive"
    ? "استلام عهدة المنتجات"
    : mode === "sell"
      ? "تسجيل بيع منتج"
      : mode === "returns"
        ? "إرجاع منتجات للمخزن"
        : mode === "balance"
          ? "رصيد المنتجات"
          : data ? `عهدة ${data.agent.full_name}` : "عهدة المنتجات";

  return (
    <AgentShell title={title} subtitle="كل وحدة مرتبطة برقمها التسلسلي وسجل حركتها وسعرها المعتمد.">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <ProductNav mode={mode} />
      {loading || !data ? (
        <Card><CardContent className="p-8 text-center text-sm text-slate-500">جاري تحميل عهدة المنتجات...</CardContent></Card>
      ) : mode === "dashboard" ? (
        <Dashboard data={data} />
      ) : mode === "receive" ? (
        <Receive data={data} saving={saving} onAccept={accept} />
      ) : mode === "sell" ? (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>بيانات البيع</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>الوحدة المسلسلة</Label><select className="h-11 w-full rounded-lg border bg-white px-3 text-sm" value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">اختر وحدة</option>{data.units.filter((unit) => unit.status === "with_agent").map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}</select></div>
              {selectedLine && <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4 text-sm"><span>المخطط<br /><strong>{money(selectedLine.planned_sale_price_snapshot, selectedLine.currency)}</strong></span><span>الأدنى<br /><strong>{money(selectedLine.minimum_sale_price, selectedLine.currency)}</strong></span><span>الأعلى<br /><strong>{money(selectedLine.maximum_sale_price, selectedLine.currency)}</strong></span></div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>سعر البيع الفعلي</Label><Input type="number" min="0.01" step="0.01" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} /></div>
                <div className="space-y-2"><Label>طريقة الدفع</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="card">بطاقة</option><option value="electronic">إلكتروني</option><option value="agent_credit">آجل على المندوب</option></select></div>
                <div className="space-y-2"><Label>اسم العميل</Label><Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></div>
                <div className="space-y-2"><Label>هاتف العميل</Label><Input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></div>
              </div>
              {outsideRange && !approvedOverride && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 font-semibold text-amber-800"><ShieldAlert className="h-5 w-5" />السعر يحتاج موافقة المسؤول</div><Input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="سبب التخفيض أو الزيادة" /><Button variant="outline" disabled={saving} onClick={() => void requestOverride()}>إرسال طلب استثناء</Button></div>}
              {approvedOverride && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" />تم اعتماد هذا السعر ويمكن إتمام البيع.</div>}
              <Button className="w-full" disabled={saving || !selectedUnit || (outsideRange && !approvedOverride)} onClick={() => void recordSale()}><ShoppingCart className="ml-2 h-4 w-4" />تأكيد البيع</Button>
            </CardContent>
          </Card>
        </div>
      ) : mode === "returns" ? (
        <Card>
          <CardHeader><CardTitle>الوحدات غير المباعة</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">{data.units.filter((unit) => unit.status === "with_agent").map((unit) => <label key={unit.id} className="flex items-center gap-3 rounded-xl border p-4"><input type="checkbox" checked={returnIds.has(unit.id)} onChange={() => setReturnIds((current) => { const next = new Set(current); if (next.has(unit.id)) next.delete(unit.id); else next.add(unit.id); return next; })} /><span><strong>{unit.product?.name}</strong><br /><span className="font-mono text-xs text-slate-500">{unit.raw_serial_number}</span></span></label>)}</div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>المستودع</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={returnWarehouseId} onChange={(event) => setReturnWarehouseId(event.target.value)}>{data.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</option>)}</select></div><div className="space-y-2"><Label>سبب المرتجع</Label><Input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></div></div>
            <Button disabled={saving || returnIds.size === 0} onClick={() => void submitReturn()}><RotateCcw className="ml-2 h-4 w-4" />إرجاع {returnIds.size} وحدة</Button>
          </CardContent>
        </Card>
      ) : (
        <Balance data={data} />
      )}
    </AgentShell>
  );
}

function Dashboard({ data }: { data: ProductAgentDashboardData }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["وحدات في العهدة", data.totals.custody_units], ["قيمة العهدة", money(data.totals.custody_retail)], ["مبيعات نشطة", money(data.totals.active_sales)], ["المتبقي عليك", money(data.totals.outstanding)]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></CardContent></Card>)}
      </div>
      {data.pending_handovers.length > 0 && <Card className="border-amber-200 bg-amber-50"><CardContent className="flex items-center justify-between p-5"><div><p className="font-semibold text-amber-900">لديك {data.pending_handovers.length} تسليم ينتظر التأكيد</p><p className="text-sm text-amber-700">راجع الأرقام التسلسلية قبل الاستلام.</p></div><Button asChild><Link href="/agent/products/receive">مراجعة الآن</Link></Button></CardContent></Card>}
      <Card><CardHeader><CardTitle>الوحدات الحالية</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>المسلسل</TableHead><TableHead>السعر</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>{data.units.map((unit) => <TableRow key={unit.id}><TableCell>{unit.product?.name || "-"}</TableCell><TableCell className="font-mono">{unit.raw_serial_number}</TableCell><TableCell>{money(unit.planned_sale_price_snapshot, unit.currency)}</TableCell><TableCell><Badge variant="outline">{unit.status === "with_agent" ? "جاهز للبيع" : "بانتظار الاستلام"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    </div>
  );
}

function Receive({ data, saving, onAccept }: { data: ProductAgentDashboardData; saving: boolean; onAccept: (id: string, version: number) => void }) {
  return <div className="space-y-4">{data.pending_handovers.map((handover) => <Card key={handover.id}><CardHeader><div className="flex items-center justify-between"><CardTitle className="font-mono">{handover.handover_no}</CardTitle><Badge>{handover.lines?.length || 0} وحدة</Badge></div></CardHeader><CardContent className="space-y-4"><div className="space-y-2">{handover.lines?.map((line: ProductHandoverLine) => <div key={line.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{line.unit?.product?.name || "منتج"}<br /><span className="font-mono text-xs text-slate-500">{line.unit?.raw_serial_number}</span></span><span>{money(line.planned_sale_price_snapshot, line.currency)}</span></div>)}</div><Button disabled={saving} className="w-full" onClick={() => onAccept(handover.id, handover.version)}><CheckCircle2 className="ml-2 h-4 w-4" />أؤكد استلام الوحدات المطابقة</Button></CardContent></Card>)}{data.pending_handovers.length === 0 && <Card><CardContent className="p-8 text-center text-slate-500">لا توجد تسليمات تنتظر تأكيدك.</CardContent></Card>}</div>;
}

function Balance({ data }: { data: ProductAgentDashboardData }) {
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-slate-500">مبيعات نشطة</p><p className="mt-2 text-2xl font-bold">{money(data.totals.active_sales)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-slate-500">تم تحصيله</p><p className="mt-2 text-2xl font-bold text-emerald-700">{money(data.totals.collected)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-slate-500">المتبقي</p><p className="mt-2 text-2xl font-bold text-amber-700">{money(data.totals.outstanding)}</p></CardContent></Card></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" />مبيعات المنتجات</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>المنتج</TableHead><TableHead>القيمة</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>{data.sales.map((sale) => <TableRow key={sale.id}><TableCell className="font-mono">{sale.sale_no}</TableCell><TableCell>{sale.lines?.[0]?.product_name_snapshot || "-"}</TableCell><TableCell>{money(sale.total_amount)}</TableCell><TableCell><Badge variant="outline">{sale.status === "active" ? "نشط" : "ملغي"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card><CardHeader><CardTitle>التحصيلات المسجلة</CardTitle></CardHeader><CardContent className="space-y-2">{data.collections.map((collection) => <div key={collection.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span className="font-mono">{collection.collection_no}</span><span>{collection.collection_date}</span><strong>{money(collection.amount)}</strong></div>)}{data.collections.length === 0 && <p className="text-sm text-slate-500">لا توجد تحصيلات بعد.</p>}</CardContent></Card></div>;
}
