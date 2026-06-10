"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Edit3, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductCard } from "@/components/sales/ProductCard";
import { DailyLogSummary } from "@/components/sales/DailyLogSummary";
import { SalesReportTable } from "@/components/sales/SalesReportTable";
import { getTodaySalesLog, requestSalesLogEdit, submitSalesLog, type SalesCompany, type SalesLog, type SalesLogItem, type SalesProduct } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";
import { cn } from "@/lib/utils";

type ProductState = Record<string, { quantity: number; discount: number }>;

function productGroupLabel(product: SalesProduct) {
  const text = `${product.category || ""} ${product.name || ""}`.toLowerCase();
  if (text.includes("مكالم") || text.includes("دقائق") || text.includes("voice")) return "باقات الفويس";
  if (text.includes("إنترنت") || text.includes("انترنت") || text.includes("internet") || text.includes("بيانات") || text.includes("gb")) return "باقات الإنترنت";
  return "خدمات أخرى";
}

const productGroupOrder = ["باقات الفويس", "باقات الإنترنت", "خدمات أخرى"];

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
  const [messageTone, setMessageTone] = useState<"info" | "success">("info");
  const [editRequestLog, setEditRequestLog] = useState<SalesLog | null>(null);
  const [editRequestText, setEditRequestText] = useState("");
  const [requestingEdit, setRequestingEdit] = useState(false);

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

  const productGroups = useMemo(() => {
    const groups = new Map<string, SalesProduct[]>();
    products.forEach((product) => {
      const category = productGroupLabel(product);
      groups.set(category, [...(groups.get(category) || []), product]);
    });
    return Array.from(groups.entries())
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => productGroupOrder.indexOf(a.category) - productGroupOrder.indexOf(b.category));
  }, [products]);

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

  const showMessage = (text: string, tone: "info" | "success" = "info") => {
    setMessageTone(tone);
    setMessage(text);
  };

  const handleSubmit = async () => {
    if (!selectedCompanyId) {
      showMessage("اختر شركة المبيعات أولاً.");
      return;
    }
    if (selectedItems.length === 0) {
      showMessage("اختر منتجاً واحداً على الأقل قبل إرسال التقرير.");
      return;
    }
    setSubmitting(true);
    const result = await submitSalesLog({ company_id: selectedCompanyId, items: selectedItems, notes });
    setSubmitting(false);
    if (result.error || !result.data) {
      showMessage(result.error || "تعذر إرسال تقرير اليوم.");
      return;
    }
    showMessage("تم إرسال تقرير المبيعات بنجاح", "success");
    load(selectedCompanyId);
  };

  const handleEditRequest = async () => {
    if (!editRequestLog || editRequestText.trim().length < 3) {
      showMessage("اكتب التعديل المطلوب بوضوح قبل الإرسال.");
      return;
    }
    setRequestingEdit(true);
    const result = await requestSalesLogEdit({
      sales_log_id: editRequestLog.id,
      requested_changes: editRequestText.trim(),
    });
    setRequestingEdit(false);
    if (result.error) {
      showMessage(result.error);
      return;
    }
    setEditRequestLog(null);
    setEditRequestText("");
    showMessage("تم إرسال طلب التعديل إلى مدير المبيعات", "success");
    load(selectedCompanyId);
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        title={messageTone === "success" ? "" : undefined}
        description={message}
        descriptionClassName={messageTone === "success" ? "font-bold text-gray-950" : undefined}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">تسجيل مبيعات اليوم</h1>
          <p className="mt-2 text-gray-500">اختر الشركة ثم سجل المنتجات المباعة. يمكنك إرسال أكثر من تقرير في نفس اليوم.</p>
        </div>
        <div className="flex flex-col gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {companies.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => handleCompanyChange(company.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition",
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

          {yesterdayItems.length > 0 && (
            <Button variant="outline" onClick={applyYesterday}>
              <RotateCcw className="ml-2 h-4 w-4" />
              نفس آخر تسجيل بالأمس
            </Button>
          )}
        </div>
      </div>

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
            <div className="space-y-5">
              {productGroups.map((group) => (
                <section key={group.category} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-gray-900 sm:text-base">{group.category}</h2>
                    <Badge variant="outline" className="bg-white text-xs text-slate-600">{group.items.length}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                    {group.items.map((product) => (
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
                </section>
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
                <SalesReportTable logs={todayLogs} expanded onRequestEdit={(log) => setEditRequestLog(log)} />
              ) : (
                <div className="py-10 text-center text-sm text-gray-500">لم يتم إرسال أي تسجيل لهذه الشركة اليوم.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <Dialog open={Boolean(editRequestLog)} onOpenChange={(open) => {
        if (!open) {
          setEditRequestLog(null);
          setEditRequestText("");
        }
      }}>
        <DialogContent dir="rtl" className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>طلب تعديل تقرير المبيعات</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-500">اكتب التعديل المطلوب. سيتم إرسال الطلب إلى مدير مبيعات الشركة لمراجعته وتعديل التقرير.</p>
            <textarea
              value={editRequestText}
              onChange={(event) => setEditRequestText(event.target.value)}
              placeholder="مثال: تم تسجيل باقة 5GB بالخطأ، والصحيح باقة 10GB بعدد 2."
              className="min-h-32 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <DialogFooter className="sm:justify-start">
            <Button variant="outline" onClick={() => setEditRequestLog(null)}>إلغاء</Button>
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleEditRequest} disabled={requestingEdit || editRequestText.trim().length < 3}>
              <Edit3 className="ml-2 h-4 w-4" />
              {requestingEdit ? "جاري الإرسال..." : "إرسال طلب التعديل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
