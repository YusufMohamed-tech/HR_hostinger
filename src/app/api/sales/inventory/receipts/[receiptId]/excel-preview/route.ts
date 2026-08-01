import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { readProductInventoryWorkbook } from "@/lib/product-inventory/workbook-server";
import { parseProductInventoryWorkbookRows } from "@/lib/product-inventory/workbook";
import { storeObject } from "@/lib/server/file-storage";

type RouteContext = { params: Promise<{ receiptId: string }> };
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const previewSchema = z.object({
  source_id: z.string().uuid(),
  managed_file_id: z.string().uuid(),
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

const allowedMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/csv",
]);
const maxBytes = 10 * 1024 * 1024;

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "inventory-import";
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
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "اختر ملف XLSX أو CSV." }, { status: 400 });
  }
  const raw = Object.fromEntries([
    "source_id", "managed_file_id", "command_id", "supplier_company_id",
    "warehouse_id", "ownership_type", "receipt_date", "currency",
    "delivery_note_no", "supplier_invoice_no", "notes",
  ].map((key) => [key, formData.get(key)]));
  const parsedHeader = previewSchema.safeParse(raw);
  if (!parsedHeader.success || !z.string().uuid().safeParse(receiptId).success) {
    return NextResponse.json(
      { message: parsedHeader.success ? "معرف سند الاستلام غير صالح." : parsedHeader.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const lowerName = file.name.toLowerCase();
  const sourceType = lowerName.endsWith(".xlsx") ? "excel"
    : lowerName.endsWith(".csv") ? "csv" : null;
  if (!sourceType || lowerName.endsWith(".xlsm") || lowerName.endsWith(".xls")) {
    return NextResponse.json({ message: "الصيغ المدعومة هي XLSX وCSV فقط. ملفات الماكرو غير مسموحة." }, { status: 400 });
  }

  let storagePath = "";
  try {
    const inspected = await inspectUpload(file, { allowedMimeTypes, maxBytes });
    const rawRows = await readProductInventoryWorkbook(inspected.bytes, sourceType);
    const configuredLimit = Number(process.env.PRODUCT_INVENTORY_IMPORT_MAX_ROWS || 10000);
    const rowLimit = Math.min(Math.max(Number.isFinite(configuredLimit) ? configuredLimit : 10000, 1), 10000);
    if (rawRows.length - 1 > rowLimit) {
      return NextResponse.json({ message: `الحد الأقصى هو ${rowLimit.toLocaleString("en-US")} صف بيانات.` }, { status: 400 });
    }

    const db = productInventoryDb(auth.admin);
    const [productsResult, aliasesResult, profileResult] = await Promise.all([
      db.from("sales_products")
        .select("id, company_id, name, sku, barcode, model, price, default_cost, agent_commission_type, agent_commission_value")
        .eq("organization_id", auth.orgId)
        .eq("company_id", parsedHeader.data.supplier_company_id)
        .eq("is_active", true)
        .eq("inventory_enabled", true)
        .eq("tracking_mode", "serialized"),
      db.from("product_inventory_aliases")
        .select("product_id, normalized_value")
        .eq("organization_id", auth.orgId)
        .eq("is_approved", true),
      db.from("product_inventory_import_profiles")
        .select("id, header_row, header_mapping, default_currency")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    const catalogError = productsResult.error || aliasesResult.error || profileResult.error;
    if (catalogError) throw Object.assign(new Error(catalogError.message), { code: catalogError.code });
    if (!profileResult.data) {
      return NextResponse.json({ message: "لا يوجد إصدار نشط لقالب الاستيراد. فعّل قالباً أولاً." }, { status: 422 });
    }

    const profileRows = rawRows.slice(Math.max(0, Number(profileResult.data.header_row || 1) - 1));

    const preview = parseProductInventoryWorkbookRows(
      profileRows as Array<Array<string | number | boolean | Date | null | undefined>>,
      {
      products: productsResult.data ?? [],
      aliases: aliasesResult.data ?? [],
      defaultCurrency: profileResult.data.default_currency || parsedHeader.data.currency,
      headerMapping: profileResult.data.header_mapping as Record<string, string>,
      }
    );
    if (preview.rows.length > rowLimit) {
      return NextResponse.json({ message: `الحد الأقصى هو ${rowLimit.toLocaleString("en-US")} صف بيانات.` }, { status: 400 });
    }
    const serials = [...new Set(preview.rows.map((row) => row.normalized_serial).filter(Boolean))];
    const [confirmed, drafts] = await Promise.all([
      existingSerials(
        db, "product_inventory_units", "normalized_serial_number", serials, auth.orgId
      ),
      existingSerials(
        db, "product_receipt_candidates", "normalized_serial", serials, auth.orgId, receiptId
      ),
    ]);
    for (const row of preview.rows) {
      if (confirmed.has(row.normalized_serial)) {
        row.validation_errors.push("Serial number already exists in confirmed stock.");
        row.status = "duplicate";
      } else if (drafts.has(row.normalized_serial)) {
        row.validation_warnings.push("Serial number also appears in another draft receipt.");
        if (row.status === "valid") row.status = "warning";
      }
    }

    const safeName = safeFilename(file.name);
    storagePath = `${auth.orgId}/${receiptId}/${parsedHeader.data.command_id}/${inspected.sha256}-${safeName}`;
    await storeObject(auth.admin, {
      bucket: "product-inventory-imports",
      path: storagePath,
      bytes: inspected.bytes,
      contentType: inspected.detectedMime,
      upsert: true,
    });

    const counts = preview.rows.reduce((value, row) => {
      value[row.status] += 1;
      return value;
    }, { valid: 0, warning: 0, invalid: 0, duplicate: 0, unmatched: 0 });
    const header = {
      ...parsedHeader.data,
      invoice_received: Boolean(parsedHeader.data.supplier_invoice_no),
    };
    const fileMetadata = {
      bucket: "product-inventory-imports",
      path: storagePath,
      filename: safeName,
      type: inspected.detectedMime,
      size_bytes: file.size,
      sha256: inspected.sha256,
      scan_status: inspected.scanStatus,
      scan_engine: inspected.engine,
      scanned_at: inspected.scannedAt,
      source_type: sourceType,
      headers: preview.headers,
      import_profile_id: profileResult.data.id,
    };
    const result = await (auth.admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }).rpc("execute_product_workbook_preview", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsedHeader.data.command_id,
      p_receipt_id: receiptId,
      p_source_id: parsedHeader.data.source_id,
      p_managed_file_id: parsedHeader.data.managed_file_id,
      p_header: header,
      p_file: fileMetadata,
      p_rows: preview.rows,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const commandResult = firstRecord(result.data);
    if (!commandResult) throw new Error("Workbook preview command returned no result.");
    const proposalResult = await db.rpc("store_product_inventory_import_commercial_proposals", {
      p_org_id: auth.orgId,
      p_receipt_id: receiptId,
      p_source_id: parsedHeader.data.source_id,
      p_kind: "workbook",
      p_rows: preview.rows,
    });
    if (proposalResult.error) {
      throw Object.assign(new Error(proposalResult.error.message), { code: proposalResult.error.code });
    }
    const sourceUpdate = await db.from("product_receipt_sources")
      .update({ import_profile_id: profileResult.data.id })
      .eq("organization_id", auth.orgId)
      .eq("receipt_id", receiptId)
      .eq("id", parsedHeader.data.source_id);
    if (sourceUpdate.error) {
      throw Object.assign(new Error(sourceUpdate.error.message), { code: sourceUpdate.error.code });
    }
    return NextResponse.json({
      data: {
        ...commandResult,
        rows: preview.rows,
        headers: preview.headers,
        counts,
      },
    });
  } catch (error) {
    if (storagePath) {
      const registered = await auth.admin
        .from("product_receipt_sources")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .eq("storage_path", storagePath)
        .maybeSingle();
      if (!registered.error && !registered.data) {
        await removeUploadedPaths(auth.admin, "product-inventory-imports", [storagePath]).catch(() => undefined);
      }
    }
    if (error instanceof UploadSecurityError) {
      return NextResponse.json({ message: error.message }, { status: 422 });
    }
    return productInventoryError(error, "تعذر تحليل ملف مخزون المنتجات.");
  }
}
