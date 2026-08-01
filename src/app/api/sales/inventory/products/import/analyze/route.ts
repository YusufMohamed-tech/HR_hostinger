import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recognizeProductCatalogWorkbook } from "@/lib/product-catalog/workbook-recognition";
import { readProductInventoryWorkbookSheets } from "@/lib/product-inventory/workbook-server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { productCatalogEnabled } from "@/lib/server/product-catalog";
import { storeObject } from "@/lib/server/file-storage";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const requestSchema = z.object({
  analysis_id: z.string().uuid(),
  managed_file_id: z.string().uuid(),
  command_id: z.string().uuid(),
  company_id: z.string().uuid(),
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
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/gu, "_").slice(0, 180) || "product-catalog";
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "اختر ملف XLSX أو CSV للمنتجات." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse({
    analysis_id: formData.get("analysis_id"),
    managed_file_id: formData.get("managed_file_id"),
    command_id: formData.get("command_id"),
    company_id: formData.get("company_id"),
  });
  if (!parsed.success) {
    return NextResponse.json({ message: "بيانات تحليل كتالوج المنتجات غير صالحة." }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  const sourceType = lowerName.endsWith(".xlsx") ? "excel"
    : lowerName.endsWith(".csv") ? "csv" : null;
  if (!sourceType || lowerName.endsWith(".xlsm") || lowerName.endsWith(".xls")) {
    return NextResponse.json({ message: "الصيغ المدعومة هي XLSX وCSV فقط، ولا يسمح بملفات الماكرو." }, { status: 400 });
  }

  let storagePath = "";
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const inspected = await inspectUpload(file, { allowedMimeTypes, maxBytes });
    const sheets = await readProductInventoryWorkbookSheets(inspected.bytes, sourceType);
    if (sheets.length === 0 || sheets.length > maxSheets) {
      return NextResponse.json({ message: `يجب أن يحتوي الملف على 1–${maxSheets} ورقة.` }, { status: 400 });
    }
    let dataRows = 0;
    for (const sheet of sheets) {
      if (sheet.rows.length > maxRows) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز 10,000 صف.` }, { status: 400 });
      }
      const columns = sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      if (columns > maxColumns) {
        return NextResponse.json({ message: `ورقة ${sheet.name} تتجاوز ${maxColumns} عمودًا.` }, { status: 400 });
      }
      dataRows += sheet.rows.length;
    }
    if (dataRows > maxRows * Math.min(sheets.length, 10)) {
      return NextResponse.json({ message: "إجمالي صفوف الملف يتجاوز حد التحليل الآمن." }, { status: 400 });
    }

    const db = productInventoryDb(auth.admin);
    const [companyResult, productsResult, accountsResult] = await Promise.all([
      db.from("sales_companies")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("id", parsed.data.company_id)
        .eq("is_active", true)
        .maybeSingle(),
      db.from("sales_products")
        .select("id, company_id, name, description, unit, category, sku, barcode, model, price, default_cost, revenue_account_id, agent_commission_type, agent_commission_value, inventory_version, is_active")
        .eq("organization_id", auth.orgId)
        .eq("inventory_enabled", true)
        .eq("tracking_mode", "serialized"),
      db.from("accounting_accounts")
        .select("id, code")
        .eq("organization_id", auth.orgId)
        .eq("type", "revenue")
        .eq("is_active", true),
    ]);
    const lookupError = companyResult.error || productsResult.error || accountsResult.error;
    if (lookupError) throw Object.assign(new Error(lookupError.message), { code: lookupError.code });
    if (!companyResult.data) {
      return NextResponse.json({ message: "المورد غير موجود أو غير نشط." }, { status: 404 });
    }
    const recognition = recognizeProductCatalogWorkbook(sheets, {
      companyId: parsed.data.company_id,
      products: productsResult.data ?? [],
      revenueAccounts: accountsResult.data ?? [],
    });
    if (!recognition.sheet_name || recognition.header_row < 1) {
      return NextResponse.json({
        message: recognition.blocking_errors[0] || "تعذر التعرف على أعمدة الملف.",
        data: recognition,
      }, { status: 422 });
    }

    const safeName = safeFilename(file.name);
    storagePath = `${auth.orgId}/product-catalog/${parsed.data.analysis_id}/${parsed.data.command_id}/${inspected.sha256}-${safeName}`;
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
    }).rpc("save_product_catalog_import_analysis", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_analysis_id: parsed.data.analysis_id,
      p_managed_file_id: parsed.data.managed_file_id,
      p_company_id: parsed.data.company_id,
      p_file: fileMetadata,
      p_recognition: recognition,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return NextResponse.json({
      data: {
        ...(result.data as Record<string, unknown>),
        recognition: { ...recognition, rows: recognition.rows.slice(0, 200) },
      },
    }, { status: 201 });
  } catch (error) {
    if (storagePath) {
      await removeUploadedPaths(auth.admin, "product-inventory-imports", [storagePath]).catch((cleanupError) => {
        console.error("Unable to clean failed product catalog workbook upload", cleanupError);
      });
    }
    if (error instanceof UploadSecurityError) {
      return NextResponse.json({ message: error.message }, { status: error.code === "malware" ? 422 : 400 });
    }
    return productInventoryError(error, "تعذر تحليل كتالوج المنتجات.");
  }
}
