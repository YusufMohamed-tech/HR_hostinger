import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recognizeProductInventoryWorkbook } from "@/lib/product-inventory/workbook-recognition";
import { readProductInventoryWorkbookSheets } from "@/lib/product-inventory/workbook-server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { storeObject } from "@/lib/server/file-storage";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const inputSchema = z.object({
  analysis_id: z.string().uuid(),
  managed_file_id: z.string().uuid(),
  command_id: z.string().uuid(),
  template_name: z.string().trim().min(2).max(160),
  supplier_company_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

const allowedMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/csv",
]);
const maxBytes = 10 * 1024 * 1024;
const maxRows = 10_001;
const maxColumns = 200;
const maxSheets = 50;

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "profile-sample";
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "اختر ملف XLSX أو CSV لتحليل القالب." }, { status: 400 });
  }
  const parsed = inputSchema.safeParse({
    analysis_id: formData.get("analysis_id"),
    managed_file_id: formData.get("managed_file_id"),
    command_id: formData.get("command_id"),
    template_name: formData.get("template_name"),
    supplier_company_id: formData.get("supplier_company_id") || "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات تحليل القالب غير صالحة." },
      { status: 400 }
    );
  }
  const lowerName = file.name.toLowerCase();
  const sourceType = lowerName.endsWith(".xlsx") ? "excel"
    : lowerName.endsWith(".csv") ? "csv" : null;
  if (!sourceType || lowerName.endsWith(".xlsm") || lowerName.endsWith(".xls")) {
    return NextResponse.json(
      { message: "الصيغ المدعومة هي XLSX وCSV فقط، وملفات الماكرو غير مسموحة." },
      { status: 400 }
    );
  }

  let storagePath = "";
  try {
    const inspected = await inspectUpload(file, { allowedMimeTypes, maxBytes });
    const sheets = await readProductInventoryWorkbookSheets(inspected.bytes, sourceType);
    if (sheets.length === 0 || sheets.length > maxSheets) {
      return NextResponse.json({ message: `يجب أن يحتوي الملف على 1–${maxSheets} ورقة عمل.` }, { status: 400 });
    }
    let totalRows = 0;
    for (const sheet of sheets) {
      if (sheet.rows.length > maxRows) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز حد 10,000 صف بيانات.` }, { status: 400 });
      }
      const columns = sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      if (columns > maxColumns) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز حد ${maxColumns} عمودًا.` }, { status: 400 });
      }
      totalRows += sheet.rows.length;
    }
    if (totalRows > maxRows * Math.min(sheets.length, 10)) {
      return NextResponse.json({ message: "إجمالي بيانات أوراق العمل أكبر من الحد الآمن للتحليل." }, { status: 400 });
    }

    const db = productInventoryDb(auth.admin);
    let productsQuery = db.from("sales_products")
      .select("id, company_id, name, sku, barcode, model, price, default_cost, agent_commission_type, agent_commission_value")
      .eq("organization_id", auth.orgId)
      .eq("is_active", true)
      .eq("inventory_enabled", true)
      .eq("tracking_mode", "serialized");
    if (parsed.data.supplier_company_id) {
      productsQuery = productsQuery.eq("company_id", parsed.data.supplier_company_id);
    }
    const [productsResult, aliasesResult, profilesResult] = await Promise.all([
      productsQuery,
      db.from("product_inventory_aliases")
        .select("product_id, normalized_value")
        .eq("organization_id", auth.orgId)
        .eq("is_approved", true),
      db.from("product_inventory_import_profiles")
        .select("header_mapping")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const lookupError = productsResult.error || aliasesResult.error || profilesResult.error;
    if (lookupError) throw Object.assign(new Error(lookupError.message), { code: lookupError.code });
    const recognition = recognizeProductInventoryWorkbook(sheets, {
      products: productsResult.data ?? [],
      aliases: aliasesResult.data ?? [],
      approvedMappings: (profilesResult.data ?? []).map(
        (profile: { header_mapping: unknown }) => profile.header_mapping as Record<string, string>
      ),
    });

    const safeName = safeFilename(file.name);
    storagePath = `${auth.orgId}/profile-analysis/${parsed.data.analysis_id}/${parsed.data.command_id}/${inspected.sha256}-${safeName}`;
    await storeObject(auth.admin, {
      bucket: "product-inventory-imports",
      path: storagePath,
      bytes: inspected.bytes,
      contentType: inspected.detectedMime,
      upsert: true,
    });
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
    };
    const result = await (auth.admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }).rpc("save_product_inventory_import_analysis", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_analysis_id: parsed.data.analysis_id,
      p_managed_file_id: parsed.data.managed_file_id,
      p_supplier_company_id: parsed.data.supplier_company_id || null,
      p_template_name: parsed.data.template_name,
      p_file: fileMetadata,
      p_recognition: recognition,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return NextResponse.json({
      data: {
        analysis_id: parsed.data.analysis_id,
        managed_file_id: parsed.data.managed_file_id,
        recognition,
      },
    });
  } catch (error) {
    if (storagePath) {
      await removeUploadedPaths(auth.admin, "product-inventory-imports", [storagePath]).catch((cleanupError) => {
        console.error("Unable to clean failed workbook-profile sample upload", cleanupError);
      });
    }
    if (error instanceof UploadSecurityError) {
      return NextResponse.json({ message: error.message }, { status: error.code === "malware" ? 422 : 400 });
    }
    return productInventoryError(error, "تعذر تحليل ملف Excel والتعرف على القالب تلقائيًا.");
  }
}
