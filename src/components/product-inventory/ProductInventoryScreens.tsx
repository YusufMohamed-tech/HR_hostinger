"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, Camera, CheckCircle2, ClipboardList, FileImage, FileSpreadsheet, PackagePlus, Plus, RefreshCcw, Save, Send, Settings, Trash2, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { PageSkeleton } from "@/components/Skeletons";
import { calculateReceiptTotals, parseSerialNumbers } from "@/lib/product-inventory/normalization";
import {
  cancelProductReceipt,
  confirmProductReceipt,
  getFinanceProductInventory,
  getProductInventoryAccountingSettings,
  getProductInventorySetup,
  getProductReceipt,
  getProductReceipts,
  getProductStock,
  newInventoryCommandId,
  openProductInventorySource,
  retryProductInventoryAccounting,
  saveManualReceipt,
  settleProductAgentCommission,
  updateProductInventoryAccountingSettings,
} from "@/lib/services/product-inventory";
import type {
  AgentProductCollection,
  AgentProductSale,
  ProductInventoryCompany,
  ProductInventoryAccountingPosting,
  ProductInventoryAccountingSettings,
  ProductAgentCommission,
  ProductInventoryProduct,
  ProductInventoryStockRow,
  ProductInventoryWarehouse,
  ProductReceipt,
} from "@/types/product-inventory";

function money(value: number, currency = "SAR") {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency }).format(Number(value || 0));
}

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  needs_review: "تحتاج مراجعة",
  ready_to_confirm: "جاهز للتأكيد",
  confirmed: "مؤكد",
  cancelled: "ملغي",
  failed: "فشل",
  pending: "بانتظار المعالجة المحاسبية",
  pending_approval: "بانتظار اعتماد القيد",
  not_required: "عهدة / لا يحتاج قيد",
  posted: "مرحّل",
  in_stock: "في المخزن",
  in_transit: "قيد التسليم",
  with_agent: "عهدة مندوب",
  sold: "مباع",
  returned: "مرتجع",
  damaged: "تالف",
  active: "نشط",
  voided: "ملغي",
  reversed: "معكوس",
  accrued: "مستحقة",
  settled: "مسددة",
};

function StatusBadge({ value }: { value: string }) {
  const className = value === "confirmed" || value === "posted"
    ? "border-green-200 bg-green-50 text-green-700"
    : value === "cancelled" || value === "failed"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return <Badge variant="outline" className={className}>{statusLabels[value] || value}</Badge>;
}

function MetricCard({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Boxes }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div><p className="text-sm text-gray-500">{title}</p><p className="mt-2 text-2xl font-bold text-gray-950">{value}</p></div>
        <span className="rounded-xl bg-blue-50 p-3 text-blue-700"><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

export function ProductInventoryDashboard() {
  const [receipts, setReceipts] = useState<ProductReceipt[]>([]);
  const [stock, setStock] = useState<ProductInventoryStockRow[]>([]);
  const [totals, setTotals] = useState({ units: 0, cost: 0, expectedSales: 0, margin: 0 });
  const [receiptPage, setReceiptPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [receiptPages, setReceiptPages] = useState(1);
  const [stockPages, setStockPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [receiptResult, stockResult] = await Promise.all([
      getProductReceipts(receiptPage, 20),
      getProductStock(stockPage, 20),
    ]);
    if (receiptResult.data) {
      setReceipts(receiptResult.data.rows);
      setReceiptPages(receiptResult.data.pagination.total_pages);
    }
    if (stockResult.data) {
      setStock(stockResult.data.rows);
      setTotals(stockResult.data.totals);
      setStockPages(stockResult.data.pagination.total_pages);
    }
    setMessage(receiptResult.error || stockResult.error || "");
    setLoading(false);
  }, [receiptPage, stockPage]);

  useEffect(() => { void load(); }, [load]);
  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">مخزون المنتجات</h1>
          <p className="mt-2 text-gray-500">استلام المنتجات ذات الأرقام التسلسلية وتجهيزها للتوزيع على المندوبين.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/sales/inventory/assignments"><Send className="ml-2 h-4 w-4" />تسليم للمندوبين</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sales/inventory/receipts/photo"><Camera className="ml-2 h-4 w-4" />استلام بالصور</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sales/inventory/receipts/import"><FileSpreadsheet className="ml-2 h-4 w-4" />استيراد Excel / CSV</Link>
          </Button>
          <Button asChild className="bg-brand text-white hover:bg-brand-dark">
            <Link href="/sales/inventory/receipts/new"><PackagePlus className="ml-2 h-4 w-4" />استلام يدوي جديد</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="الوحدات في السجل" value={String(totals.units)} icon={Boxes} />
        <MetricCard title="إجمالي التكلفة" value={money(totals.cost)} icon={WalletCards} />
        <MetricCard title="قيمة البيع المتوقعة" value={money(totals.expectedSales)} icon={ClipboardList} />
        <MetricCard title="الهامش المتوقع" value={money(totals.margin)} icon={CheckCircle2} />
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle>سندات الاستلام</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>السند</TableHead><TableHead>المورد</TableHead><TableHead>التاريخ</TableHead><TableHead>الوحدات</TableHead><TableHead>التكلفة</TableHead><TableHead>قيمة البيع</TableHead><TableHead>الحالة</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-mono">{receipt.receipt_no}</TableCell>
                  <TableCell>{receipt.company?.name || "-"}</TableCell>
                  <TableCell>{receipt.receipt_date}</TableCell>
                  <TableCell>{receipt.total_units}</TableCell>
                  <TableCell>{money(receipt.physical_total_cost, receipt.currency)}</TableCell>
                  <TableCell>{money(receipt.expected_sales_value, receipt.currency)}</TableCell>
                  <TableCell><StatusBadge value={receipt.status} /></TableCell>
                  <TableCell className="text-left"><Button asChild variant="outline" size="sm"><Link href={`/sales/inventory/receipts/${receipt.id}`}>عرض</Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {receipts.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد سندات استلام بعد.</p>}
          {receiptPages > 1 && <div className="flex items-center justify-between border-t p-4"><Button variant="outline" size="sm" disabled={receiptPage <= 1} onClick={() => setReceiptPage((value) => value - 1)}>السابق</Button><span className="text-sm text-gray-500">صفحة {receiptPage} من {receiptPages}</span><Button variant="outline" size="sm" disabled={receiptPage >= receiptPages} onClick={() => setReceiptPage((value) => value + 1)}>التالي</Button></div>}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle>أحدث الوحدات المسلسلة</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الرقم التسلسلي</TableHead><TableHead>الموقع / العهدة</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع المخطط</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
            <TableBody>
              {stock.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell>{unit.product?.name || "-"}</TableCell>
                  <TableCell className="font-mono" dir="ltr">{unit.raw_serial_number}</TableCell>
                  <TableCell>{unit.agent?.full_name || unit.warehouse?.name_ar || unit.warehouse?.name_en || "-"}</TableCell>
                  <TableCell>{money(unit.unit_cost_snapshot, unit.currency)}</TableCell>
                  <TableCell>{money(unit.planned_sale_price_snapshot, unit.currency)}</TableCell>
                  <TableCell><StatusBadge value={unit.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {stock.length === 0 && <p className="p-8 text-center text-sm text-gray-500">يظهر المخزون هنا بعد تأكيد أول سند.</p>}
          {stockPages > 1 && <div className="flex items-center justify-between border-t p-4"><Button variant="outline" size="sm" disabled={stockPage <= 1} onClick={() => setStockPage((value) => value - 1)}>السابق</Button><span className="text-sm text-gray-500">صفحة {stockPage} من {stockPages}</span><Button variant="outline" size="sm" disabled={stockPage >= stockPages} onClick={() => setStockPage((value) => value + 1)}>التالي</Button></div>}
        </CardContent>
      </Card>
    </div>
  );
}

type GroupForm = {
  key: string;
  product_id: string;
  unit_cost: string;
  planned_sale_price: string;
  condition: "new" | "open_box" | "refurbished";
  serials: string;
};

function emptyGroup(): GroupForm {
  return { key: crypto.randomUUID(), product_id: "", unit_cost: "", planned_sale_price: "", condition: "new", serials: "" };
}

export function ManualProductReceiptScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingReceiptId = searchParams.get("receipt");
  const [companies, setCompanies] = useState<ProductInventoryCompany[]>([]);
  const [warehouses, setWarehouses] = useState<ProductInventoryWarehouse[]>([]);
  const [products, setProducts] = useState<ProductInventoryProduct[]>([]);
  const [receiptId, setReceiptId] = useState(() => editingReceiptId || crypto.randomUUID());
  const [version, setVersion] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [ownershipType, setOwnershipType] = useState<"purchased" | "consignment">("purchased");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryNote, setDeliveryNote] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [groups, setGroups] = useState<GroupForm[]>([emptyGroup()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      const [setup, receipt] = await Promise.all([
        getProductInventorySetup(),
        editingReceiptId ? getProductReceipt(editingReceiptId) : Promise.resolve({ data: null, error: null }),
      ]);
      if (setup.data) {
        setCompanies(setup.data.companies);
        setWarehouses(setup.data.warehouses);
        setProducts(setup.data.products);
        setCompanyId((current) => current || setup.data?.companies[0]?.id || "");
        setWarehouseId((current) => current || setup.data?.warehouses[0]?.id || "");
      }
      if (receipt.data) {
        setReceiptId(receipt.data.id);
        setVersion(receipt.data.version);
        setCompanyId(receipt.data.supplier_company_id);
        setWarehouseId(receipt.data.warehouse_id);
        setOwnershipType(receipt.data.ownership_type);
        setReceiptDate(receipt.data.receipt_date);
        setDeliveryNote(receipt.data.delivery_note_no || "");
        setSupplierInvoice(receipt.data.supplier_invoice_no || "");
        setNotes(receipt.data.notes || "");
        setGroups((receipt.data.lines || []).map((line) => ({
          key: line.id,
          product_id: line.product_id,
          unit_cost: String(line.unit_cost),
          planned_sale_price: String(line.planned_unit_sale_price),
          condition: line.condition,
          serials: (line.serial_numbers || []).join("\n"),
        })));
      }
      setMessage(setup.error || receipt.error || "");
      setLoading(false);
    };
    void load();
  }, [editingReceiptId]);

  const availableProducts = useMemo(() => products.filter((product) => product.company_id === companyId), [products, companyId]);
  const normalizedGroups = useMemo(() => groups.map((group) => ({
    product_id: group.product_id,
    unit_cost: Number(group.unit_cost || 0),
    planned_sale_price: Number(group.planned_sale_price || 0),
    currency: "SAR",
    tax_included: true,
    condition: group.condition,
    serial_numbers: parseSerialNumbers(group.serials),
  })), [groups]);
  const totals = useMemo(() => calculateReceiptTotals(normalizedGroups), [normalizedGroups]);

  const updateGroup = (key: string, values: Partial<GroupForm>) => {
    setGroups((current) => current.map((group) => group.key === key ? { ...group, ...values } : group));
  };

  const submit = async (confirm: boolean) => {
    if (!companyId || !warehouseId) return setMessage("اختر المورد والمستودع.");
    if (normalizedGroups.some((group) => !group.product_id || group.unit_cost <= 0 || group.planned_sale_price <= 0 || group.serial_numbers.length === 0)) {
      return setMessage("كل مجموعة تحتاج منتجاً وتكلفة وسعر بيع ورقماً تسلسلياً واحداً على الأقل.");
    }
    setSaving(true);
    const saved = await saveManualReceipt({
      receipt_id: receiptId,
      expected_version: version,
      supplier_company_id: companyId,
      warehouse_id: warehouseId,
      ownership_type: ownershipType,
      receipt_date: receiptDate,
      delivery_note_no: deliveryNote,
      supplier_invoice_no: supplierInvoice,
      invoice_received: Boolean(supplierInvoice),
      currency: "SAR",
      notes,
      groups: normalizedGroups,
      command_id: newInventoryCommandId(),
    });
    if (saved.error || !saved.data) {
      setSaving(false);
      return setMessage(saved.error || "تعذر حفظ سند الاستلام.");
    }
    setVersion(saved.data.version);
    if (confirm) {
      const confirmed = await confirmProductReceipt(receiptId, saved.data.version, newInventoryCommandId());
      setSaving(false);
      if (confirmed.error) return setMessage(confirmed.error);
    } else {
      setSaving(false);
    }
    router.push(`/sales/inventory/receipts/${receiptId}`);
  };

  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div>
        <h1 className="text-3xl font-bold text-gray-950">{editingReceiptId ? "تعديل سند الاستلام" : "استلام منتجات يدوياً"}</h1>
        <p className="mt-2 text-gray-500">أدخل كل نوع منتج كمجموعة، ثم ألصق أرقامه التسلسلية. العدد يحسب تلقائياً.</p>
      </div>

      <Card className="border-none shadow-sm"><CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label>شركة المورد *</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
        <div className="space-y-2"><Label>المستودع *</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</option>)}</select></div>
        <div className="space-y-2"><Label>نوع الملكية</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={ownershipType} onChange={(event) => setOwnershipType(event.target.value as "purchased" | "consignment")}><option value="purchased">مشتريات مملوكة</option><option value="consignment">عهدة من المورد</option></select></div>
        <div className="space-y-2"><Label>تاريخ الاستلام *</Label><Input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></div>
        <div className="space-y-2"><Label>رقم إذن التسليم</Label><Input value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} /></div>
        <div className="space-y-2"><Label>فاتورة المورد</Label><Input value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} /></div>
        <div className="space-y-2 md:col-span-2"><Label>ملاحظات</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      </CardContent></Card>

      <div className="space-y-4">
        {groups.map((group, index) => {
          const product = products.find((candidate) => candidate.id === group.product_id);
          const count = parseSerialNumbers(group.serials).length;
          return (
            <Card key={group.key} className="border-none shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">مجموعة المنتج {index + 1}</CardTitle>{groups.length > 1 && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setGroups((current) => current.filter((item) => item.key !== group.key))}><Trash2 className="h-4 w-4" /></Button>}</CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="space-y-2 xl:col-span-2"><Label>المنتج *</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={group.product_id} onChange={(event) => { const selected = products.find((item) => item.id === event.target.value); updateGroup(group.key, { product_id: event.target.value, unit_cost: selected?.default_cost ? String(selected.default_cost) : group.unit_cost, planned_sale_price: selected?.price ? String(selected.price) : group.planned_sale_price }); }}><option value="">اختر المنتج</option>{availableProducts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` — ${item.sku}` : ""}</option>)}</select></div>
                <div className="space-y-2"><Label>تكلفة الوحدة *</Label><Input type="number" min="0.01" step="0.01" value={group.unit_cost} onChange={(event) => updateGroup(group.key, { unit_cost: event.target.value })} /></div>
                <div className="space-y-2"><Label>سعر البيع المخطط *</Label><Input type="number" min="0.01" step="0.01" value={group.planned_sale_price} onChange={(event) => updateGroup(group.key, { planned_sale_price: event.target.value })} /></div>
                <div className="space-y-2"><Label>الحالة</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={group.condition} onChange={(event) => updateGroup(group.key, { condition: event.target.value as GroupForm["condition"] })}><option value="new">جديد</option><option value="open_box">مفتوح</option><option value="refurbished">مجدد</option></select></div>
                <div className="space-y-2 md:col-span-2 xl:col-span-5"><div className="flex items-center justify-between"><Label>الأرقام التسلسلية *</Label><Badge variant="outline">{count} وحدة</Badge></div><textarea dir="ltr" className="min-h-32 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm" placeholder={"SN-0001\nSN-0002\nSN-0003"} value={group.serials} onChange={(event) => updateGroup(group.key, { serials: event.target.value })} /><p className="text-xs text-gray-500">{product ? `${product.name}: ${count} × ${money(Number(group.unit_cost || 0))}` : "سطر واحد لكل رقم، أو افصل بفاصلة."}</p></div>
              </CardContent>
            </Card>
          );
        })}
        <Button variant="outline" onClick={() => setGroups((current) => [...current, emptyGroup()])}><Plus className="ml-2 h-4 w-4" />إضافة مجموعة منتج</Button>
      </div>

      <Card className="border-blue-100 bg-blue-50/40"><CardContent className="grid gap-4 p-5 sm:grid-cols-4"><div><p className="text-xs text-gray-500">الوحدات</p><p className="font-bold">{totals.units}</p></div><div><p className="text-xs text-gray-500">التكلفة</p><p className="font-bold">{money(totals.cost)}</p></div><div><p className="text-xs text-gray-500">قيمة البيع</p><p className="font-bold">{money(totals.expectedSales)}</p></div><div><p className="text-xs text-gray-500">الهامش المتوقع</p><p className="font-bold">{money(totals.margin)}</p></div></CardContent></Card>
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" asChild><Link href="/sales/inventory">إلغاء</Link></Button><Button variant="outline" disabled={saving} onClick={() => void submit(false)}>{saving ? "جاري الحفظ..." : "حفظ بدون تأكيد"}</Button><Button className="bg-brand text-white hover:bg-brand-dark" disabled={saving} onClick={() => void submit(true)}>{saving ? "جاري التأكيد..." : "حفظ وتأكيد وإدخال المخزون"}</Button></div>
    </div>
  );
}

export function ProductReceiptDetailScreen({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<ProductReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const result = await getProductReceipt(receiptId);
    setReceipt(result.data);
    setMessage(result.error || "");
    setLoading(false);
  }, [receiptId]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <PageSkeleton />;
  if (!receipt) return <p>سند الاستلام غير موجود.</p>;
  const editable = ["draft", "needs_review", "ready_to_confirm"].includes(receipt.status);

  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-3"><h1 className="text-3xl font-bold text-gray-950">{receipt.receipt_no}</h1><StatusBadge value={receipt.status} /></div><p className="mt-2 text-gray-500">{receipt.company?.name} · {receipt.receipt_date} · {receipt.warehouse?.name_ar}</p></div>{editable && <div className="flex gap-2"><Button asChild variant="outline"><Link href={`/sales/inventory/receipts/new?receipt=${receipt.id}`}>تعديل</Link></Button><Button disabled={working} className="bg-brand text-white hover:bg-brand-dark" onClick={async () => { setWorking(true); const result = await confirmProductReceipt(receipt.id, receipt.version, newInventoryCommandId()); setWorking(false); if (result.error) setMessage(result.error); else void load(); }}>تأكيد وإدخال المخزون</Button></div>}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="الوحدات" value={String(receipt.total_units)} icon={Boxes} /><MetricCard title="التكلفة" value={money(receipt.physical_total_cost, receipt.currency)} icon={WalletCards} /><MetricCard title="قيمة البيع المتوقعة" value={money(receipt.expected_sales_value, receipt.currency)} icon={ClipboardList} /><MetricCard title="الهامش المتوقع" value={money(receipt.expected_margin, receipt.currency)} icon={CheckCircle2} /></div>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>مجموعات المنتجات</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>SKU / الموديل</TableHead><TableHead>العدد</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع</TableHead><TableHead>الأرقام التسلسلية</TableHead></TableRow></TableHeader><TableBody>{receipt.lines?.map((line) => <TableRow key={line.id}><TableCell>{line.product_name_snapshot}</TableCell><TableCell>{line.sku_snapshot || line.model_snapshot || "-"}</TableCell><TableCell>{line.expected_quantity}</TableCell><TableCell>{money(line.unit_cost, line.currency)}</TableCell><TableCell>{money(line.planned_unit_sale_price, line.currency)}</TableCell><TableCell><details><summary className="cursor-pointer text-brand">عرض {line.serial_numbers?.length || 0}</summary><div className="mt-2 max-h-36 overflow-auto font-mono text-xs" dir="ltr">{line.serial_numbers?.map((serial) => <p key={serial}>{serial}</p>)}</div></details></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      {Boolean(receipt.sources?.length) && <Card className="border-none shadow-sm"><CardHeader><CardTitle>ملفات مصدر الاستلام</CardTitle></CardHeader><CardContent className="space-y-3">{receipt.sources?.map((source) => <div key={source.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{source.original_name || (source.source_type === "photo" ? "صورة المنتج" : "ملف الاستيراد")}</p><p className="mt-1 text-sm text-gray-500">{source.source_type.toUpperCase()} · {source.total_rows} {source.source_type === "photo" ? "مرشح" : "صف"} · {source.valid_rows + source.warning_rows} معتمد</p></div><Button variant="outline" onClick={async () => { const result = await openProductInventorySource(receipt.id, source.id); if (result.error) setMessage(result.error); }}>{source.source_type === "photo" ? <FileImage className="ml-2 h-4 w-4" /> : <FileSpreadsheet className="ml-2 h-4 w-4" />}فتح المصدر الأصلي</Button></div>)}</CardContent></Card>}
      <Card className="border-none shadow-sm"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm text-gray-500">حالة المحاسبة</p><div className="mt-2"><StatusBadge value={receipt.accounting_status} /></div></div>{editable && <Button variant="outline" className="text-red-600" disabled={working} onClick={async () => { const reason = window.prompt("اكتب سبب إلغاء السند"); if (!reason) return; setWorking(true); const result = await cancelProductReceipt(receipt.id, receipt.version, reason, newInventoryCommandId()); setWorking(false); if (result.error) setMessage(result.error); else router.push("/sales/inventory"); }}>إلغاء السند</Button>}</CardContent></Card>
    </div>
  );
}

export function FinanceProductInventoryScreen() {
  const [receipts, setReceipts] = useState<ProductReceipt[]>([]);
  const [inventory, setInventory] = useState<ProductInventoryStockRow[]>([]);
  const [sales, setSales] = useState<AgentProductSale[]>([]);
  const [collections, setCollections] = useState<AgentProductCollection[]>([]);
  const [losses, setLosses] = useState<Array<Record<string, unknown>>>([]);
  const [commissions, setCommissions] = useState<ProductAgentCommission[]>([]);
  const [exceptions, setExceptions] = useState<ProductInventoryAccountingPosting[]>([]);
  const [totals, setTotals] = useState({
    units: 0,
    cost: 0,
    expectedSales: 0,
    margin: 0,
    salesRevenue: 0,
    salesCost: 0,
    grossProfit: 0,
    vat: 0,
    collected: 0,
    outstanding: 0,
    consignmentUnits: 0,
    consignmentMemoCost: 0,
    companyOwnedSalesRevenue: 0,
    consignmentSalesRevenue: 0,
    commission: 0,
    commissionAccrued: 0,
    commissionSettled: 0,
    failedPostings: 0,
    pendingPostings: 0,
  });
  const [reconciliation, setReconciliation] = useState({
    stockUnits: 0,
    stockCost: 0,
    inventoryGlBalance: 0,
    inventoryDifference: 0,
    operationalAgentReceivable: 0,
    agentReceivableGlBalance: 0,
    agentReceivableDifference: 0,
    consignmentUnits: 0,
    consignmentMemoCost: 0,
    consignmentSalesRevenue: 0,
    collectionAllocationBlocked: false,
    balanced: false,
  });
  const [settingsData, setSettingsData] = useState<ProductInventoryAccountingSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState<Partial<ProductInventoryAccountingSettings>>({});
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name_ar: string; type: string }>>([]);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [inventoryResult, settingsResult] = await Promise.all([
      getFinanceProductInventory(),
      getProductInventoryAccountingSettings(),
    ]);
    if (inventoryResult.data) {
      setReceipts(inventoryResult.data.receipts);
      setInventory(inventoryResult.data.inventory);
      setSales(inventoryResult.data.sales);
      setCollections(inventoryResult.data.collections);
      setLosses(inventoryResult.data.losses);
      setCommissions(inventoryResult.data.commissions);
      setExceptions(inventoryResult.data.postingExceptions);
      setTotals(inventoryResult.data.totals);
      setReconciliation(inventoryResult.data.reconciliation);
    }
    if (settingsResult.data) {
      setSettingsData(settingsResult.data.settings);
      setSettingsForm(settingsResult.data.settings);
      setAccounts(settingsResult.data.accounts);
      setCanManageSettings(settingsResult.data.can_manage);
    }
    setMessage(inventoryResult.error || settingsResult.error || "");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    if (!settingsData) return;
    setWorking("settings");
    const result = await updateProductInventoryAccountingSettings({
      ...settingsForm,
      expected_version: settingsData.version,
    });
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage("تم حفظ إعدادات ترحيل مخزون المنتجات.");
    await load();
  };

  const retryPosting = async (posting: ProductInventoryAccountingPosting) => {
    setWorking(`${posting.source_type}:${posting.source_id}`);
    const result = await retryProductInventoryAccounting(posting.source_type, posting.source_id);
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage("تمت إعادة محاولة الترحيل بنجاح.");
    await load();
  };

  const settleCommission = async (commission: ProductAgentCommission) => {
    const bankTransfer = window.confirm("اضغط «موافق» للسداد البنكي، أو «إلغاء» للسداد النقدي.");
    const reference = window.prompt("مرجع السداد (اختياري):") || "";
    setWorking(`commission:${commission.id}`);
    const result = await settleProductAgentCommission(commission.id, {
      command_id: newInventoryCommandId(),
      payment_method: bankTransfer ? "bank_transfer" : "cash",
      payment_date: new Date().toISOString().slice(0, 10),
      payment_reference: reference,
      finance_notes: "سداد عمولة بيع منتج مسلسلة من شاشة مطابقة المخزون.",
    });
    setWorking("");
    if (result.error) return setMessage(result.error);
    setMessage("تم سداد العمولة وإنشاء قيد الدفع المرتبط.");
    await load();
  };

  if (loading) return <PageSkeleton />;
  const accountFields: Array<[keyof ProductInventoryAccountingSettings, string, string]> = [
    ["default_inventory_asset_id", "حساب أصل المخزون", "asset"],
    ["default_inventory_grni_id", "بضاعة مستلمة غير مفوترة (GRNI)", "liability"],
    ["default_inventory_cogs_id", "تكلفة مبيعات المنتجات", "expense"],
    ["default_inventory_shrinkage_id", "فاقد وتلف المخزون", "expense"],
    ["default_agent_receivable_id", "ذمم مندوبي المنتجات", "asset"],
    ["default_accounts_payable_id", "ذمم الموردين", "liability"],
    ["default_sales_revenue_id", "إيرادات المنتجات", "revenue"],
    ["default_vat_payable_id", "ضريبة المخرجات", "liability"],
    ["default_cash_account_id", "النقدية", "asset"],
    ["default_bank_account_id", "البنك", "asset"],
    ["default_commission_expense_id", "مصروف عمولة المندوب", "expense"],
    ["default_commission_payable_id", "عمولة المندوب المستحقة", "liability"],
  ];
  const activeInventoryStatuses = new Set([
    "in_stock",
    "reserved",
    "in_transit",
    "with_agent",
    "returned",
    "quarantine",
    "damaged",
  ]);
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold text-gray-950">مخزون المنتجات — المالية</h1><p className="mt-2 text-gray-500">قيمة المخزون والبيع والتحصيل والفاقد مترابطة تلقائياً مع القيود العامة، مع مطابقة وتشخيص قابل لإعادة المحاولة.</p></div>
        <Button variant="outline" onClick={() => void load()}><RefreshCcw className="ml-2 h-4 w-4" />تحديث ومطابقة</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="وحدات المخزون والعهد" value={String(totals.units)} icon={Boxes} /><MetricCard title="تكلفة المخزون الحالية" value={money(totals.cost)} icon={WalletCards} /><MetricCard title="مبيعات المنتجات الفعلية" value={money(totals.salesRevenue)} icon={ClipboardList} /><MetricCard title="مجمل ربح المبيعات" value={money(totals.grossProfit)} icon={CheckCircle2} /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="قيمة البيع المخططة للمخزون" value={money(totals.expectedSales)} icon={ClipboardList} /><MetricCard title="تكلفة الوحدات المباعة" value={money(totals.salesCost)} icon={WalletCards} /><MetricCard title="المحصل من المندوبين" value={money(totals.collected)} icon={CheckCircle2} /><MetricCard title="المتبقي على المندوبين" value={money(totals.outstanding)} icon={WalletCards} /></div>

      <Card className={reconciliation.balanced ? "border-emerald-200 shadow-sm" : "border-amber-200 shadow-sm"}>
        <CardHeader><CardTitle className="flex items-center gap-2">{reconciliation.balanced ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}مطابقة التشغيل مع دفتر الأستاذ</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-gray-50 p-4"><p className="text-sm text-gray-500">المخزون المملوك: تشغيل / دفتر</p><p className="mt-2 font-bold">{money(reconciliation.stockCost)} / {money(reconciliation.inventoryGlBalance)}</p><p className={Math.abs(reconciliation.inventoryDifference) < 0.01 ? "mt-1 text-sm text-emerald-700" : "mt-1 text-sm text-amber-700"}>الفرق {money(reconciliation.inventoryDifference)}</p></div>
          <div className="rounded-xl bg-gray-50 p-4"><p className="text-sm text-gray-500">ذمم المندوبين: تشغيل / دفتر</p><p className="mt-2 font-bold">{money(reconciliation.operationalAgentReceivable)} / {money(reconciliation.agentReceivableGlBalance)}</p><p className={Math.abs(reconciliation.agentReceivableDifference) < 0.01 ? "mt-1 text-sm text-emerald-700" : "mt-1 text-sm text-amber-700"}>الفرق {money(reconciliation.agentReceivableDifference)}</p></div>
          <div className="rounded-xl bg-blue-50 p-4"><p className="text-sm text-blue-700">عهدة ومبيعات المورد (مذكرة فقط)</p><p className="mt-2 font-bold">{reconciliation.consignmentUnits} وحدة · {money(reconciliation.consignmentMemoCost)}</p><p className="mt-1 text-sm font-medium text-blue-800">مبيعات عهدة {money(reconciliation.consignmentSalesRevenue)}</p><p className="mt-1 text-xs text-blue-700">{reconciliation.collectionAllocationBlocked ? "تحصيل المندوب موقوف محاسبياً حتى اعتماد توزيع مبيعات العهدة." : "مستبعدة من أصل مخزون الشركة."}</p></div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />استثناءات وطابور الترحيل ({exceptions.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table><TableHeader><TableRow><TableHead>المصدر</TableHead><TableHead>الحالة</TableHead><TableHead>المحاولات</TableHead><TableHead>آخر خطأ</TableHead><TableHead>القيد</TableHead><TableHead /></TableRow></TableHeader><TableBody>{exceptions.map((posting) => <TableRow key={`${posting.source_type}:${posting.source_id}`}><TableCell><span className="font-medium">{posting.source_type}</span><p className="font-mono text-xs text-gray-400">{posting.source_id}</p></TableCell><TableCell><StatusBadge value={posting.status} /></TableCell><TableCell>{posting.attempt_count || 0}</TableCell><TableCell className="max-w-sm text-sm text-red-700">{posting.last_error || "بانتظار العامل الخلفي أو اعتماد القيد"}</TableCell><TableCell>{posting.journal?.entry_no || "-"}</TableCell><TableCell><Button size="sm" variant="outline" disabled={working === `${posting.source_type}:${posting.source_id}` || posting.status === "pending_approval"} onClick={() => void retryPosting(posting)}><RefreshCcw className="ml-1 h-4 w-4" />إعادة المحاولة</Button></TableCell></TableRow>)}</TableBody></Table>
          {exceptions.length === 0 && <p className="p-6 text-center text-sm text-emerald-700">لا توجد حركات فاشلة أو معلقة.</p>}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle>عمولات مندوبي المنتجات</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-amber-50 p-4"><p className="text-sm text-amber-700">عمولات مستحقة</p><p className="mt-1 text-2xl font-bold">{money(totals.commissionAccrued)}</p></div><div className="rounded-lg bg-emerald-50 p-4"><p className="text-sm text-emerald-700">عمولات مسددة</p><p className="mt-1 text-2xl font-bold">{money(totals.commissionSettled)}</p></div></div>
          <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>المندوب</TableHead><TableHead>المبيعة</TableHead><TableHead>المبلغ</TableHead><TableHead>الحالة</TableHead><TableHead /></TableRow></TableHeader><TableBody>{commissions.map((commission) => <TableRow key={commission.id}><TableCell>{commission.agent?.full_name || "-"}</TableCell><TableCell className="font-mono">{commission.sale?.sale_no || commission.sale_id}</TableCell><TableCell>{money(commission.commission_amount, commission.currency)}</TableCell><TableCell><StatusBadge value={commission.status} /></TableCell><TableCell>{commission.status === "accrued" && canManageSettings ? <Button size="sm" disabled={working === `commission:${commission.id}`} onClick={() => void settleCommission(commission)}>سداد وربط القيد</Button> : "-"}</TableCell></TableRow>)}</TableBody></Table>{commissions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">لا توجد عمولات منتجات مثبتة.</p>}</div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-brand" />إعدادات ترحيل مخزون المنتجات</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accountFields.map(([key, label, type]) => <div key={key} className="space-y-2"><Label>{label}</Label><select disabled={!canManageSettings} className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={String(settingsForm[key] || "")} onChange={(event) => setSettingsForm((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر الحساب</option>{accounts.filter((account) => account.type === type).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name_ar}</option>)}</select></div>)}</div>
          <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
            {([
              ["auto_post_inventory_receipts", "ترحيل الاستلامات مباشرة (بدلاً من انتظار الاعتماد)"],
              ["auto_post_product_sales", "ترحيل مبيعات المنتجات مباشرة"],
              ["auto_post_product_collections", "ترحيل تحصيلات المندوبين مباشرة"],
              ["enable_product_agent_commissions", "إثبات عمولة المندوب المستحقة مع البيع"],
            ] as Array<[keyof ProductInventoryAccountingSettings, string]>).map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={!canManageSettings} checked={Boolean(settingsForm[key])} onChange={(event) => setSettingsForm((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
          </div>
          {canManageSettings ? <Button disabled={working === "settings"} onClick={() => void saveSettings()}><Save className="ml-2 h-4 w-4" />حفظ الإعدادات</Button> : <p className="text-sm text-gray-500">عرض فقط؛ مدير المالية هو المخوّل بتغيير خرائط الحسابات.</p>}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm"><CardHeader><CardTitle>مبيعات المنتجات من المندوبين</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>البيع</TableHead><TableHead>المندوب</TableHead><TableHead>المنتج / المسلسل</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع</TableHead><TableHead>الربح</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{sales.slice(0, 250).map((sale) => <TableRow key={sale.id}><TableCell><span className="font-mono">{sale.sale_no}</span><br /><StatusBadge value={sale.status} /></TableCell><TableCell>{sale.agent?.full_name || "-"}</TableCell><TableCell>{sale.lines?.[0]?.product_name_snapshot || "-"}<p className="font-mono text-xs text-gray-400">{sale.lines?.[0]?.serial_snapshot}</p></TableCell><TableCell>{money(sale.lines?.[0]?.unit_cost_snapshot || 0)}</TableCell><TableCell>{money(sale.total_amount)}</TableCell><TableCell>{money(sale.lines?.[0]?.gross_profit || 0)}</TableCell><TableCell><StatusBadge value={sale.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{sales.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد مبيعات منتجات حتى الآن.</p>}</CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>المخزون الحالي والعهد</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>المسلسل</TableHead><TableHead>الملكية</TableHead><TableHead>الموقع / المندوب</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع المخطط</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>{inventory.filter((unit) => activeInventoryStatuses.has(unit.status)).slice(0, 250).map((unit) => <TableRow key={unit.id}><TableCell>{unit.product?.name || "-"}</TableCell><TableCell className="font-mono">{unit.raw_serial_number}</TableCell><TableCell>{unit.ownership_type === "consignment" ? "عهدة مورد" : "مملوك"}</TableCell><TableCell>{unit.agent?.full_name || unit.warehouse?.name_ar || "-"}</TableCell><TableCell>{money(unit.unit_cost_snapshot, unit.currency)}</TableCell><TableCell>{money(unit.planned_sale_price_snapshot, unit.currency)}</TableCell><TableCell><StatusBadge value={unit.status} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>تحصيلات المندوبين</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التحصيل</TableHead><TableHead>المندوب</TableHead><TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead><TableHead>الطريقة</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{collections.slice(0, 250).map((collection) => <TableRow key={collection.id}><TableCell className="font-mono">{collection.collection_no}</TableCell><TableCell>{collection.agent?.full_name || "-"}</TableCell><TableCell>{collection.collection_date}</TableCell><TableCell>{money(collection.amount)}</TableCell><TableCell>{collection.payment_method}</TableCell><TableCell><StatusBadge value={collection.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{collections.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد تحصيلات منتجات بعد.</p>}</CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>فاقد وتلف المخزون</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>المنتج / المسلسل</TableHead><TableHead>التكلفة</TableHead><TableHead>السبب</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{losses.map((loss) => <TableRow key={String(loss.id)}><TableCell>{loss.loss_type === "loss" ? "فقد" : "تلف"}</TableCell><TableCell>{String(loss.product_name_snapshot || "-")}<p className="font-mono text-xs">{String(loss.serial_snapshot || "")}</p></TableCell><TableCell>{money(Number(loss.unit_cost_snapshot || 0), String(loss.currency || "SAR"))}</TableCell><TableCell>{String(loss.reason || "-")}</TableCell><TableCell><StatusBadge value={String(loss.accounting_status)} /></TableCell></TableRow>)}</TableBody></Table>{losses.length === 0 && <p className="p-6 text-center text-sm text-gray-500">لا يوجد فاقد أو تلف مثبت.</p>}</CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>استلامات الموردين</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>السند</TableHead><TableHead>المورد</TableHead><TableHead>الملكية</TableHead><TableHead>الوحدات</TableHead><TableHead>التكلفة</TableHead><TableHead>قيمة البيع</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{receipts.slice(0, 250).map((receipt) => <TableRow key={receipt.id}><TableCell className="font-mono">{receipt.receipt_no}</TableCell><TableCell>{receipt.company?.name || "-"}</TableCell><TableCell>{receipt.ownership_type === "consignment" ? "عهدة مورد" : "شراء"}</TableCell><TableCell>{receipt.total_units}</TableCell><TableCell>{money(receipt.physical_total_cost, receipt.currency)}</TableCell><TableCell>{money(receipt.expected_sales_value, receipt.currency)}</TableCell><TableCell><StatusBadge value={receipt.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{receipts.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد استلامات مؤكدة حتى الآن.</p>}</CardContent></Card>
    </div>
  );
}
