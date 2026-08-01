import { NextRequest, NextResponse } from "next/server";
import { workbookCommitSchema } from "@/lib/product-inventory/schemas";
import { normalizeSerial } from "@/lib/product-inventory/normalization";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import {
  applyCommercialTermsFromImportedRows,
  productInventoryDb,
  productInventoryError,
} from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string }> };
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;
  const parsed = workbookCommitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات استيراد الملف غير صالحة." },
      { status: 400 }
    );
  }

  try {
    const db = productInventoryDb(auth.admin);
    const [receiptResult, sourceResult, storedRowsResult] = await Promise.all([
      db.from("product_receipts")
        .select("supplier_company_id, status, version")
        .eq("organization_id", auth.orgId)
        .eq("id", receiptId)
        .maybeSingle(),
      db.from("product_receipt_sources")
        .select("id, total_rows, committed_at")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .eq("id", parsed.data.source_id)
        .maybeSingle(),
      db.from("product_inventory_import_rows")
        .select("row_number")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .eq("source_id", parsed.data.source_id),
    ]);
    const dependencyError = receiptResult.error || sourceResult.error || storedRowsResult.error;
    if (dependencyError) throw Object.assign(new Error(dependencyError.message), { code: dependencyError.code });
    if (!receiptResult.data || !sourceResult.data) {
      return NextResponse.json({ message: "معاينة الملف غير موجودة." }, { status: 404 });
    }
    if (sourceResult.data.committed_at) {
      return NextResponse.json({ message: "تم اعتماد هذا الملف من قبل." }, { status: 409 });
    }

    const rowNumbers = new Set((storedRowsResult.data ?? []).map((row: Record<string, unknown>) => Number(row.row_number)));
    if (rowNumbers.size !== parsed.data.rows.length
        || parsed.data.rows.some((row) => !rowNumbers.has(row.row_number))) {
      return NextResponse.json({ message: "لا يمكن حذف صفوف من الملف. صحح كل الصفوف قبل الاعتماد." }, { status: 422 });
    }

    const productIds = [...new Set(parsed.data.rows.map((row) => row.product_id))];
    const productsResult = await db.from("sales_products")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("company_id", receiptResult.data.supplier_company_id)
      .eq("is_active", true)
      .eq("inventory_enabled", true)
      .eq("tracking_mode", "serialized")
      .in("id", productIds);
    if (productsResult.error) throw Object.assign(new Error(productsResult.error.message), { code: productsResult.error.code });
    if ((productsResult.data ?? []).length !== productIds.length) {
      return NextResponse.json({ message: "يوجد منتج غير صالح أو لا يتبع المورد المحدد." }, { status: 422 });
    }

    const seen = new Set<string>();
    const normalizedRows = parsed.data.rows.map((row) => {
      const normalized = normalizeSerial(row.serial_number);
      if (!normalized || seen.has(normalized)) {
        throw Object.assign(new Error("الأرقام التسلسلية يجب أن تكون صالحة وفريدة داخل الملف."), { code: "23505" });
      }
      seen.add(normalized);
      return {
        ...row,
        normalized_serial: normalized,
        status: row.validation_warnings.length > 0 ? "warning" : "valid",
        validation_errors: [],
      };
    });

    for (let index = 0; index < normalizedRows.length; index += 400) {
      const values = normalizedRows.slice(index, index + 400).map((row) => row.normalized_serial);
      const duplicates = await db.from("product_inventory_units")
        .select("normalized_serial_number")
        .eq("organization_id", auth.orgId)
        .in("normalized_serial_number", values);
      if (duplicates.error) throw Object.assign(new Error(duplicates.error.message), { code: duplicates.error.code });
      if ((duplicates.data ?? []).length > 0) {
        throw Object.assign(new Error("يوجد رقم تسلسلي مؤكد مسبقاً في المخزون."), { code: "23505" });
      }
    }

    const result = await (auth.admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }).rpc("execute_product_workbook_commit", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_receipt_id: receiptId,
      p_source_id: parsed.data.source_id,
      p_expected_version: parsed.data.expected_version,
      p_rows: normalizedRows,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const commandResult = result.data as { receipt?: Record<string, unknown> } | null;
    if (!commandResult?.receipt) throw new Error("Workbook commit returned no receipt.");
    const commercial = await applyCommercialTermsFromImportedRows(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      receiptId,
      expectedVersion: Number(commandResult.receipt.version),
      source: "workbook_proposal",
      rows: normalizedRows,
    });
    return NextResponse.json({ data: commercial.receipt });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد ملف مخزون المنتجات.");
  }
}
