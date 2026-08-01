"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CircleDollarSign,
  FileSpreadsheet,
  PackageCheck,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageSkeleton } from "@/components/Skeletons";
import { formatCurrency } from "@/lib/utils/currency";
import { newInventoryCommandId } from "@/lib/services/product-inventory";
import {
  createProductCatalogProduct,
  getProductCatalog,
  getProductCatalogOptions,
  setProductCatalogStatus,
  updateProductCatalogProduct,
  type ProductCatalogFormValues,
} from "@/lib/services/product-catalog";
import type { ProductCatalogOptions, ProductCatalogProduct } from "@/types/product-catalog";

const emptyOptions: ProductCatalogOptions = {
  enabled: true,
  companies: [],
  revenue_accounts: [],
};

const emptyForm: ProductCatalogFormValues = {
  company_id: "",
  name: "",
  description: "",
  unit: "جهاز",
  category: "5G Router",
  sku: "",
  barcode: "",
  model: "",
  price: 0,
  default_cost: 0,
  commission_type: "none",
  commission_value: 0,
  revenue_account_id: "",
  is_active: true,
};

function formFromProduct(product: ProductCatalogProduct): ProductCatalogFormValues {
  return {
    company_id: product.company_id,
    name: product.name,
    description: product.description || "",
    unit: product.unit || "جهاز",
    category: product.category || "",
    sku: product.sku || "",
    barcode: product.barcode || "",
    model: product.model || "",
    price: Number(product.price || 0),
    default_cost: Number(product.default_cost || 0),
    commission_type: product.agent_commission_type || "none",
    commission_value: Number(product.agent_commission_value || 0),
    revenue_account_id: product.revenue_account_id || "",
    is_active: product.is_active,
  };
}

export function ProductCatalogWorkspace() {
  const [products, setProducts] = useState<ProductCatalogProduct[]>([]);
  const [options, setOptions] = useState<ProductCatalogOptions>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const [catalogResult, optionsResult] = await Promise.all([
      getProductCatalog({ page, search, companyId, status }),
      getProductCatalogOptions(),
    ]);
    if (catalogResult.error || !catalogResult.data) {
      setMessage(catalogResult.error || "تعذر تحميل كتالوج المنتجات.");
    } else {
      setProducts(catalogResult.data.rows);
      setTotal(catalogResult.data.pagination.total);
      setTotalPages(catalogResult.data.pagination.total_pages);
    }
    if (optionsResult.error || !optionsResult.data) {
      setMessage(optionsResult.error || "تعذر تحميل خيارات المنتجات.");
    } else {
      setOptions(optionsResult.data);
    }
    setLoading(false);
  }, [companyId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageStats = useMemo(() => ({
    active: products.filter((product) => product.is_active).length,
    inactive: products.filter((product) => !product.is_active).length,
    incomplete: products.filter((product) => !product.sku && !product.barcode).length,
  }), [products]);

  if (loading && products.length === 0) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">كتالوج المنتجات</h1>
          <p className="mt-2 text-gray-500">
            أضف أجهزة الموردين وحدد سعر البيع والتكلفة والعمولة قبل استلام السيريالات.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled title="سيتم تفعيله في مرحلة استيراد الكتالوج">
            <FileSpreadsheet className="ml-2 h-4 w-4" /> رفع ملف Excel
          </Button>
          <ProductEditor
            options={options}
            onDone={load}
            onMessage={setMessage}
          />
        </div>
      </div>

      {!options.enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          كتالوج المنتجات متوقف مؤقتًا لهذه المنشأة. تواصل مع مسؤول النظام لتفعيله.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Boxes} label="نتائج البحث" value={total} />
        <SummaryCard icon={PackageCheck} label="نشط في الصفحة" value={pageStats.active} tone="green" />
        <SummaryCard icon={Boxes} label="متوقف في الصفحة" value={pageStats.inactive} tone="gray" />
        <SummaryCard icon={CircleDollarSign} label="بيانات ناقصة" value={pageStats.incomplete} tone="amber" />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 pt-1 md:grid-cols-[1fr_220px_160px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchDraft.trim());
            }}
          >
            <div className="relative">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="ابحث بالاسم أو SKU أو الباركود أو الموديل"
                className="pr-9"
              />
            </div>
            <select
              value={companyId}
              onChange={(event) => { setCompanyId(event.target.value); setPage(1); }}
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">كل الموردين</option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as "active" | "inactive" | "all");
                setPage(1);
              }}
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="active">النشطة</option>
              <option value="inactive">المتوقفة</option>
              <option value="all">الكل</option>
            </select>
            <Button type="submit" variant="outline">بحث</Button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/70">
                  <TableHead>المنتج</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>SKU / الباركود</TableHead>
                  <TableHead>الموديل</TableHead>
                  <TableHead>الأسعار</TableHead>
                  <TableHead>العمولة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <p className="font-semibold text-gray-950">{product.name}</p>
                      <p className="text-xs text-gray-500">{product.category || product.unit || "جهاز تسلسلي"}</p>
                    </TableCell>
                    <TableCell>{product.company?.name || "-"}</TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{product.sku || "-"}</p>
                      <p className="mt-1 font-mono text-xs text-gray-500">{product.barcode || "-"}</p>
                    </TableCell>
                    <TableCell>{product.model || "-"}</TableCell>
                    <TableCell>
                      <p className="font-medium">بيع: {formatCurrency(product.price)}</p>
                      <p className="mt-1 text-xs text-gray-500">تكلفة: {formatCurrency(product.default_cost)}</p>
                    </TableCell>
                    <TableCell>{commissionLabel(product)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={product.is_active
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-gray-200 bg-gray-100 text-gray-600"}
                      >
                        {product.is_active ? "نشط" : "متوقف"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <ProductEditor
                          product={product}
                          options={options}
                          onDone={load}
                          onMessage={setMessage}
                        />
                        <ConfirmActionButton
                          variant="outline"
                          size="sm"
                          title={product.is_active ? "إيقاف المنتج" : "تفعيل المنتج"}
                          description={product.is_active
                            ? "سيتوقف ظهوره في عمليات الاستلام الجديدة، ولن تتأثر الحركات السابقة."
                            : "سيعود المنتج للظهور في استلامات المورد الجديدة."}
                          confirmLabel={product.is_active ? "إيقاف" : "تفعيل"}
                          destructive={product.is_active}
                          onConfirm={async () => {
                            const result = await setProductCatalogStatus(
                              product.id,
                              !product.is_active,
                              product.inventory_version,
                              newInventoryCommandId()
                            );
                            if (result.error) setMessage(result.error);
                            else await load();
                          }}
                        >
                          {product.is_active ? "إيقاف" : "تفعيل"}
                        </ConfirmActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {products.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Boxes className="mb-3 h-10 w-10 text-gray-300" />
                <p className="font-medium text-gray-900">لا توجد منتجات مطابقة</p>
                <p className="mt-1 text-sm text-gray-500">أضف أول منتج أو غيّر خيارات البحث.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>صفحة {page} من {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "blue",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "blue" | "green" | "gray" | "amber";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    gray: "bg-gray-100 text-gray-600",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="flex items-center gap-3">
        <div className={`rounded-lg p-2.5 ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
        <div><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-950">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function commissionLabel(product: ProductCatalogProduct) {
  if (!product.agent_commission_type) return "بدون عمولة";
  if (product.agent_commission_type === "percentage") return `${product.agent_commission_value}%`;
  return formatCurrency(product.agent_commission_value);
}

function ProductEditor({
  product,
  options,
  onDone,
  onMessage,
}: {
  product?: ProductCatalogProduct;
  options: ProductCatalogOptions;
  onDone: () => void | Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProductCatalogFormValues>(emptyForm);

  useEffect(() => {
    if (!open) return;
    setForm(product
      ? formFromProduct(product)
      : { ...emptyForm, company_id: options.companies[0]?.id || "" });
  }, [open, options.companies, product]);

  const update = <K extends keyof ProductCatalogFormValues>(key: K, value: ProductCatalogFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!form.company_id) return onMessage("اختر المورد.");
    if (form.name.trim().length < 2) return onMessage("اسم المنتج مطلوب.");
    if (!form.sku?.trim() && !form.barcode?.trim()) return onMessage("أدخل SKU أو الباركود على الأقل.");
    if (form.is_active && Number(form.price) <= 0) return onMessage("سعر البيع للمنتج النشط يجب أن يكون أكبر من صفر.");
    if (form.commission_type === "percentage" && Number(form.commission_value) > 100) return onMessage("نسبة العمولة لا يمكن أن تتجاوز 100٪.");
    setSaving(true);
    const payload = {
      ...form,
      name: form.name.trim(),
      sku: form.sku?.trim() || null,
      barcode: form.barcode?.trim() || null,
      model: form.model?.trim() || null,
      description: form.description?.trim() || null,
      category: form.category?.trim() || null,
      revenue_account_id: form.revenue_account_id || null,
      commission_value: form.commission_type === "none" ? 0 : Number(form.commission_value),
      price: Number(form.price),
      default_cost: Number(form.default_cost),
    };
    const result = product
      ? await updateProductCatalogProduct(product.id, payload, product.inventory_version, newInventoryCommandId())
      : await createProductCatalogProduct(payload, newInventoryCommandId());
    setSaving(false);
    if (result.error) return onMessage(result.error);
    setOpen(false);
    await onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={product ? "ghost" : "default"} size={product ? "sm" : "default"} className={product ? "text-brand" : "bg-brand text-white hover:bg-brand-dark"} />}
      >
        {product ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" /> إضافة منتج</>}
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader><DialogTitle>{product ? "تعديل المنتج" : "إضافة منتج جديد"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المورد *">
              <select value={form.company_id} onChange={(event) => update("company_id", event.target.value)} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="">اختر المورد</option>
                {options.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </Field>
            <Field label="اسم المنتج *"><Input value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU"><Input dir="ltr" value={form.sku || ""} onChange={(event) => update("sku", event.target.value)} /></Field>
            <Field label="الباركود"><Input dir="ltr" value={form.barcode || ""} onChange={(event) => update("barcode", event.target.value)} /></Field>
            <Field label="الموديل"><Input dir="ltr" value={form.model || ""} onChange={(event) => update("model", event.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="سعر البيع *"><Input type="number" min={0} step="0.01" value={form.price} onChange={(event) => update("price", Number(event.target.value))} /></Field>
            <Field label="التكلفة الافتراضية"><Input type="number" min={0} step="0.01" value={form.default_cost} onChange={(event) => update("default_cost", Number(event.target.value))} /></Field>
            <Field label="الوحدة"><Input value={form.unit} onChange={(event) => update("unit", event.target.value)} /></Field>
            <Field label="الفئة"><Input value={form.category || ""} onChange={(event) => update("category", event.target.value)} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="نوع العمولة">
              <select value={form.commission_type} onChange={(event) => update("commission_type", event.target.value as ProductCatalogFormValues["commission_type"])} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="none">بدون عمولة</option><option value="flat">قيمة ثابتة</option><option value="percentage">نسبة مئوية</option>
              </select>
            </Field>
            <Field label="قيمة العمولة"><Input type="number" min={0} step="0.01" disabled={form.commission_type === "none"} value={form.commission_value} onChange={(event) => update("commission_value", Number(event.target.value))} /></Field>
            <Field label="حساب الإيراد">
              <select value={form.revenue_account_id || ""} onChange={(event) => update("revenue_account_id", event.target.value)} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="">الحساب الافتراضي</option>
                {options.revenue_accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name_ar}</option>)}
              </select>
            </Field>
          </div>
          <Field label="الوصف">
            <textarea value={form.description || ""} onChange={(event) => update("description", event.target.value)} className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} className="h-4 w-4 accent-brand" />
            المنتج نشط وجاهز للظهور في عمليات الاستلام
          </label>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
            يتم تفعيل التتبع التسلسلي تلقائيًا. سيظهر المنتج في Excel الاستلام عند اختيار نفس المورد.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving || !options.enabled || options.companies.length === 0} className="bg-brand text-white hover:bg-brand-dark">
            {saving ? "جاري الحفظ..." : "حفظ المنتج"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
