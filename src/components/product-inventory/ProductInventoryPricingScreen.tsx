"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, History } from "lucide-react";
import { PageSkeleton } from "@/components/Skeletons";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getProductInventoryCommercialTerms,
  updateProductInventoryCommercialTerms,
} from "@/lib/services/product-inventory";
import type { ProductInventoryCommercialTermInput, ProductReceiptLine } from "@/types/product-inventory";

type PricingLine = ProductReceiptLine & {
  sale_price: string;
  minimum_price: string;
  maximum_price: string;
  commission_value_input: string;
};

export function ProductInventoryPricingScreen({ receiptId }: { receiptId: string }) {
  const [receipt, setReceipt] = useState<{ receipt_no: string; status: string; version: number } | null>(null);
  const [lines, setLines] = useState<PricingLine[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await getProductInventoryCommercialTerms(receiptId);
    if (result.data) {
      setReceipt(result.data.receipt);
      setLines(result.data.lines.map((line) => ({
        ...line,
        sale_price: String(line.planned_unit_sale_price),
        minimum_price: String(line.minimum_sale_price),
        maximum_price: String(line.maximum_sale_price),
        commission_value_input: String(line.commission_value),
      })));
      setHistoryCount(result.data.history.length);
    }
    setMessage(result.error || "");
    setLoading(false);
  }, [receiptId]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => lines.reduce((value, line) => {
    const price = Number(line.sale_price || 0);
    const commission = line.commission_type === "flat"
      ? Number(line.commission_value_input || 0)
      : line.commission_type === "percentage"
        ? price * Number(line.commission_value_input || 0) / 100
        : 0;
    value.units += line.expected_quantity;
    value.sales += price * line.expected_quantity;
    value.commission += commission * line.expected_quantity;
    value.margin += (price - line.unit_cost - commission) * line.expected_quantity;
    return value;
  }, { units: 0, sales: 0, commission: 0, margin: 0 }), [lines]);

  const updateLine = (lineId: string, changes: Partial<PricingLine>) => {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...changes } : line));
  };

  const save = async () => {
    if (!receipt) return;
    const terms: ProductInventoryCommercialTermInput[] = lines.map((line) => ({
      receipt_line_id: line.id,
      sale_price: Number(line.sale_price),
      minimum_sale_price: Number(line.minimum_price),
      maximum_sale_price: Number(line.maximum_price),
      currency: line.currency,
      commission_type: line.commission_type,
      commission_value: Number(line.commission_value_input || 0),
      commission_base: line.commission_base,
      source: "finance",
      reason: "Finance pricing screen approval",
    }));
    if (terms.some((term) => !term.sale_price || !term.minimum_sale_price || !term.maximum_sale_price
      || term.minimum_sale_price > term.sale_price || term.sale_price > term.maximum_sale_price
      || term.commission_value < 0 || (term.commission_type === "none" && term.commission_value !== 0)
      || (term.commission_type === "percentage" && term.commission_value > 100))) {
      setMessage("راجع نطاق السعر وقاعدة العمولة لكل مجموعة.");
      return;
    }
    setSaving(true);
    const result = await updateProductInventoryCommercialTerms(receiptId, receipt.version, terms);
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setMessage("تم اعتماد إصدار جديد من التسعير والعمولة.");
    await load();
  };

  if (loading) return <PageSkeleton />;
  if (!receipt) return <p>سند الاستلام غير موجود.</p>;
  const editable = ["draft", "needs_review", "ready_to_confirm"].includes(receipt.status);
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold">التسعير والعمولة</h1><p className="mt-2 text-gray-500">{receipt.receipt_no} · كل حفظ ينشئ إصدارًا تاريخيًا غير قابل لإعادة كتابة المبيعات السابقة.</p></div>
        <div className="flex gap-2"><Button asChild variant="outline"><Link href={`/sales/inventory/receipts/${receiptId}`}>العودة للسند</Link></Button>{editable && <Button disabled={saving} onClick={() => void save()}><BadgeDollarSign className="ml-2 h-4 w-4" />{saving ? "جاري الاعتماد..." : "اعتماد إصدار جديد"}</Button>}</div>
      </div>
      <Card className="border-blue-100 bg-blue-50/50"><CardContent className="grid gap-4 p-5 sm:grid-cols-4"><div><p className="text-xs text-gray-500">الوحدات</p><p className="font-bold">{totals.units}</p></div><div><p className="text-xs text-gray-500">البيع المتوقع</p><p className="font-bold">{totals.sales.toFixed(2)} SAR</p></div><div><p className="text-xs text-gray-500">العمولة المتوقعة</p><p className="font-bold">{totals.commission.toFixed(2)} SAR</p></div><div><p className="text-xs text-gray-500">الهامش بعد العمولة</p><p className="font-bold">{totals.margin.toFixed(2)} SAR</p></div></CardContent></Card>
      <div className="space-y-4">{lines.map((line) => <Card key={line.id}><CardHeader><CardTitle className="flex items-center justify-between text-base"><span>{line.product_name_snapshot} · {line.expected_quantity} وحدة</span><span className="flex items-center gap-1 text-xs font-normal text-gray-500"><History className="h-3.5 w-3.5" />الإصدار {line.commercial_terms_revision}</span></CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"><div><Label>سعر البيع</Label><Input disabled={!editable} type="number" min="0.01" step="0.01" value={line.sale_price} onChange={(event) => updateLine(line.id, { sale_price: event.target.value })} /></div><div><Label>أقل سعر</Label><Input disabled={!editable} type="number" min="0.01" step="0.01" value={line.minimum_price} onChange={(event) => updateLine(line.id, { minimum_price: event.target.value })} /></div><div><Label>أعلى سعر</Label><Input disabled={!editable} type="number" min="0.01" step="0.01" value={line.maximum_price} onChange={(event) => updateLine(line.id, { maximum_price: event.target.value })} /></div><div><Label>نوع العمولة</Label><select disabled={!editable} className="h-10 w-full rounded-lg border bg-white px-3" value={line.commission_type} onChange={(event) => updateLine(line.id, { commission_type: event.target.value as PricingLine["commission_type"], commission_value_input: event.target.value === "none" ? "0" : line.commission_value_input })}><option value="none">بدون</option><option value="flat">مبلغ ثابت</option><option value="percentage">نسبة</option></select></div><div><Label>قيمة العمولة</Label><Input disabled={!editable || line.commission_type === "none"} type="number" min="0" step="0.01" value={line.commission_value_input} onChange={(event) => updateLine(line.id, { commission_value_input: event.target.value })} /></div><div><Label>أساس العمولة</Label><select disabled={!editable} className="h-10 w-full rounded-lg border bg-white px-3" value={line.commission_base} onChange={(event) => updateLine(line.id, { commission_base: event.target.value as PricingLine["commission_base"] })}><option value="net_amount">صافي البيع</option><option value="gross_amount">إجمالي البيع</option></select></div></CardContent></Card>)}</div>
      <p className="text-sm text-gray-500">سجل التدقيق الحالي يحتوي {historyCount} إصدارًا عبر مجموعات السند.</p>
    </div>
  );
}
