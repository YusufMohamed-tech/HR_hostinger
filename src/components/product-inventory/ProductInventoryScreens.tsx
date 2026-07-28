"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Camera, CheckCircle2, ClipboardList, FileImage, FileSpreadsheet, PackagePlus, Plus, Send, Trash2, WalletCards } from "lucide-react";
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
  getProductInventorySetup,
  getProductReceipt,
  getProductReceipts,
  getProductStock,
  newInventoryCommandId,
  openProductInventorySource,
  saveManualReceipt,
} from "@/lib/services/product-inventory";
import type {
  AgentProductCollection,
  AgentProductSale,
  ProductInventoryCompany,
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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [receiptResult, stockResult] = await Promise.all([getProductReceipts(), getProductStock()]);
    if (receiptResult.data) setReceipts(receiptResult.data);
    if (stockResult.data) {
      setStock(stockResult.data.rows);
      setTotals(stockResult.data.totals);
    }
    setMessage(receiptResult.error || stockResult.error || "");
    setLoading(false);
  }, []);

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
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle>أحدث الوحدات المسلسلة</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الرقم التسلسلي</TableHead><TableHead>الموقع / العهدة</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع المخطط</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
            <TableBody>
              {stock.slice(0, 20).map((unit) => (
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
  const [totals, setTotals] = useState({ units: 0, cost: 0, expectedSales: 0, margin: 0, salesRevenue: 0, salesCost: 0, grossProfit: 0, vat: 0, collected: 0, outstanding: 0 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void getFinanceProductInventory().then((result) => {
      if (result.data) {
        setReceipts(result.data.receipts);
        setInventory(result.data.inventory);
        setSales(result.data.sales);
        setCollections(result.data.collections);
        setTotals(result.data.totals);
      }
      setMessage(result.error || "");
      setLoading(false);
    });
  }, []);
  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div><h1 className="text-3xl font-bold text-gray-950">مخزون المنتجات — المالية</h1><p className="mt-2 text-gray-500">التكلفة والمبيعات الفعلية والتحصيلات تصل تلقائياً من حركة المخزون. القيود العامة والترحيل التلقائي تُفعّل في المرحلة الخامسة.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="وحدات المخزون والعهد" value={String(totals.units)} icon={Boxes} /><MetricCard title="تكلفة المخزون الحالية" value={money(totals.cost)} icon={WalletCards} /><MetricCard title="مبيعات المنتجات الفعلية" value={money(totals.salesRevenue)} icon={ClipboardList} /><MetricCard title="مجمل ربح المبيعات" value={money(totals.grossProfit)} icon={CheckCircle2} /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="قيمة البيع المخططة للمخزون" value={money(totals.expectedSales)} icon={ClipboardList} /><MetricCard title="تكلفة الوحدات المباعة" value={money(totals.salesCost)} icon={WalletCards} /><MetricCard title="المحصل من المندوبين" value={money(totals.collected)} icon={CheckCircle2} /><MetricCard title="المتبقي على المندوبين" value={money(totals.outstanding)} icon={WalletCards} /></div>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>مبيعات المنتجات من المندوبين</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>البيع</TableHead><TableHead>المندوب</TableHead><TableHead>المنتج / المسلسل</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع</TableHead><TableHead>الربح</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{sales.map((sale) => <TableRow key={sale.id}><TableCell><span className="font-mono">{sale.sale_no}</span><br /><StatusBadge value={sale.status} /></TableCell><TableCell>{sale.agent?.full_name || "-"}</TableCell><TableCell>{sale.lines?.[0]?.product_name_snapshot || "-"}<p className="font-mono text-xs text-gray-400">{sale.lines?.[0]?.serial_snapshot}</p></TableCell><TableCell>{money(sale.lines?.[0]?.unit_cost_snapshot || 0)}</TableCell><TableCell>{money(sale.total_amount)}</TableCell><TableCell>{money(sale.lines?.[0]?.gross_profit || 0)}</TableCell><TableCell><StatusBadge value={sale.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{sales.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد مبيعات منتجات حتى الآن.</p>}</CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>المخزون الحالي والعهد</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>المسلسل</TableHead><TableHead>الموقع / المندوب</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع المخطط</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>{inventory.filter((unit) => ["in_stock", "in_transit", "with_agent", "returned"].includes(unit.status)).slice(0, 250).map((unit) => <TableRow key={unit.id}><TableCell>{unit.product?.name || "-"}</TableCell><TableCell className="font-mono">{unit.raw_serial_number}</TableCell><TableCell>{unit.agent?.full_name || unit.warehouse?.name_ar || "-"}</TableCell><TableCell>{money(unit.unit_cost_snapshot, unit.currency)}</TableCell><TableCell>{money(unit.planned_sale_price_snapshot, unit.currency)}</TableCell><TableCell><StatusBadge value={unit.status} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle>تحصيلات المندوبين</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التحصيل</TableHead><TableHead>المندوب</TableHead><TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead><TableHead>الطريقة</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{collections.map((collection) => <TableRow key={collection.id}><TableCell className="font-mono">{collection.collection_no}</TableCell><TableCell>{collection.agent?.full_name || "-"}</TableCell><TableCell>{collection.collection_date}</TableCell><TableCell>{money(collection.amount)}</TableCell><TableCell>{collection.payment_method}</TableCell><TableCell><StatusBadge value={collection.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{collections.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد تحصيلات منتجات بعد.</p>}</CardContent></Card>
      <Card className="border-none shadow-sm"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>السند</TableHead><TableHead>المورد</TableHead><TableHead>الوحدات</TableHead><TableHead>التكلفة</TableHead><TableHead>قيمة البيع</TableHead><TableHead>الهامش</TableHead><TableHead>المعالجة</TableHead></TableRow></TableHeader><TableBody>{receipts.map((receipt) => <TableRow key={receipt.id}><TableCell className="font-mono">{receipt.receipt_no}</TableCell><TableCell>{receipt.company?.name || "-"}</TableCell><TableCell>{receipt.total_units}</TableCell><TableCell>{money(receipt.physical_total_cost, receipt.currency)}</TableCell><TableCell>{money(receipt.expected_sales_value, receipt.currency)}</TableCell><TableCell>{money(receipt.expected_margin, receipt.currency)}</TableCell><TableCell><StatusBadge value={receipt.accounting_status} /></TableCell></TableRow>)}</TableBody></Table>{receipts.length === 0 && <p className="p-8 text-center text-sm text-gray-500">لا توجد استلامات مؤكدة حتى الآن.</p>}</CardContent></Card>
    </div>
  );
}
