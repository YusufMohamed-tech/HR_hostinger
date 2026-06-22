"use client";

import React, { useEffect, useMemo, useState } from "react";
import { PackageOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import {
  createSalesProduct,
  deleteSalesProduct,
  getSalesCompanies,
  getSalesProducts,
  getSalesRevenueAccounts,
  updateSalesProduct,
  type SalesCompany,
  type SalesProduct,
  type SalesRevenueAccount,
} from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { PageSkeleton } from "@/components/Skeletons";

const emptyForm = { company_id: "", name: "", description: "", unit: "", category: "", price: "0", revenue_account_id: "" };

export default function SalesProductsPage() {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [companies, setCompanies] = useState<SalesCompany[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<SalesRevenueAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const [productsResult, companiesResult, accountsResult] = await Promise.all([getSalesProducts(true), getSalesCompanies(), getSalesRevenueAccounts()]);
    if (productsResult.error || !productsResult.data) setMessage(productsResult.error || "تعذر تحميل المنتجات.");
    else setProducts(productsResult.data);
    if (companiesResult.error || !companiesResult.data) setMessage(companiesResult.error || "تعذر تحميل شركات المبيعات.");
    else setCompanies(companiesResult.data);
    if (accountsResult.data) setRevenueAccounts(accountsResult.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const revenueAccountById = useMemo(() => new Map(revenueAccounts.map((account) => [account.id, account])), [revenueAccounts]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">منتجات المبيعات</h1>
          <p className="mt-2 text-gray-500">إدارة منتجات كل شركة وأسعارها وحالتها.</p>
        </div>
        <ProductDialog companies={companies} revenueAccounts={revenueAccounts} onDone={load} onMessage={setMessage} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>المنتج</TableHead>
                <TableHead>الشركة</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>حساب الإيراد</TableHead>
                <TableHead>الوحدة</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const company = product.company_id ? companyById.get(product.company_id) : null;
                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-950">{product.name}</p>
                        {product.description && <p className="text-xs text-gray-500">{product.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {company?.brand_color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: company.brand_color }} />}
                        <span>{company?.name || "-"}</span>
                      </div>
                    </TableCell>
                    <TableCell>{product.category || "-"}</TableCell>
                    <TableCell>
                      {product.revenue_account_id
                        ? `${revenueAccountById.get(product.revenue_account_id)?.code || ""} ${revenueAccountById.get(product.revenue_account_id)?.name_ar || product.revenue_account_id}`.trim()
                        : "-"}
                    </TableCell>
                    <TableCell>{product.unit || "-"}</TableCell>
                    <TableCell>{formatCurrency(product.price)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={product.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                        {product.is_active ? "نشط" : "متوقف"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const result = await updateSalesProduct(product.id, { is_active: !product.is_active });
                            if (result.error) setMessage(result.error);
                            else load();
                          }}
                        >
                          {product.is_active ? "إيقاف" : "تفعيل"}
                        </Button>
                        <ProductDialog product={product} companies={companies} revenueAccounts={revenueAccounts} onDone={load} onMessage={setMessage} />
                        <ConfirmActionButton
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          title="حذف المنتج"
                          description="سيتم إيقاف المنتج من المنتجات النشطة. سجلات المبيعات السابقة لن تتأثر."
                          confirmLabel="حذف"
                          destructive
                          onConfirm={async () => {
                            const result = await deleteSalesProduct(product.id);
                            if (result.error) setMessage(result.error);
                            else load();
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </ConfirmActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <PackageOpen className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-900">لا توجد منتجات بعد</p>
              <p className="mt-1 text-sm text-gray-500">أضف أول منتج ليظهر للبائعين المسندين لنفس الشركة.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductDialog({
  product,
  companies,
  revenueAccounts,
  onDone,
  onMessage,
}: {
  product?: SalesProduct;
  companies: SalesCompany[];
  revenueAccounts: SalesRevenueAccount[];
  onDone: () => void;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    const defaultCompanyId = product?.company_id || companies[0]?.id || "";
    setForm(product ? {
      company_id: defaultCompanyId,
      name: product.name || "",
      description: product.description || "",
      unit: product.unit || "",
      category: product.category || "",
      price: String(product.price || 0),
      revenue_account_id: product.revenue_account_id || "",
    } : { ...emptyForm, company_id: defaultCompanyId });
  }, [open, product, companies]);

  const save = async () => {
    if (!form.company_id) {
      onMessage("اختر شركة المنتج.");
      return;
    }
    if (form.name.trim().length < 2) {
      onMessage("اسم المنتج مطلوب.");
      return;
    }
    setSaving(true);
    const values = {
      company_id: form.company_id,
      name: form.name.trim(),
      description: form.description.trim(),
      unit: form.unit.trim(),
      category: form.category.trim(),
      price: Number(form.price || 0),
      revenue_account_id: form.revenue_account_id || null,
    };
    const result = product ? await updateSalesProduct(product.id, values) : await createSalesProduct(values);
    setSaving(false);
    if (result.error) {
      onMessage(result.error);
      return;
    }
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={product ? "ghost" : "default"} size={product ? "sm" : "default"} className={product ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark"} />}>
        {product ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" /> إضافة منتج</>}
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{product ? "تعديل منتج" : "إضافة منتج"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الشركة *</Label>
            <select
              value={form.company_id}
              onChange={(event) => setForm((prev) => ({ ...prev, company_id: event.target.value }))}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {companies.length === 0 && <option value="">اختر شركة المبيعات</option>}
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>اسم المنتج *</Label>
            <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>حساب الإيراد</Label>
            <select
              value={form.revenue_account_id}
              onChange={(event) => setForm((prev) => ({ ...prev, revenue_account_id: event.target.value }))}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">الحساب الافتراضي من إعدادات المحاسبة</option>
              {revenueAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name_ar}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>السعر</Label>
              <Input type="number" min={0} value={form.price} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>الوحدة</Label>
              <Input value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} placeholder="شريحة / باقة" />
            </div>
            <div className="space-y-2">
              <Label>الفئة</Label>
              <Input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} placeholder="إنترنت / اتصال" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>الوصف</Label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="min-h-24 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save} disabled={saving || companies.length === 0}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
