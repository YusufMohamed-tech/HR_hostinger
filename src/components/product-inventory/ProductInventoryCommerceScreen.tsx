"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Coins,
  PackageCheck,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { PageSkeleton } from "@/components/Skeletons";
import {
  createProductHandover,
  getProductCommerceManager,
  getProductInventoryMovements,
  newInventoryCommandId,
  recordAgentProductCollection,
  reviewProductPriceOverride,
  voidAgentProductSale,
} from "@/lib/services/product-inventory";
import type {
  AgentProductSale,
  ProductCommerceManagerData,
  ProductInventoryStockRow,
  ProductPriceOverrideRequest,
} from "@/types/product-inventory";

function money(value: unknown, currency = "SAR") {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency }).format(Number(value || 0));
}

const statusLabels: Record<string, string> = {
  issued: "بانتظار استلام المندوب",
  accepted: "في عهدة المندوب",
  completed: "مكتمل",
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  used: "مستخدم",
  active: "نشط",
  voided: "ملغي",
};

function StatusBadge({ value }: { value: string }) {
  const good = ["accepted", "approved", "active", "completed"].includes(value);
  const bad = ["rejected", "voided"].includes(value);
  return (
    <Badge
      variant="outline"
      className={good
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : bad
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-amber-200 bg-amber-50 text-amber-700"}
    >
      {statusLabels[value] || value}
    </Badge>
  );
}

type StockGroup = {
  key: string;
  productName: string;
  sku: string;
  plannedPrice: number;
  unitCost: number;
  currency: string;
  units: ProductInventoryStockRow[];
};

function groupStock(units: ProductInventoryStockRow[]) {
  const grouped = new Map<string, StockGroup>();
  for (const unit of units) {
    const key = [
      unit.product_id,
      unit.unit_cost_snapshot,
      unit.planned_sale_price_snapshot,
      unit.currency,
      unit.condition,
    ].join(":");
    const existing = grouped.get(key);
    if (existing) {
      existing.units.push(unit);
      continue;
    }
    grouped.set(key, {
      key,
      productName: unit.product?.name || "منتج غير مسمى",
      sku: unit.product?.sku || "",
      plannedPrice: Number(unit.planned_sale_price_snapshot),
      unitCost: Number(unit.unit_cost_snapshot),
      currency: unit.currency,
      units: [unit],
    });
  }
  return [...grouped.values()];
}

export function ProductInventoryCommerceManagerScreen() {
  const [data, setData] = useState<ProductCommerceManagerData | null>(null);
  const [movements, setMovements] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [agentId, setAgentId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [requireAcknowledgment, setRequireAcknowledgment] = useState(true);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ranges, setRanges] = useState<Record<string, { minimum: string; maximum: string }>>({});
  const [collectionAgentId, setCollectionAgentId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionReference, setCollectionReference] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [commerce, movementResult] = await Promise.all([
      getProductCommerceManager(),
      getProductInventoryMovements(),
    ]);
    if (commerce.data) {
      setData(commerce.data);
      setAgentId((value) => value || commerce.data?.agents[0]?.id || "");
      setWarehouseId((value) => value || commerce.data?.warehouses[0]?.id || "");
      setCollectionAgentId((value) => value || commerce.data?.agents[0]?.id || "");
      setRequireAcknowledgment(commerce.data.settings.require_agent_acknowledgment);
    }
    if (movementResult.data) setMovements(movementResult.data);
    setMessage(commerce.error || movementResult.error || "");
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupStock(data?.available_units || []), [data?.available_units]);
  useEffect(() => {
    if (!data) return;
    const tolerance = data.settings.default_price_tolerance_percent / 100;
    setRanges((current) => {
      const next = { ...current };
      for (const group of groups) {
        next[group.key] ||= {
          minimum: (group.plannedPrice * (1 - tolerance)).toFixed(2),
          maximum: (group.plannedPrice * (1 + tolerance)).toFixed(2),
        };
      }
      return next;
    });
  }, [data, groups]);

  const toggleGroup = (group: StockGroup) => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = group.units.every((unit) => next.has(unit.id));
      group.units.forEach((unit) => allSelected ? next.delete(unit.id) : next.add(unit.id));
      return next;
    });
  };

  const submitHandover = async () => {
    if (!data || !agentId || !warehouseId || selected.size === 0) {
      return setMessage("اختر المندوب والمستودع ومجموعة منتجات واحدة على الأقل.");
    }
    if (selected.size > data.settings.max_handover_units) {
      return setMessage(`الحد الأقصى للتسليم الواحد هو ${data.settings.max_handover_units} وحدة.`);
    }
    setSaving(true);
    const units = groups.flatMap((group) => group.units
      .filter((unit) => selected.has(unit.id))
      .map((unit) => ({
        unit_id: unit.id,
        minimum_sale_price: Number(ranges[group.key]?.minimum || 0),
        maximum_sale_price: Number(ranges[group.key]?.maximum || 0),
      })));
    const result = await createProductHandover({
      handover_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      warehouse_id: warehouseId,
      agent_id: agentId,
      require_acknowledgment: requireAcknowledgment,
      notes,
      units,
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setSelected(new Set());
    setNotes("");
    await load();
  };

  const reviewOverride = async (request: ProductPriceOverrideRequest, decision: "approved" | "rejected") => {
    setSaving(true);
    const result = await reviewProductPriceOverride(request.id, {
      command_id: newInventoryCommandId(),
      expected_version: request.version,
      decision,
      review_note: decision === "approved" ? "تمت الموافقة من مسؤول المخزون." : "تم رفض السعر المطلوب.",
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    await load();
  };

  const voidSale = async (sale: AgentProductSale) => {
    const reason = window.prompt("اكتب سبب إلغاء البيع (5 أحرف على الأقل):");
    if (!reason) return;
    const damaged = window.confirm("هل المنتج تالف؟ اضغط «إلغاء» لإعادته إلى مخزون صالح للبيع.");
    setSaving(true);
    const result = await voidAgentProductSale(sale.id, {
      command_id: newInventoryCommandId(),
      expected_version: sale.version,
      reason,
      return_disposition: damaged ? "damaged" : "sellable",
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    await load();
  };

  const submitCollection = async () => {
    if (!collectionAgentId || Number(collectionAmount) <= 0) {
      return setMessage("اختر المندوب وأدخل مبلغ تحصيل صحيحاً.");
    }
    setSaving(true);
    const result = await recordAgentProductCollection({
      collection_id: crypto.randomUUID(),
      command_id: newInventoryCommandId(),
      agent_id: collectionAgentId,
      amount: Number(collectionAmount),
      payment_method: "cash",
      reference: collectionReference,
      collection_date: new Date().toISOString().slice(0, 10),
    });
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setCollectionAmount("");
    setCollectionReference("");
    await load();
  };

  if (loading || !data) return <PageSkeleton />;
  const pendingOverrides = data.price_overrides.filter((request) => request.status === "pending");
  const activeSales = data.sales.filter((sale) => sale.status === "active");

  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">تسليم وبيع منتجات المندوبين</h1>
          <p className="mt-2 text-gray-500">عهدة مسلسلة من المخزن إلى المندوب، مع حدود سعر وتحكم كامل في البيع والتحصيل.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/sales/inventory"><ArrowRight className="ml-2 h-4 w-4" />المخزون</Link></Button>
          <Button variant="outline" onClick={() => void load()}><RefreshCcw className="ml-2 h-4 w-4" />تحديث</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-none shadow-sm"><CardContent className="p-5"><p className="text-sm text-gray-500">متاح للتسليم</p><p className="mt-2 text-3xl font-bold">{data.available_units.length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="p-5"><p className="text-sm text-gray-500">عهد نشطة</p><p className="mt-2 text-3xl font-bold">{data.handovers.filter((handover) => ["issued", "accepted"].includes(handover.status)).length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="p-5"><p className="text-sm text-gray-500">طلبات سعر معلقة</p><p className="mt-2 text-3xl font-bold text-amber-600">{pendingOverrides.length}</p></CardContent></Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-brand" />إنشاء تسليم جديد</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2"><Label>المندوب</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></div>
            <div className="space-y-2"><Label>المستودع</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{data.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</option>)}</select></div>
            <div className="space-y-2 md:col-span-2"><Label>ملاحظات التسليم</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="رقم إذن أو تعليمات للمندوب" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={requireAcknowledgment} onChange={(event) => setRequireAcknowledgment(event.target.checked)} />
            يجب على المندوب تأكيد الاستلام قبل البيع
          </label>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>اختيار</TableHead><TableHead>مجموعة المنتج</TableHead><TableHead>العدد</TableHead><TableHead>التكلفة</TableHead><TableHead>السعر المخطط</TableHead><TableHead>أقل سعر</TableHead><TableHead>أعلى سعر</TableHead></TableRow></TableHeader>
              <TableBody>{groups.map((group) => {
                const allSelected = group.units.every((unit) => selected.has(unit.id));
                return (
                  <TableRow key={group.key}>
                    <TableCell><input type="checkbox" checked={allSelected} onChange={() => toggleGroup(group)} /></TableCell>
                    <TableCell><p className="font-medium">{group.productName}</p><p className="text-xs text-gray-400">{group.sku || "بدون SKU"}</p></TableCell>
                    <TableCell>{group.units.length}</TableCell>
                    <TableCell>{money(group.unitCost, group.currency)}</TableCell>
                    <TableCell>{money(group.plannedPrice, group.currency)}</TableCell>
                    <TableCell><Input type="number" min="0.01" step="0.01" className="w-28" value={ranges[group.key]?.minimum || ""} onChange={(event) => setRanges((current) => ({ ...current, [group.key]: { minimum: event.target.value, maximum: current[group.key]?.maximum || "" } }))} /></TableCell>
                    <TableCell><Input type="number" min="0.01" step="0.01" className="w-28" value={ranges[group.key]?.maximum || ""} onChange={(event) => setRanges((current) => ({ ...current, [group.key]: { minimum: current[group.key]?.minimum || "", maximum: event.target.value } }))} /></TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          </div>
          {groups.length === 0 && <p className="rounded-lg bg-gray-50 p-5 text-center text-sm text-gray-500">لا توجد وحدات مؤكدة ومتاحة في المخزن.</p>}
          <div className="flex items-center justify-between"><p className="text-sm text-gray-500">تم اختيار {selected.size} وحدة.</p><Button disabled={saving || selected.size === 0} onClick={() => void submitHandover()} className="bg-brand text-white hover:bg-brand-dark"><Send className="ml-2 h-4 w-4" />إصدار التسليم</Button></div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-amber-600" />استثناءات السعر المعلقة</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table><TableHeader><TableRow><TableHead>المندوب</TableHead><TableHead>المنتج / المسلسل</TableHead><TableHead>السعر المخطط</TableHead><TableHead>السعر المطلوب</TableHead><TableHead>السبب</TableHead><TableHead>القرار</TableHead></TableRow></TableHeader>
            <TableBody>{pendingOverrides.map((request) => <TableRow key={request.id}><TableCell>{request.agent?.full_name || "-"}</TableCell><TableCell>{request.unit?.product?.name || "-"}<p className="font-mono text-xs">{request.unit?.raw_serial_number}</p></TableCell><TableCell>{money(request.unit?.planned_sale_price_snapshot, request.currency)}</TableCell><TableCell className="font-bold text-amber-700">{money(request.requested_price, request.currency)}</TableCell><TableCell>{request.reason}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" disabled={saving} onClick={() => void reviewOverride(request, "approved")}><Check className="ml-1 h-4 w-4" />موافقة</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => void reviewOverride(request, "rejected")}><X className="ml-1 h-4 w-4" />رفض</Button></div></TableCell></TableRow>)}</TableBody>
          </Table>
          {pendingOverrides.length === 0 && <p className="p-6 text-center text-sm text-gray-500">لا توجد طلبات سعر معلقة.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand" />عهد التسليم</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.handovers.slice(0, 12).map((handover) => <div key={handover.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-mono font-semibold">{handover.handover_no}</p><p className="text-sm text-gray-500">{handover.agent?.full_name} · {handover.lines?.length || 0} وحدة</p></div><StatusBadge value={handover.status} /></div>)}
            {data.handovers.length === 0 && <p className="text-sm text-gray-500">لم يصدر أي تسليم بعد.</p>}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-emerald-600" />تحصيل أرصدة المندوبين</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2"><Label>المندوب</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={collectionAgentId} onChange={(event) => setCollectionAgentId(event.target.value)}>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></div>
              <div className="space-y-2"><Label>المبلغ</Label><Input type="number" min="0.01" step="0.01" value={collectionAmount} onChange={(event) => setCollectionAmount(event.target.value)} /></div>
              <div className="space-y-2"><Label>المرجع</Label><Input value={collectionReference} onChange={(event) => setCollectionReference(event.target.value)} /></div>
            </div>
            <Button disabled={saving} onClick={() => void submitCollection()}><Coins className="ml-2 h-4 w-4" />تسجيل التحصيل</Button>
            <div className="space-y-2 border-t pt-4">{data.balances.map((balance) => <div key={balance.agent_id} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-4"><span className="font-medium">{balance.agent_name}</span><span>مبيعات {money(balance.active_sales)}</span><span>محصل {money(balance.collected)}</span><span className={balance.outstanding > 0 ? "font-bold text-amber-700" : "text-emerald-700"}>متبقي {money(balance.outstanding)}</span></div>)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-red-600" />المبيعات النشطة وإلغاء البيع</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table><TableHeader><TableRow><TableHead>رقم البيع</TableHead><TableHead>المندوب</TableHead><TableHead>المنتج</TableHead><TableHead>السعر</TableHead><TableHead>العميل</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{activeSales.slice(0, 50).map((sale) => <TableRow key={sale.id}><TableCell className="font-mono">{sale.sale_no}</TableCell><TableCell>{sale.agent?.full_name || "-"}</TableCell><TableCell>{sale.lines?.[0]?.product_name_snapshot || "-"}</TableCell><TableCell>{money(sale.total_amount)}</TableCell><TableCell>{sale.customer_name || "-"}</TableCell><TableCell><Button size="sm" variant="outline" disabled={saving} className="text-red-700" onClick={() => void voidSale(sale)}>إلغاء / مرتجع</Button></TableCell></TableRow>)}</TableBody>
          </Table>
          {activeSales.length === 0 && <p className="p-6 text-center text-sm text-gray-500">لا توجد مبيعات منتجات نشطة.</p>}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-brand" />سجل حركة الوحدة</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table><TableHeader><TableRow><TableHead>التوقيت</TableHead><TableHead>الحركة</TableHead><TableHead>المنتج</TableHead><TableHead>المسلسل</TableHead><TableHead>من / إلى</TableHead></TableRow></TableHeader>
            <TableBody>{movements.slice(0, 50).map((movement) => {
              const unit = movement.unit as { raw_serial_number?: string; product?: { name?: string } } | null;
              const fromAgent = movement.from_agent as { full_name?: string } | null;
              const toAgent = movement.to_agent as { full_name?: string } | null;
              const fromWarehouse = movement.from_warehouse as { name_ar?: string } | null;
              const toWarehouse = movement.to_warehouse as { name_ar?: string } | null;
              return <TableRow key={String(movement.id)}><TableCell>{new Date(String(movement.movement_at)).toLocaleString("ar-EG")}</TableCell><TableCell>{String(movement.movement_type)}</TableCell><TableCell>{unit?.product?.name || "-"}</TableCell><TableCell className="font-mono">{unit?.raw_serial_number || "-"}</TableCell><TableCell>{fromAgent?.full_name || fromWarehouse?.name_ar || "المورد"} ← {toAgent?.full_name || toWarehouse?.name_ar || "العميل"}</TableCell></TableRow>;
            })}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
