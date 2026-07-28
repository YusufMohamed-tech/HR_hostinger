import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import {
  parseProductPhotoExtraction,
  PRODUCT_PHOTO_EXTRACTION_VERSION,
} from "@/lib/product-inventory/photo-extraction";

type RouteContext = { params: Promise<{ receiptId: string }> };
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const headerSchema = z.object({
  command_id: z.string().uuid(),
  supplier_company_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  ownership_type: z.enum(["purchased", "consignment"]),
  receipt_date: z.iso.date(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("SAR"),
  delivery_note_no: z.string().trim().max(120).default(""),
  supplier_invoice_no: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(2000).default(""),
});

const boundingBoxSchema = z.object({
  text: z.string().max(160),
  confidence: z.number().min(0).max(100),
  x0: z.number().finite(),
  y0: z.number().finite(),
  x1: z.number().finite(),
  y1: z.number().finite(),
});

const manifestSchema = z.array(z.object({
  field: z.string().regex(/^photo_\d+$/u),
  source_id: z.string().uuid(),
  managed_file_id: z.string().uuid(),
  extraction: z.object({
    raw_text: z.string().max(50_000),
    ocr_confidence: z.number().min(0).max(100).nullable(),
    barcode_values: z.array(z.string().trim().min(1).max(160)).max(20),
    bounding_boxes: z.array(boundingBoxSchema).max(300),
    engine: z.literal("tesseract-zxing-local"),
    version: z.literal(PRODUCT_PHOTO_EXTRACTION_VERSION),
  }),
})).min(1).max(8);

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 10 * 1024 * 1024;
const maxTotalBytes = 40 * 1024 * 1024;

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/gu, "_").slice(0, 160) || "product-photo";
}

function firstRecord(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

async function existingSerials(
  db: ReturnType<typeof productInventoryDb>,
  table: string,
  column: string,
  serials: string[],
  orgId: string,
  excludeReceiptId?: string
) {
  const found = new Set<string>();
  for (let index = 0; index < serials.length; index += 400) {
    let query = db.from(table).select(column)
      .eq("organization_id", orgId)
      .in(column, serials.slice(index, index + 400));
    if (excludeReceiptId) query = query.neq("receipt_id", excludeReceiptId);
    const result = await query;
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    for (const row of result.data ?? []) found.add(String(row[column]));
  }
  return found;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;
  const formData = await request.formData();
  const rawHeader = Object.fromEntries([
    "command_id", "supplier_company_id", "warehouse_id", "ownership_type",
    "receipt_date", "currency", "delivery_note_no", "supplier_invoice_no", "notes",
  ].map((key) => [key, formData.get(key)]));
  const parsedHeader = headerSchema.safeParse(rawHeader);
  let rawManifest: unknown = null;
  try {
    rawManifest = JSON.parse(String(formData.get("manifest") || "null"));
  } catch {
    // The schema response below gives the client a stable validation error.
  }
  const parsedManifest = manifestSchema.safeParse(rawManifest);
  if (!z.string().uuid().safeParse(receiptId).success || !parsedHeader.success || !parsedManifest.success) {
    const issue = parsedHeader.success
      ? parsedManifest.success ? "معرف سند الاستلام غير صالح." : parsedManifest.error.issues[0]?.message
      : parsedHeader.error.issues[0]?.message;
    return NextResponse.json({ message: issue || "بيانات صور المنتجات غير صالحة." }, { status: 400 });
  }

  const photos = parsedManifest.data.map((entry) => ({
    ...entry,
    file: formData.get(entry.field),
  }));
  if (photos.some((photo) => !(photo.file instanceof File) || photo.file.size === 0)) {
    return NextResponse.json({ message: "كل مصدر صورة يجب أن يحتوي ملفاً صالحاً." }, { status: 400 });
  }
  const files = photos.map((photo) => photo.file as File);
  if (files.reduce((total, file) => total + file.size, 0) > maxTotalBytes) {
    return NextResponse.json({ message: "إجمالي الصور يجب ألا يتجاوز 40 MB." }, { status: 413 });
  }

  const uploadedPaths: string[] = [];
  try {
    const db = productInventoryDb(auth.admin);
    const [productsResult, aliasesResult, inspectedFiles] = await Promise.all([
      db.from("sales_products")
        .select("id, company_id, name, sku, barcode, model, price, default_cost")
        .eq("organization_id", auth.orgId)
        .eq("company_id", parsedHeader.data.supplier_company_id)
        .eq("is_active", true)
        .eq("inventory_enabled", true)
        .eq("tracking_mode", "serialized"),
      db.from("product_inventory_aliases")
        .select("product_id, normalized_value")
        .eq("organization_id", auth.orgId)
        .eq("is_approved", true),
      Promise.all(files.map((file) => inspectUpload(file, { allowedMimeTypes, maxBytes }))),
    ]);
    const catalogError = productsResult.error || aliasesResult.error;
    if (catalogError) throw Object.assign(new Error(catalogError.message), { code: catalogError.code });

    const seen = new Set<string>();
    const candidates = photos.flatMap((photo) =>
      parseProductPhotoExtraction(photo.extraction, {
        sourceId: photo.source_id,
        products: productsResult.data ?? [],
        aliases: aliasesResult.data ?? [],
        defaultCurrency: parsedHeader.data.currency,
        seenSerials: seen,
      })
    );
    const serials = [...new Set(candidates.map((candidate) => candidate.normalized_serial).filter(Boolean))];
    const [confirmed, drafts] = await Promise.all([
      existingSerials(db, "product_inventory_units", "normalized_serial_number", serials, auth.orgId),
      existingSerials(db, "product_receipt_candidates", "normalized_serial", serials, auth.orgId, receiptId),
    ]);
    for (const candidate of candidates) {
      if (confirmed.has(candidate.normalized_serial)) {
        candidate.validation_errors.push("Serial number already exists in confirmed stock.");
        candidate.status = "duplicate";
      } else if (drafts.has(candidate.normalized_serial)) {
        candidate.validation_warnings.push("Serial number also appears in another draft receipt.");
        if (candidate.status === "valid") candidate.status = "warning";
      }
    }

    const sources = [];
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const file = files[index];
      const inspected = inspectedFiles[index];
      if (!photo || !file || !inspected) throw new Error("Photo inspection result is incomplete.");
      const safeName = safeFilename(file.name);
      const path = `${auth.orgId}/${receiptId}/${parsedHeader.data.command_id}/${inspected.sha256}-${safeName}`;
      const upload = await auth.admin.storage.from("product-inventory-photos").upload(
        path,
        inspected.bytes,
        { contentType: inspected.detectedMime, upsert: true }
      );
      if (upload.error) throw new Error(upload.error.message);
      uploadedPaths.push(path);
      sources.push({
        source_id: photo.source_id,
        managed_file_id: photo.managed_file_id,
        file: {
          bucket: "product-inventory-photos",
          path,
          filename: safeName,
          type: inspected.detectedMime,
          size_bytes: file.size,
          sha256: inspected.sha256,
          scan_status: inspected.scanStatus,
          scan_engine: inspected.engine,
          scanned_at: inspected.scannedAt,
        },
        extraction: photo.extraction,
      });
    }

    const result = await (auth.admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }).rpc("execute_product_photo_preview", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsedHeader.data.command_id,
      p_receipt_id: receiptId,
      p_header: {
        ...parsedHeader.data,
        invoice_received: Boolean(parsedHeader.data.supplier_invoice_no),
      },
      p_sources: sources,
      p_candidates: candidates,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const commandResult = firstRecord(result.data);
    if (!commandResult) throw new Error("Photo preview command returned no result.");
    const counts = candidates.reduce((value, candidate) => {
      value[candidate.status] += 1;
      return value;
    }, { valid: 0, warning: 0, invalid: 0, duplicate: 0, unmatched: 0 });
    return NextResponse.json({ data: { ...commandResult, candidates, counts } });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      const registered = await auth.admin.from("product_receipt_sources")
        .select("storage_path")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .in("storage_path", uploadedPaths);
      if (!registered.error) {
        const retained = new Set((registered.data ?? []).map((row) => String(row.storage_path)));
        await removeUploadedPaths(
          auth.admin,
          "product-inventory-photos",
          uploadedPaths.filter((path) => !retained.has(path))
        ).catch(() => undefined);
      }
    }
    if (error instanceof UploadSecurityError) {
      return NextResponse.json({ message: error.message }, { status: 422 });
    }
    return productInventoryError(error, "تعذر تحليل صور مخزون المنتجات.");
  }
}
