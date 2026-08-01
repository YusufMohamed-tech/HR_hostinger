"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, ScanLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { PageSkeleton } from "@/components/Skeletons";
import { useRoleContext } from "@/providers/RoleProvider";
import { normalizeSerial } from "@/lib/product-inventory/normalization";
import {
  enhanceProductPhotoForOcr,
  LocalOcrProductExtractionProvider,
  type ProductPhotoRawExtraction,
} from "@/lib/product-inventory/photo-extraction";
import {
  commitProductInventoryPhotos,
  getProductInventorySetup,
  newInventoryCommandId,
  previewProductInventoryPhotos,
} from "@/lib/services/product-inventory";
import type {
  ProductInventoryCompany,
  ProductInventoryPhotoCandidate,
  ProductInventoryPhotoPreview,
  ProductInventoryProduct,
  ProductInventoryWarehouse,
} from "@/types/product-inventory";

type SelectedPhoto = {
  sourceId: string;
  managedFileId: string;
  file: File;
  previewUrl: string;
  extraction: ProductPhotoRawExtraction | null;
};

function statusLabel(status: ProductInventoryPhotoCandidate["status"]) {
  return {
    valid: "صالح",
    warning: "مراجعة",
    invalid: "غير صالح",
    duplicate: "مكرر",
    unmatched: "غير مطابق",
  }[status];
}

function statusClass(status: ProductInventoryPhotoCandidate["status"]) {
  return status === "valid"
    ? "border-green-200 bg-green-50 text-green-700"
    : status === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
}

function validateCandidates(
  candidates: ProductInventoryPhotoCandidate[],
  products: ProductInventoryProduct[]
) {
  const productIds = new Set(products.map((product) => product.id));
  const serialCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const serial = normalizeSerial(candidate.serial_number);
    if (serial) serialCounts.set(serial, (serialCounts.get(serial) ?? 0) + 1);
  }
  return candidates.map((candidate) => {
    const serial = normalizeSerial(candidate.serial_number);
    const serialUnchanged = serial === candidate.normalized_serial;
    const errors: string[] = [];
    if (serialUnchanged) {
      errors.push(...candidate.validation_errors.filter((error) => error.includes("confirmed stock")));
    }
    if (!productIds.has(candidate.product_id)) errors.push("اختر منتجاً صالحاً.");
    if (!serial) errors.push("أدخل الرقم التسلسلي.");
    if (/^[=+@]/u.test(candidate.serial_number.trim())) errors.push("صيغة الرقم التسلسلي غير مسموحة.");
    if (serial && (serialCounts.get(serial) ?? 0) > 1) errors.push("الرقم التسلسلي مكرر في الصور.");
    if (!candidate.unit_cost || candidate.unit_cost <= 0) errors.push("تكلفة الوحدة مطلوبة.");
    if (!candidate.planned_sale_price || candidate.planned_sale_price <= 0) {
      errors.push("سعر البيع المخطط مطلوب.");
    }
    const minimumSalePrice = candidate.minimum_sale_price ?? candidate.planned_sale_price;
    const maximumSalePrice = candidate.maximum_sale_price ?? candidate.planned_sale_price;
    if (!minimumSalePrice || !maximumSalePrice || !candidate.planned_sale_price
        || minimumSalePrice > candidate.planned_sale_price
        || candidate.planned_sale_price > maximumSalePrice) {
      errors.push("سعر البيع يجب أن يقع بين الحد الأدنى والحد الأعلى.");
    }
    const commissionValue = candidate.commission_value ?? 0;
    if (commissionValue < 0
        || (candidate.commission_type === "none" && commissionValue !== 0)
        || (candidate.commission_type === "percentage" && commissionValue > 100)) {
      errors.push("قاعدة العمولة غير صالحة.");
    }
    if (!/^[A-Z]{3}$/u.test(candidate.currency)) errors.push("رمز العملة غير صالح.");
    const warnings = candidate.validation_warnings.filter((warning) =>
      warning.includes("another draft") ? serialUnchanged : false
    );
    if (candidate.confidence < 0.9) {
      warnings.push("ثقة الاستخراج أقل من 90%؛ راجع المنتج والرقم التسلسلي.");
    }
    const uniqueWarnings = [...new Set(warnings)];
    return {
      ...candidate,
      normalized_serial: serial,
      validation_errors: errors,
      validation_warnings: uniqueWarnings,
      status: errors.length > 0
        ? errors.some((error) => error.includes("مكرر")) ? "duplicate"
          : candidate.product_id ? "invalid" : "unmatched"
        : uniqueWarnings.length > 0 ? "warning" : "valid",
    } as ProductInventoryPhotoCandidate;
  });
}

export function ProductInventoryPhotoScreen() {
  const router = useRouter();
  const { currentUser } = useRoleContext();
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
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const photosRef = useRef<SelectedPhoto[]>([]);
  const [preview, setPreview] = useState<ProductInventoryPhotoPreview | null>(null);
  const [candidates, setCandidates] = useState<ProductInventoryPhotoCandidate[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [warningsAccepted, setWarningsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [receiptId] = useState(() => crypto.randomUUID());
  const [commandId] = useState(() => crypto.randomUUID());

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

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
  }, []);

  const supplierProducts = useMemo(
    () => products.filter((product) => product.company_id === companyId),
    [companyId, products]
  );
  const isAliasManager = ["Admin", "Finance_Manager"].includes(
    currentUser?.role || ""
  );
  const counts = useMemo(() => candidates.reduce((value, candidate) => {
    value[candidate.status] += 1;
    return value;
  }, { valid: 0, warning: 0, invalid: 0, duplicate: 0, unmatched: 0 }), [candidates]);
  const blockingCount = counts.invalid + counts.duplicate + counts.unmatched;
  const warningCount = counts.warning;
  const groups = useMemo(() => {
    const grouped = new Map<string, {
      product: string;
      count: number;
      unitCost: number;
      salePrice: number;
      commission: number;
      totalCost: number;
      totalSales: number;
    }>();
    for (const candidate of candidates.filter((item) => ["valid", "warning"].includes(item.status))) {
      const product = supplierProducts.find((item) => item.id === candidate.product_id);
      const key = [
        candidate.product_id,
        candidate.unit_cost,
        candidate.planned_sale_price,
        candidate.minimum_sale_price,
        candidate.maximum_sale_price,
        candidate.commission_type,
        candidate.commission_value,
        candidate.commission_base,
        candidate.currency,
        candidate.condition,
      ].join(":");
      const current = grouped.get(key) ?? {
        product: product?.name || candidate.raw_product_name || "منتج",
        count: 0,
        unitCost: candidate.unit_cost || 0,
        salePrice: candidate.planned_sale_price || 0,
        commission: candidate.commission_type === "flat"
          ? candidate.commission_value || 0
          : candidate.commission_type === "percentage"
            ? (candidate.planned_sale_price || 0) * (candidate.commission_value || 0) / 100
            : 0,
        totalCost: 0,
        totalSales: 0,
      };
      current.count += 1;
      current.totalCost += candidate.unit_cost || 0;
      current.totalSales += candidate.planned_sale_price || 0;
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }, [candidates, supplierProducts]);

  const selectPhotos = (files: FileList | null) => {
    if (!files) return;
    const selected = [...files];
    if (selected.length < 1 || selected.length > 8) {
      setMessage("اختر من صورة واحدة إلى 8 صور.");
      return;
    }
    for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    setPhotos(selected.map((file) => ({
      sourceId: crypto.randomUUID(),
      managedFileId: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      extraction: null,
    })));
    setPreview(null);
    setCandidates([]);
  };

  const updateCandidate = (
    sourceId: string,
    candidateIndex: number,
    changes: Partial<ProductInventoryPhotoCandidate>
  ) => {
    setCandidates((current) => validateCandidates(
      current.map((candidate) =>
        candidate.source_id === sourceId && candidate.candidate_index === candidateIndex
          ? { ...candidate, ...changes }
          : candidate
      ),
      supplierProducts
    ));
    setWarningsAccepted(false);
  };

  const runExtraction = async () => {
    if (!companyId || !warehouseId || photos.length === 0) {
      setMessage("اختر المورد والمستودع وصورة منتج واحدة على الأقل.");
      return;
    }
    setWorking(true);
    setMessage("");
    const extractedPhotos: SelectedPhoto[] = [];
    try {
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        if (!photo) continue;
        setProgress(`استخراج الصورة ${index + 1} من ${photos.length}`);
        const input = enhance ? await enhanceProductPhotoForOcr(photo.file) : photo.file;
        const extraction = await new LocalOcrProductExtractionProvider().extract(input);
        extractedPhotos.push({ ...photo, extraction });
      }
      setPhotos(extractedPhotos);
      setProgress("فحص الصور وحفظ الأدلة...");
      const result = await previewProductInventoryPhotos(receiptId, {
        command_id: commandId,
        supplier_company_id: companyId,
        warehouse_id: warehouseId,
        ownership_type: ownershipType,
        receipt_date: receiptDate,
        currency: "SAR",
        delivery_note_no: deliveryNote,
        supplier_invoice_no: supplierInvoice,
        notes,
        photos: extractedPhotos.map((photo) => ({
          file: photo.file,
          source_id: photo.sourceId,
          managed_file_id: photo.managedFileId,
          extraction: photo.extraction!,
        })),
      });
      if (result.error || !result.data) {
        setMessage(result.error || "تعذر إنشاء معاينة الصور.");
        return;
      }
      setPreview(result.data);
      setCandidates(result.data.candidates);
    } catch (error) {
      setMessage(error instanceof Error
        ? `تعذر تشغيل الاستخراج المحلي: ${error.message}`
        : "تعذر تشغيل الاستخراج المحلي.");
    } finally {
      setWorking(false);
      setProgress("");
    }
  };

  const commit = async () => {
    const checked = validateCandidates(candidates, supplierProducts);
    setCandidates(checked);
    const invalid = checked.filter((candidate) => !["valid", "warning"].includes(candidate.status));
    if (!preview || invalid.length > 0) {
      setMessage(`صحح كل المرشحين أولاً. يوجد ${invalid.length} مرشح غير صالح.`);
      return;
    }
    if (checked.some((candidate) => candidate.status === "warning") && !warningsAccepted) {
      setMessage("راجع التحذيرات ووافق عليها صراحة قبل اعتماد الصور.");
      return;
    }
    setWorking(true);
    const result = await commitProductInventoryPhotos(receiptId, {
      expected_version: preview.receipt.version,
      command_id: newInventoryCommandId(),
      warnings_accepted: warningsAccepted,
      candidates: checked,
    });
    setWorking(false);
    if (result.error) return setMessage(result.error);
    router.push(`/sales/inventory/receipts/${receiptId}`);
  };

  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div>
        <h1 className="text-3xl font-bold text-gray-950">استلام المنتجات بالصور</h1>
        <p className="mt-2 text-gray-500">التعرّف يعمل محلياً في جهازك باستخدام OCR والباركود، ثم تُحفظ الصورة الأصلية كدليل خاص.</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label>شركة المورد *</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 disabled:bg-gray-100" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="space-y-2"><Label>المستودع *</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 disabled:bg-gray-100" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_ar}</option>)}</select></div>
          <div className="space-y-2"><Label>نوع الملكية</Label><select disabled={Boolean(preview)} className="h-10 w-full rounded-lg border bg-white px-3 disabled:bg-gray-100" value={ownershipType} onChange={(event) => setOwnershipType(event.target.value as "purchased" | "consignment")}><option value="purchased">مشتريات مملوكة</option><option value="consignment">عهدة من المورد</option></select></div>
          <div className="space-y-2"><Label>تاريخ الاستلام *</Label><Input disabled={Boolean(preview)} type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></div>
          <div className="space-y-2"><Label>رقم إذن التسليم</Label><Input disabled={Boolean(preview)} value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} /></div>
          <div className="space-y-2"><Label>فاتورة المورد</Label><Input disabled={Boolean(preview)} value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label>ملاحظات</Label><Input disabled={Boolean(preview)} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <Label>التقاط أو رفع 1–8 صور JPEG / PNG / WebP *</Label>
            <Input disabled={Boolean(preview) || working} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={(event) => selectPhotos(event.target.files)} />
          </div>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input disabled={Boolean(preview)} type="checkbox" checked={enhance} onChange={(event) => setEnhance(event.target.checked)} />تحسين التباين للصورة المستخدمة في OCR</label>
        </CardContent>
      </Card>

      {photos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {photos.map((photo) => (
            <Card key={photo.sourceId} className="overflow-hidden border-none shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={photo.file.name} className="h-44 w-full object-cover" />
              <CardContent className="p-4"><p className="truncate text-sm font-medium">{photo.file.name}</p><p className="mt-1 text-xs text-gray-500">{(photo.file.size / 1024 / 1024).toFixed(2)} MB</p>{!preview && <Button className="mt-3" variant="outline" size="sm" onClick={() => { URL.revokeObjectURL(photo.previewUrl); setPhotos((current) => current.filter((item) => item.sourceId !== photo.sourceId)); }}><Trash2 className="ml-2 h-4 w-4" />إزالة</Button>}</CardContent>
            </Card>
          ))}
        </div>
      )}

      {!preview && (
        <div className="flex justify-end">
          <Button disabled={working || photos.length === 0} className="bg-brand text-white hover:bg-brand-dark" onClick={() => void runExtraction()}>
            <ScanLine className="ml-2 h-4 w-4" />{working ? progress || "جاري الاستخراج..." : "استخراج ومعاينة الصور"}
          </Button>
        </div>
      )}

      {preview && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {([
              ["صالح", counts.valid, "text-green-700"],
              ["تحذير", counts.warning, "text-amber-700"],
              ["غير صالح", counts.invalid, "text-red-700"],
              ["مكرر", counts.duplicate, "text-red-700"],
              ["غير مطابق", counts.unmatched, "text-red-700"],
            ] as const).map(([label, value, color]) => <Card key={label}><CardContent className="p-4"><p className={`text-sm ${color}`}>{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>)}
          </div>

          <div className="space-y-4">
            {candidates.map((candidate) => {
              const photo = photos.find((item) => item.sourceId === candidate.source_id);
              return (
                <Card key={`${candidate.source_id}:${candidate.candidate_index}`} className={["valid", "warning"].includes(candidate.status) ? "border-none shadow-sm" : "border-red-200"}>
                  <CardContent className="grid gap-4 p-5 lg:grid-cols-[150px_1fr]">
                    {photo && (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.previewUrl} alt="" className="h-32 w-full rounded-lg object-cover" />
                        <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">نص OCR الخام</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap" dir="ltr">{photo.extraction?.raw_text || "-"}</pre></details>
                      </div>
                    )}
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={statusClass(candidate.status)}>{statusLabel(candidate.status)}</Badge><Badge variant="outline">الثقة {Math.round(candidate.confidence * 100)}%</Badge><span className="text-xs text-gray-500">المطابقة: {candidate.match_method}</span></div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <div className="space-y-1 xl:col-span-2"><Label>المنتج *</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={candidate.product_id} onChange={(event) => { const selected = supplierProducts.find((product) => product.id === event.target.value); const salePrice = candidate.planned_sale_price || selected?.price || null; updateCandidate(candidate.source_id, candidate.candidate_index, { product_id: event.target.value, unit_cost: candidate.unit_cost || selected?.default_cost || null, planned_sale_price: salePrice, minimum_sale_price: candidate.minimum_sale_price || salePrice, maximum_sale_price: candidate.maximum_sale_price || salePrice, commission_type: candidate.commission_type === "none" ? selected?.agent_commission_type || "none" : candidate.commission_type, commission_value: candidate.commission_value || selected?.agent_commission_value || 0 }); }}><option value="">اختر المنتج</option>{supplierProducts.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` — ${product.sku}` : ""}</option>)}</select><p className="text-xs text-gray-500">النص المستخرج: {candidate.raw_product_name || candidate.raw_sku || "-"}</p></div>
                        <div className="space-y-1"><Label>الرقم التسلسلي *</Label><Input dir="ltr" className="font-mono" value={candidate.serial_number} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { serial_number: event.target.value })} /></div>
                        <div className="space-y-1"><Label>تكلفة الوحدة *</Label><Input type="number" min="0.01" step="0.01" value={candidate.unit_cost ?? ""} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { unit_cost: Number(event.target.value) || null })} /></div>
                        <div className="space-y-1"><Label>سعر البيع *</Label><Input type="number" min="0.01" step="0.01" value={candidate.planned_sale_price ?? ""} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { planned_sale_price: Number(event.target.value) || null })} /></div>
                        <div className="space-y-1"><Label>أقل سعر *</Label><Input type="number" min="0.01" step="0.01" value={candidate.minimum_sale_price ?? ""} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { minimum_sale_price: Number(event.target.value) || null })} /></div>
                        <div className="space-y-1"><Label>أعلى سعر *</Label><Input type="number" min="0.01" step="0.01" value={candidate.maximum_sale_price ?? ""} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { maximum_sale_price: Number(event.target.value) || null })} /></div>
                        <div className="space-y-1"><Label>نوع العمولة</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={candidate.commission_type} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { commission_type: event.target.value as ProductInventoryPhotoCandidate["commission_type"], commission_value: event.target.value === "none" ? 0 : candidate.commission_value })}><option value="none">بدون</option><option value="flat">مبلغ ثابت</option><option value="percentage">نسبة</option></select></div>
                        <div className="space-y-1"><Label>قيمة العمولة</Label><Input type="number" min="0" step="0.01" disabled={candidate.commission_type === "none"} value={candidate.commission_value ?? 0} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { commission_value: Number(event.target.value) || 0 })} /></div>
                        <div className="space-y-1"><Label>أساس العمولة</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={candidate.commission_base} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { commission_base: event.target.value as ProductInventoryPhotoCandidate["commission_base"] })}><option value="net_amount">صافي البيع</option><option value="gross_amount">إجمالي البيع</option></select></div>
                        <div className="space-y-1"><Label>العملة</Label><Input maxLength={3} value={candidate.currency} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { currency: event.target.value.toUpperCase() })} /></div>
                        <div className="space-y-1"><Label>الحالة</Label><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={candidate.condition} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { condition: event.target.value as ProductInventoryPhotoCandidate["condition"] })}><option value="new">جديد</option><option value="open_box">مفتوح</option><option value="refurbished">مجدد</option></select></div>
                      </div>
                      {isAliasManager && candidate.raw_product_name && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={candidate.save_as_alias} onChange={(event) => updateCandidate(candidate.source_id, candidate.candidate_index, { save_as_alias: event.target.checked })} />اعتماد “{candidate.raw_product_name}” كاسم بديل لهذا المنتج</label>}
                      <div className="space-y-1 text-sm">{candidate.validation_errors.map((error) => <p key={error} className="flex gap-2 text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>)}{candidate.validation_warnings.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-none shadow-sm"><CardHeader><CardTitle>المجموعات التي ستنشأ</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{groups.map((group, index) => <div key={`${group.product}:${index}`} className="rounded-lg border p-4"><p className="font-semibold">{group.product}</p><p className="mt-2 text-sm text-gray-600">{group.count} وحدة · تكلفة {group.totalCost.toFixed(2)} · بيع متوقع {group.totalSales.toFixed(2)}</p><p className="mt-1 text-xs text-gray-500">للوحدة: {group.unitCost.toFixed(2)} / {group.salePrice.toFixed(2)} · عمولة {group.commission.toFixed(2)}</p></div>)}</CardContent></Card>

          {warningCount > 0 && <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><input className="mt-1" type="checkbox" checked={warningsAccepted} onChange={(event) => setWarningsAccepted(event.target.checked)} /><span><span className="font-semibold">راجعت وأوافق على {warningCount} تحذير</span><span className="mt-1 block text-sm text-gray-600">الثقة لا تتجاوز التحقق من المنتج أو الرقم التسلسلي؛ التصريح يُحفظ مع المراجعة.</span></span></label>}

          <Card className={blockingCount === 0 ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{blockingCount === 0 ? <CheckCircle2 className="h-6 w-6 text-green-700" /> : <AlertTriangle className="h-6 w-6 text-amber-700" />}<div><p className="font-semibold">{blockingCount === 0 ? "المرشحون جاهزون للتجميع" : `${blockingCount} مرشح يحتاج تصحيحاً`}</p><p className="text-sm text-gray-600">اعتماد الصور يجهّز السند؛ إدخال المخزون يحدث فقط بعد التأكيد النهائي.</p></div></div><div className="flex gap-2"><Button variant="outline" asChild><Link href="/sales/inventory">العودة</Link></Button><Button disabled={working || blockingCount > 0 || (warningCount > 0 && !warningsAccepted)} className="bg-brand text-white hover:bg-brand-dark" onClick={() => void commit()}><Camera className="ml-2 h-4 w-4" />{working ? "جاري الاعتماد..." : "اعتماد الصور وتجهيز السند"}</Button></div></CardContent></Card>
        </>
      )}
    </div>
  );
}
