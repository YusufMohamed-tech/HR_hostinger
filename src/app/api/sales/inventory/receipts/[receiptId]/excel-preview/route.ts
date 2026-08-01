import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { readProductInventoryWorkbookSheets } from "@/lib/product-inventory/workbook-server";
import { parseProductInventoryWorkbookRows } from "@/lib/product-inventory/workbook";
import { normalizeRecognizedProductInventorySheets } from "@/lib/product-inventory/workbook-normalization";
import {
  recognizeProductInventoryWorkbook,
  type ProductInventoryWorkbookRecognition,
} from "@/lib/product-inventory/workbook-recognition";
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
const maxSheets = 50;
const maxColumns = 200;

type ImportProfileRow = {
  id: string;
  supplier_company_id: string | null;
  header_mapping: Record<string, string>;
  default_currency: string;
  layout_fingerprint: string | null;
  is_active: boolean;
  approved_at: string | null;
};

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "inventory-import";
}

function firstRecord(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function matchingProfile(
  profiles: ImportProfileRow[],
  recognition: ProductInventoryWorkbookRecognition,
  supplierCompanyId: string
) {
  return profiles
    .filter((profile) => profile.layout_fingerprint === recognition.layout_fingerprint)
    .filter((profile) => !profile.supplier_company_id || profile.supplier_company_id === supplierCompanyId)
    .sort((left, right) => {
      const supplierSpecific = Number(Boolean(right.supplier_company_id)) - Number(Boolean(left.supplier_company_id));
      if (supplierSpecific !== 0) return supplierSpecific;
      const active = Number(right.is_active) - Number(left.is_active);
      if (active !== 0) return active;
      return String(right.approved_at ?? "").localeCompare(String(left.approved_at ?? ""));
    })[0] ?? null;
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
    const sheets = await readProductInventoryWorkbookSheets(inspected.bytes, sourceType);
    const configuredLimit = Number(process.env.PRODUCT_INVENTORY_IMPORT_MAX_ROWS || 10000);
    const rowLimit = Math.min(Math.max(Number.isFinite(configuredLimit) ? configuredLimit : 10000, 1), 10000);
    if (sheets.length === 0 || sheets.length > maxSheets) {
      return NextResponse.json({ message: `يجب أن يحتوي الملف على 1–${maxSheets} ورقة عمل.` }, { status: 400 });
    }
    let rawRowCount = 0;
    for (const sheet of sheets) {
      rawRowCount += sheet.rows.length;
      if (sheet.rows.length > rowLimit + 101) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز الحد الآمن للصفوف.` }, { status: 400 });
      }
      const columns = sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      if (columns > maxColumns) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز حد ${maxColumns} عمودًا.` }, { status: 400 });
      }
    }
    if (rawRowCount > (rowLimit + 101) * Math.min(sheets.length, 10)) {
      return NextResponse.json({ message: "إجمالي صفوف الملف أكبر من الحد الآمن للاستيراد." }, { status: 400 });
    }

    const db = productInventoryDb(auth.admin);
    const [productsResult, aliasesResult, profilesResult, settingsResult] = await Promise.all([
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
        .select("id, supplier_company_id, header_mapping, default_currency, layout_fingerprint, is_active, approved_at")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("product_inventory_commerce_settings")
        .select("automatic_workbook_recognition_enabled")
        .eq("organization_id", auth.orgId)
        .maybeSingle(),
    ]);
    const catalogError = productsResult.error || aliasesResult.error || profilesResult.error || settingsResult.error;
    if (catalogError) throw Object.assign(new Error(catalogError.message), { code: catalogError.code });
    if (settingsResult.data?.automatic_workbook_recognition_enabled === false) {
      return NextResponse.json(
        { message: "التعرّف التلقائي على ملفات Excel متوقف مؤقتًا لهذه المنشأة. استخدم الاستلام اليدوي أو الصور." },
        { status: 503 }
      );
    }
    const profiles = (profilesResult.data ?? []) as ImportProfileRow[];
    const recognitionContext = {
      products: productsResult.data ?? [],
      aliases: aliasesResult.data ?? [],
      approvedMappings: profiles.map((profile) => profile.header_mapping),
    };
    const recognition = recognizeProductInventoryWorkbook(sheets, recognitionContext);
    if (recognition.blocking_errors.length > 0) {
      return NextResponse.json({
        message: "لم يتمكن النظام من تحديد أعمدة السيريال والمنتج والتكلفة وسعر البيع بأمان. ارفع الملف من شاشة قوالب الاستيراد لمراجعة الأعمدة مرة واحدة.",
        recognition,
      }, { status: 422 });
    }

    const compatibleNames = new Set(recognition.compatible_sheets);
    compatibleNames.add(recognition.sheet_name);
    const recognizedSheets = sheets
      .filter((sheet) => compatibleNames.has(sheet.name))
      .map((sheet) => ({
        sheet,
        recognition: recognizeProductInventoryWorkbook([sheet], recognitionContext),
      }))
      .filter((item) => item.recognition.blocking_errors.length === 0);
    const selectedInputs = recognizedSheets.length > 0
      ? recognizedSheets
      : [{ sheet: sheets[recognition.sheet_index]!, recognition }];
    const sheetProfiles = selectedInputs.map((item) =>
      matchingProfile(profiles, item.recognition, parsedHeader.data.supplier_company_id)
    );
    const normalized = normalizeRecognizedProductInventorySheets(
      selectedInputs.map((item, index) => ({
        ...item,
        approvedHeaderMapping: sheetProfiles[index]?.header_mapping,
      }))
    );

    const preview = parseProductInventoryWorkbookRows(
      normalized.rows,
      {
      products: productsResult.data ?? [],
      aliases: aliasesResult.data ?? [],
      defaultCurrency: sheetProfiles[0]?.default_currency || parsedHeader.data.currency,
      headerMapping: normalized.headerMapping,
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

    const matchedProfileIds = new Set(sheetProfiles.map((profile) => profile?.id).filter(Boolean));
    const importProfileId = matchedProfileIds.size === 1 && sheetProfiles.every(Boolean)
      ? [...matchedProfileIds][0] as string
      : null;
    const profileMatchMode = importProfileId
      ? "exact_profile"
      : sheetProfiles.some(Boolean) ? "mixed" : "automatic";
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
      import_profile_id: importProfileId,
      recognition_version: recognition.algorithm_version,
      layout_fingerprint: recognition.layout_fingerprint,
      detected_sheet_name: recognition.sheet_name,
      detected_header_row: recognition.header_row,
      workbook_shape: recognition.shape,
      recognition_confidence: recognition.confidence,
      profile_match_mode: profileMatchMode,
      compatible_sheets: selectedInputs.map((item) => item.sheet.name),
      mapping_snapshot: Object.fromEntries(selectedInputs.map((item) => [
        item.sheet.name,
        item.recognition.header_mapping,
      ])),
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
      .update({
        import_profile_id: importProfileId,
        recognition_version: recognition.algorithm_version,
        layout_fingerprint: recognition.layout_fingerprint,
        detected_sheet_name: recognition.sheet_name,
        detected_header_row: recognition.header_row,
        workbook_shape: recognition.shape,
        recognition_confidence: recognition.confidence,
        profile_match_mode: profileMatchMode,
        compatible_sheet_names: selectedInputs.map((item) => item.sheet.name),
        mapping_snapshot: fileMetadata.mapping_snapshot,
      })
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
        recognition: {
          algorithm_version: recognition.algorithm_version,
          status: recognition.status,
          sheet_name: recognition.sheet_name,
          header_row: recognition.header_row,
          shape: recognition.shape,
          layout_fingerprint: recognition.layout_fingerprint,
          confidence: recognition.confidence,
          compatible_sheets: selectedInputs.map((item) => item.sheet.name),
          warnings: recognition.warnings,
          profile_match_mode: profileMatchMode,
          import_profile_id: importProfileId,
        },
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
