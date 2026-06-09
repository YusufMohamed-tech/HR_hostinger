"use client";

import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { ProductCard } from "@/components/sales/ProductCard";
import { DailyLogSummary } from "@/components/sales/DailyLogSummary";
import { SalesReportTable } from "@/components/sales/SalesReportTable";
import { getTodaySalesLog, submitSalesLog, type SalesCompany, type SalesLog, type SalesLogItem, type SalesProduct } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";
import { cn } from "@/lib/utils";

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
  const [companies, setCompanies] = useState<SalesCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [todayLogs, setTodayLogs] = useState<SalesLog[]>([]);
  const [yesterdayItems, setYesterdayItems] = useState<SalesLogItem[]>([]);
  const [state, setState] = useState<ProductState>({});
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");

  const load = async (companyId?: string) => {
    setLoading(true);
    const result = await getTodaySalesLog(companyId);
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر تحميل بيانات المبيعات.");
      setLoading(false);
      return;
    }

    setCompanies(result.data.companies);
    setSelectedCompanyId(result.data.selectedCompanyId);
    setProducts(result.data.products);
    setTodayLogs(result.data.todayLogs || []);
    setYesterdayItems(result.data.yesterdayItems || []);
    setState({});
    setNotes("");
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );

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

  const handleCompanyChange = (companyId: string) => {
    if (companyId === selectedCompanyId) return;
    load(companyId);
  };

  const handleSubmit = async () => {
    if (!selectedCompanyId) {
      setMessage("اختر شركة المبيعات أولاً.");
      return;
    }
    if (selectedItems.length === 0) {
      setMessage("اختر منتجاً واحداً على الأقل قبل إرسال التقرير.");
      return;
    }
    setSubmitting(true);
    const result = await submitSalesLog({ company_id: selectedCompanyId, items: selectedItems, notes });
    setSubmitting(false);
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر إرسال تقرير اليوم.");
      return;
    }
    setMessage("تم إرسال تقرير المبيعات بنجاح.");
    load(selectedCompanyId);
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">تسجيل مبيعات اليوم</h1>
          <p className="mt-2 text-gray-500">اختر الشركة ثم سجل المنتجات المباعة. يمكنك إرسال أكثر من تقرير في نفس اليوم.</p>
        </div>
        {yesterdayItems.length > 0 && (
          <Button variant="outline" onClick={applyYesterday}>
            <RotateCcw className="ml-2 h-4 w-4" />
            نفس آخر تسجيل بالأمس
          </Button>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {companies.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => handleCompanyChange(company.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition",
                  selectedCompanyId === company.id ? "border-brand bg-brand text-white shadow-sm" : "border-gray-200 bg-white text-gray-700 hover:border-brand/50"
                )}
              >
                {company.brand_color && <span className="h-3 w-3 rounded-full border border-white/60" style={{ backgroundColor: company.brand_color }} />}
                {company.name}
                {company.assignment_role === "manager" && (
                  <Badge variant="outline" className="border-white/40 bg-white/20 text-current">مدير</Badge>
                )}
              </button>
            ))}
          </div>
          {!selectedCompany && <p className="text-sm text-gray-500">لا توجد شركات مسندة لحسابك حالياً.</p>}
        </CardContent>
      </Card>

      {selectedCompany && (
        <>
          <DailyLogSummary totalItems={totalItems} subtotal={subtotal} discount={totalDiscount} total={grandTotal} />

          {products.length === 0 ? (
            <Card className="border-none shadow-sm">
              <CardContent className="py-12 text-center text-gray-500">
                لا توجد منتجات متاحة لهذه الشركة. تواصل مع مدير مبيعات الشركة لإضافة المنتجات.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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
                placeholder="رسالة أو ملاحظة اختيارية عن مبيعات هذا التسجيل"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-24 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <Button className="w-full bg-brand text-white hover:bg-brand-dark sm:w-auto" disabled={submitting || selectedItems.length === 0} onClick={handleSubmit}>
                <Send className="ml-2 h-4 w-4" />
                {submitting ? "جاري الإرسال..." : "إرسال تسجيل مبيعات"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              <div className="border-b border-gray-100 p-5">
                <h2 className="text-xl font-bold text-gray-950">تسجيلات اليوم</h2>
                <p className="mt-1 text-sm text-gray-500">كل التسجيلات المرسلة اليوم لنفس الشركة.</p>
              </div>
              {todayLogs.length > 0 ? (
                <SalesReportTable logs={todayLogs} expanded />
              ) : (
                <div className="py-10 text-center text-sm text-gray-500">لم يتم إرسال أي تسجيل لهذه الشركة اليوم.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
