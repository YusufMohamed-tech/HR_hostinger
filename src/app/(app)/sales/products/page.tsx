"use client";

import React, { useEffect, useState } from "react";
import { Pencil, Plus, PackageOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import { createSalesProduct, deleteSalesProduct, getSalesProducts, updateSalesProduct, type SalesProduct } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";

const emptyForm = { name: "", description: "", unit: "", category: "", price: "0" };

export default function SalesProductsPage() {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const result = await getSalesProducts(true);
    if (result.error || !result.data) setMessage(result.error || "تعذر تحميل المنتجات.");
    else setProducts(result.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">المنتجات</h1>
          <p className="mt-2 text-gray-500">إدارة منتجات المبيعات والأسعار والحالة.</p>
        </div>
        <ProductDialog onDone={load} onMessage={setMessage} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>المنتج</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>الوحدة</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div>
                      <p className="font-semibold text-gray-950">{product.name}</p>
                      {product.description && <p className="text-xs text-gray-500">{product.description}</p>}
                    </div>
                  </TableCell>
                  <TableCell>{product.category || "-"}</TableCell>
                  <TableCell>{product.unit || "-"}</TableCell>
                  <TableCell>{Number(product.price || 0).toLocaleString("ar-EG")} جنيه</TableCell>
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
                      <ProductDialog product={product} onDone={load} onMessage={setMessage} />
                      <ConfirmActionButton
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        title="حذف المنتج"
                        description="سيتم حذف هذا المنتج من المنتجات النشطة. لن تُحذف سجلات المبيعات السابقة."
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
              ))}
            </TableBody>
          </Table>
          {products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <PackageOpen className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-900">لا توجد منتجات بعد</p>
              <p className="mt-1 text-sm text-gray-500">أضف أول منتج ليظهر للبائعين في التسجيل اليومي.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductDialog({ product, onDone, onMessage }: { product?: SalesProduct; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    setForm(product ? {
      name: product.name || "",
      description: product.description || "",
      unit: product.unit || "",
      category: product.category || "",
      price: String(product.price || 0),
    } : emptyForm);
  }, [open, product]);

  const save = async () => {
    if (form.name.trim().length < 2) {
      onMessage("اسم المنتج مطلوب.");
      return;
    }
    setSaving(true);
    const values = {
      name: form.name.trim(),
      description: form.description.trim(),
      unit: form.unit.trim(),
      category: form.category.trim(),
      price: Number(form.price || 0),
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
      <DialogContent dir="rtl" className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{product ? "تعديل منتج" : "إضافة منتج"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>اسم المنتج *</Label>
            <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>السعر</Label>
              <Input type="number" min={0} value={form.price} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>الوحدة</Label>
              <Input value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>الفئة</Label>
              <Input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} />
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
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save} disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
