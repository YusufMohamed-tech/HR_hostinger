"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Send, RotateCcw, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { ProductCard } from "@/components/sales/ProductCard";
import { DailyLogSummary } from "@/components/sales/DailyLogSummary";
import { getTodaySalesLog, submitSalesLog, type SalesLog, type SalesLogItem, type SalesProduct } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { PageSkeleton } from "@/components/Skeletons";

type ProductState = Record<string, { quantity: number; discount: number }>;

function calculateItems(products: SalesProduct[], state: ProductState): SalesLogItem[] {
  return products
    .map((product) => {
      const entry = state[product.id] || { quantity: 0, discount: 0 };
      const quantity = Math.max(0, Math.floor(entry.quantity || 0));
      if (!quantity) return null;
      const discountPercent = Math.max(0, Math.min(100, Number(entry.discount || 0)));
      const gross = quantity * Number(product.price || 0);
      const discountAmount = Number((gross * discountPercent / 100).toFixed(2));
      return {
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: Number(product.price || 0),
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        line_total: Number((gross - discountAmount).toFixed(2)),
      };
    })
    .filter(Boolean) as SalesLogItem[];
}

export default function SalesLogPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [todayLog, setTodayLog] = useState<SalesLog | null>(null);
  const [yesterdayItems, setYesterdayItems] = useState<SalesLogItem[]>([]);
  const [state, setState] = useState<ProductState>({});
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const result = await getTodaySalesLog();
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر تحميل بيانات المبيعات.");
      setLoading(false);
      return;
    }
    setProducts(result.data.products);
    setTodayLog(result.data.todayLog);
    setYesterdayItems(result.data.yesterdayItems || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const yesterdayByProduct = useMemo(() => {
    const map: Record<string, SalesLogItem> = {};
    yesterdayItems.forEach((item) => {
      map[item.product_id] = item;
    });
    return map;
  }, [yesterdayItems]);

  const selectedItems = useMemo(() => calculateItems(products, state), [products, state]);
  const subtotal = selectedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const totalDiscount = selectedItems.reduce((sum, item) => sum + item.discount_amount, 0);
  const grandTotal = selectedItems.reduce((sum, item) => sum + item.line_total, 0);
  const totalItems = selectedItems.reduce((sum, item) => sum + item.quantity, 0);

  const setProductState = (productId: string, next: Partial<{ quantity: number; discount: number }>) => {
    setState((prev) => ({
      ...prev,
      [productId]: {
        quantity: prev[productId]?.quantity || 0,
        discount: prev[productId]?.discount || 0,
        ...next,
      },
    }));
  };

  const applyYesterday = () => {
    const next: ProductState = {};
    yesterdayItems.forEach((item) => {
      next[item.product_id] = {
        quantity: Number(item.quantity || 0),
        discount: Number(item.discount_percent || 0),
      };
    });
    setState(next);
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      setMessage("اختر منتجًا واحدًا على الأقل قبل إرسال التقرير.");
      return;
    }
    setSubmitting(true);
    const result = await submitSalesLog({ items: selectedItems, notes });
    setSubmitting(false);
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر إرسال تقرير اليوم.");
      return;
    }
    setTodayLog(result.data);
    setMessage("تم إرسال تقرير مبيعات اليوم بنجاح.");
  };

  if (loading) return <PageSkeleton />;

  const lockedItems = todayLog?.items || [];

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">تسجيل مبيعات اليوم</h1>
          <p className="mt-2 text-gray-500">اختيار سريع للمنتجات والكميات والخصومات اليومية.</p>
        </div>
        {!todayLog && yesterdayItems.length > 0 && (
          <Button variant="outline" onClick={applyYesterday}>
            <RotateCcw className="ml-2 h-4 w-4" />
            نفس أمس
          </Button>
        )}
      </div>

      {todayLog ? (
        <Card className="border-none shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center gap-3 rounded-lg bg-brand-light p-4 text-brand-dark">
              <Lock className="h-5 w-5" />
              <div>
                <p className="font-semibold">تم إرسال تقرير اليوم بالفعل</p>
                <p className="text-sm">لا يمكن تعديل تقرير اليوم بعد الإرسال.</p>
              </div>
            </div>
            <DailyLogSummary
              totalItems={lockedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}
              subtotal={Number(todayLog.subtotal || 0)}
              discount={Number(todayLog.total_discount || 0)}
              total={Number(todayLog.grand_total || 0)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              {lockedItems.map((item, index) => (
                <div key={`${item.product_id}-${index}`} className="rounded-lg border border-gray-100 bg-white p-4">
                  <p className="font-semibold text-gray-950">{item.product_name}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    الكمية {item.quantity} × {formatCurrency(item.unit_price)}
                  </p>
                  <p className="mt-2 font-semibold text-brand-dark">
                    {formatCurrency(item.line_total)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <DailyLogSummary totalItems={totalItems} subtotal={subtotal} discount={totalDiscount} total={grandTotal} />

          {products.length === 0 ? (
            <Card className="border-none shadow-sm">
              <CardContent className="py-12 text-center text-gray-500">
                لا توجد منتجات متاحة. يرجى التواصل مع مدير المبيعات.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={state[product.id]?.quantity || 0}
                  discountPercent={state[product.id]?.discount || 0}
                  yesterdayQuantity={Number(yesterdayByProduct[product.id]?.quantity || 0)}
                  onQuantityChange={(quantity) => setProductState(product.id, { quantity })}
                  onDiscountChange={(discount) => setProductState(product.id, { discount })}
                />
              ))}
            </div>
          )}

          <Card className="border-none shadow-sm">
            <CardContent className="space-y-4 p-5">
              <textarea
                placeholder="ملاحظات اختيارية عن مبيعات اليوم"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-24 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <Button className="w-full bg-brand text-white hover:bg-brand-dark sm:w-auto" disabled={submitting || selectedItems.length === 0} onClick={handleSubmit}>
                <Send className="ml-2 h-4 w-4" />
                {submitting ? "جاري الإرسال..." : "إرسال تقرير اليوم"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
