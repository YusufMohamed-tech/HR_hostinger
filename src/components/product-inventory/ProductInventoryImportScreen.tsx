"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { PageSkeleton } from "@/components/Skeletons";
import { normalizeSerial } from "@/lib/product-inventory/normalization";
import { buildInventoryImportCsv } from "@/lib/product-inventory/workbook";
import {
  commitProductInventoryWorkbook,
  getProductInventorySetup,
  newInventoryCommandId,
  previewProductInventoryWorkbook,
} from "@/lib/services/product-inventory";
import type {
  ProductInventoryCompany,
  ProductInventoryImportRow,
  ProductInventoryProduct,
  ProductInventoryWarehouse,
  ProductInventoryWorkbookPreview,
} from "@/types/product-inventory";

const pageSize = 50;

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: ProductInventoryImportRow["status"]) {
  return {
    valid: "صالح",
    warning: "تحذير",
    invalid: "غير صالح",
    duplicate: "مكرر",
    unmatched: "غير مطابق",
  }[status];
}

function statusClass(status: ProductInventoryImportRow["status"]) {
  return status === "valid"
    ? "border-green-200 bg-green-50 text-green-700"
    : status === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
}

function validateRows(rows: ProductInventoryImportRow[], products: ProductInventoryProduct[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const serial = normalizeSerial(row.serial_number);
    if (serial) counts.set(serial, (counts.get(serial) ?? 0) + 1);
  }
  const productIds = new Set(products.map((product) => product.id));
  return rows.map((row) => {
    const errors: string[] = [];
    const serial = normalizeSerial(row.serial_number);
    const serialWasNotChanged = serial === row.normalized_serial;
    if (serialWasNotChanged) {
      errors.push(...row.validation_errors.filter((error) =>
        error.includes("confirmed stock")
        || error.includes("formatted as text")
      ));
    }
    if (!productIds.has(row.product_id)) errors.push("اختر منتجاً صالحاً.");
    if (!serial) errors.push("الرقم التسلسلي مطلوب.");
    if (/^[=+@]/u.test(row.serial_number.trim())) errors.push("لا يسمح بصيغة أو معادلة في الرقم التسلسلي.");
    if (serial && (counts.get(serial) ?? 0) > 1) errors.push("الرقم التسلسلي مكرر داخل الملف.");
    if (!row.unit_cost || row.unit_cost <= 0) errors.push("تكلفة الوحدة مطلوبة.");
    if (!row.planned_sale_price || row.planned_sale_price <= 0) errors.push("سعر البيع المخطط مطلوب.");
    if (!/^[A-Z]{3}$/u.test(row.currency)) errors.push("رمز العملة غير صالح.");
    const warnings = row.validation_warnings.filter((warning) =>
      warning.includes("another draft") ? serialWasNotChanged : false
    );
    return {
      ...row,
      normalized_serial: serial,
      validation_errors: errors,
      validation_warnings: warnings,
      status: errors.length > 0
        ? (errors.some((error) => error.includes("مكرر")) ? "duplicate" : row.product_id ? "invalid" : "unmatched")
        : warnings.length > 0 ? "warning" : "valid",
    } as ProductInventoryImportRow;
  });
}

export function ProductInventoryImportScreen() {
  const router = useRouter();
  const [companies, setCompanies] = useState<ProductInventoryCompany[]>([]);
  const [warehouses, setWarehouses] = useState<ProductInventoryWarehouse[]>([]);
  const [products, setProducts] = useState<ProductInventoryProduct[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [ownershipType, setOwnershipType] = useState<"purchased" | "consignment">("purchased");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryNote, setDeliveryNote] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProductInventoryWorkbookPreview | null>(null);
  const [rows, setRows] = useState<ProductInventoryImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [receiptId] = useState(() => crypto.randomUUID());
  const [sourceId] = useState(() => crypto.randomUUID());
  const [managedFileId] = useState(() => crypto.randomUUID());
  const [previewCommandId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void getProductInventorySetup().then((result) => {
      if (result.data) {
        setCompanies(result.data.companies);
        setWarehouses(result.data.warehouses);
        setProducts(result.data.products);
        setCompanyId(result.data.companies[0]?.id || "");
        setWarehouseId(result.data.warehouses[0]?.id || "");
      }
      setMessage(result.error || "");
      setLoading(false);
    });
  }, []);

  const supplierProducts = useMemo(
    () => products.filter((product) => product.company_id === companyId),
    [companyId, products]
  );
  const counts = useMemo(() => rows.reduce((value, row) => {
    value[row.status] += 1;
    return value;
  }, { valid: 0, warning: 0, invalid: 0, duplicate: 0, unmatched: 0 }), [rows]);
  const blockingCount = counts.invalid + counts.duplicate + counts.unmatched;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const updateRow = (rowNumber: number, changes: Partial<ProductInventoryImportRow>) => {
    setRows((current) => validateRows(
      current.map((row) => row.row_number === rowNumber ? { ...row, ...changes } : row),
      supplierProducts
    ));
  };

  const runPreview = async () => {
    if (!file || !companyId || !warehouseId) return setMessage("اختر المورد والمستودع وملف الاستيراد.");
    setWorking(true);
    const result = await previewProductInventoryWorkbook(receiptId, file, {
      source_id: sourceId,
      managed_file_id: managedFileId,
      command_id: previewCommandId,
      supplier_company_id: companyId,
      warehouse_id: warehouseId,
      ownership_type: ownershipType,
      receipt_date: receiptDate,
      currency: "SAR",
      delivery_note_no: deliveryNote,
      supplier_invoice_no: supplierInvoice,
      notes,
    });
    setWorking(false);
    if (result.error || !result.data) return setMessage(result.error || "تعذر إنشاء المعاينة.");
    setPreview(result.data);
    setRows(result.data.rows);
    setPage(1);
  };

  const commit = async () => {
    const checked = validateRows(rows, supplierProducts);
    setRows(checked);
    const invalid = checked.filter((row) => !["valid", "warning"].includes(row.status));
    if (invalid.length > 0 || !preview) {
      setMessage(`صحح كل الصفوف أولاً. يوجد ${invalid.length} صف غير صالح.`);
      return;
    }
    setWorking(true);
    const result = await commitProductInventoryWorkbook(receiptId, {
      source_id: preview.source.id,
      expected_version: preview.receipt.version,
      command_id: newInventoryCommandId(),
      rows: checked,
    });
    setWorking(false);
    if (result.error) return setMessage(result.error);
    router.push(`/sales/inventory/receipts/${receiptId}`);
  };

  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">استلام المنتجات من Excel / CSV</h1>
          <p className="mt-2 text-gray-500">صف واحد لكل وحدة مسلسلة. راجع المطابقة والأسعار والأخطاء قبل تجهيز السند.</p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/sales/inventory/template"><Download className="ml-2 h-4 w-4" />تحميل القالب</a>
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label>شركة المورد *</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-gray-100" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="space-y-2"><Label>المستودع *</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-gray-100" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</option>)}</select></div>
          <div className="space-y-2"><Label>نوع الملكية</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-gray-100" value={ownershipType} onChange={(event) => setOwnershipType(event.target.value as "purchased" | "consignment")}><option value="purchased">مشتريات مملوكة</option><option value="consignment">عهدة من المورد</option></select></div>
          <div className="space-y-2"><Label>تاريخ الاستلام *</Label><Input disabled={Boolean(preview)} type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></div>
          <div className="space-y-2"><Label>رقم إذن التسليم</Label><Input disabled={Boolean(preview)} value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} /></div>
          <div className="space-y-2"><Label>فاتورة المورد</Label><Input disabled={Boolean(preview)} value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label>ملاحظات</Label><Input disabled={Boolean(preview)} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <Label>ملف XLSX أو CSV — حد أقصى 10 MB / 10,000 صف *</Label>
            <Input disabled={Boolean(preview)} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </div>
          <div className="flex items-end"><Button disabled={working || Boolean(preview)} className="w-full bg-brand text-white hover:bg-brand-dark" onClick={() => void runPreview()}><Upload className="ml-2 h-4 w-4" />{working ? "جاري الفحص والتحليل..." : "رفع ومعاينة"}</Button></div>
        </CardContent>
      </Card>

      {preview && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="border-green-100 bg-green-50/50"><CardContent className="p-4"><p className="text-sm text-green-700">صالح</p><p className="mt-1 text-2xl font-bold">{counts.valid}</p></CardContent></Card>
            <Card className="border-amber-100 bg-amber-50/50"><CardContent className="p-4"><p className="text-sm text-amber-700">تحذير</p><p className="mt-1 text-2xl font-bold">{counts.warning}</p></CardContent></Card>
            <Card className="border-red-100 bg-red-50/50"><CardContent className="p-4"><p className="text-sm text-red-700">غير صالح</p><p className="mt-1 text-2xl font-bold">{counts.invalid}</p></CardContent></Card>
            <Card className="border-red-100 bg-red-50/50"><CardContent className="p-4"><p className="text-sm text-red-700">مكرر</p><p className="mt-1 text-2xl font-bold">{counts.duplicate}</p></CardContent></Card>
            <Card className="border-red-100 bg-red-50/50"><CardContent className="p-4"><p className="text-sm text-red-700">غير مطابق</p><p className="mt-1 text-2xl font-bold">{counts.unmatched}</p></CardContent></Card>
          </div>

          <Card className="border-none shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div><CardTitle>مراجعة صفوف الملف</CardTitle><p className="mt-1 text-sm text-gray-500">{preview.source.original_name} · {rows.length} صف · صفحة {page} من {totalPages}</p></div>
              <Button variant="outline" onClick={() => downloadText(buildInventoryImportCsv(rows, true), "product-inventory-import-errors.csv")} disabled={blockingCount === 0}><Download className="ml-2 h-4 w-4" />تصدير الأخطاء</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[1200px]">
                <TableHeader><TableRow><TableHead>الصف</TableHead><TableHead>الحالة</TableHead><TableHead>المنتج</TableHead><TableHead>الرقم التسلسلي</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع</TableHead><TableHead>العملة</TableHead><TableHead>الحالة المادية</TableHead><TableHead>الملاحظات</TableHead></TableRow></TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.row_number} className={["valid", "warning"].includes(row.status) ? "" : "bg-red-50/30"}>
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell><Badge variant="outline" className={statusClass(row.status)}>{statusLabel(row.status)}</Badge></TableCell>
                      <TableCell><select className="h-9 min-w-56 rounded-md border bg-white px-2 text-sm" value={row.product_id} onChange={(event) => { const selected = supplierProducts.find((product) => product.id === event.target.value); updateRow(row.row_number, { product_id: event.target.value, product_name: selected?.name || row.product_name, product_sku: selected?.sku || row.product_sku, model: selected?.model || row.model }); }}><option value="">اختر المنتج</option>{supplierProducts.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` — ${product.sku}` : ""}</option>)}</select></TableCell>
                      <TableCell><Input dir="ltr" className="min-w-44 font-mono" value={row.serial_number} onChange={(event) => updateRow(row.row_number, { serial_number: event.target.value })} /></TableCell>
                      <TableCell><Input className="min-w-28" type="number" min="0.01" step="0.01" value={row.unit_cost ?? ""} onChange={(event) => updateRow(row.row_number, { unit_cost: Number(event.target.value) || null })} /></TableCell>
                      <TableCell><Input className="min-w-28" type="number" min="0.01" step="0.01" value={row.planned_sale_price ?? ""} onChange={(event) => updateRow(row.row_number, { planned_sale_price: Number(event.target.value) || null })} /></TableCell>
                      <TableCell><Input className="w-20" maxLength={3} value={row.currency} onChange={(event) => updateRow(row.row_number, { currency: event.target.value.toUpperCase() })} /></TableCell>
                      <TableCell><select className="h-9 rounded-md border bg-white px-2 text-sm" value={row.condition} onChange={(event) => updateRow(row.row_number, { condition: event.target.value as ProductInventoryImportRow["condition"] })}><option value="new">جديد</option><option value="open_box">مفتوح</option><option value="refurbished">مجدد</option></select></TableCell>
                      <TableCell className="max-w-72"><div className="space-y-1 text-xs">{row.validation_errors.map((error) => <p key={error} className="flex items-start gap-1 text-red-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{error}</p>)}{row.validation_warnings.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between"><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div><p className="text-sm text-gray-500">لا يمكن حذف أو استبعاد صف؛ يجب تصحيح الملف بالكامل.</p></div>
          <Card className={blockingCount === 0 ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{blockingCount === 0 ? <CheckCircle2 className="h-6 w-6 text-green-700" /> : <AlertTriangle className="h-6 w-6 text-amber-700" />}<div><p className="font-semibold">{blockingCount === 0 ? "كل الصفوف جاهزة" : `${blockingCount} صف يحتاج تصحيحاً`}</p><p className="text-sm text-gray-600">اعتماد الملف ينشئ مجموعات سند الاستلام فقط؛ إدخال المخزون يتم من شاشة السند بعد التأكيد النهائي.</p></div></div><div className="flex gap-2"><Button variant="outline" asChild><Link href="/sales/inventory">العودة</Link></Button><Button disabled={working || blockingCount > 0} className="bg-brand text-white hover:bg-brand-dark" onClick={() => void commit()}><FileSpreadsheet className="ml-2 h-4 w-4" />{working ? "جاري الاعتماد..." : "اعتماد الملف وتجهيز السند"}</Button></div></CardContent></Card>
        </>
      )}
    </div>
  );
}
