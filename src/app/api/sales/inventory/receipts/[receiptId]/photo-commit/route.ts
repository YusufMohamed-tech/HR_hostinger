import { NextRequest, NextResponse } from "next/server";
import { photoCommitSchema } from "@/lib/product-inventory/schemas";
import { normalizeSerial } from "@/lib/product-inventory/normalization";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import {
  applyCommercialTermsFromImportedRows,
  productInventoryDb,
  productInventoryError,
} from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string }> };
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type StoredPhotoCandidate = {
  source_id: string;
  candidate_index: number;
  raw_product_name: string | null;
  raw_sku: string | null;
  raw_model: string | null;
  raw_serial: string | null;
  raw_barcode: string | null;
  suggested_product_id: string | null;
  confidence: number | string | null;
  match_method: "sku" | "barcode" | "name" | "alias" | "fuzzy" | "none";
  validation_warnings: unknown;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;
  const parsed = photoCommitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات مراجعة الصور غير صالحة." },
      { status: 400 }
    );
  }

  try {
    const db = productInventoryDb(auth.admin);
    const [receiptResult, storedResult] = await Promise.all([
      db.from("product_receipts")
        .select("supplier_company_id, version, status")
        .eq("organization_id", auth.orgId)
        .eq("id", receiptId)
        .maybeSingle(),
      db.from("product_inventory_photo_candidates")
        .select("source_id, candidate_index, raw_product_name, raw_sku, raw_model, raw_serial, raw_barcode, suggested_product_id, confidence, match_method, validation_warnings")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId),
    ]);
    const dependencyError = receiptResult.error || storedResult.error;
    if (dependencyError) throw Object.assign(new Error(dependencyError.message), { code: dependencyError.code });
    if (!receiptResult.data) {
      return NextResponse.json({ message: "معاينة صور الاستلام غير موجودة." }, { status: 404 });
    }
    if (receiptResult.data.version !== parsed.data.expected_version) {
      return NextResponse.json({ message: "تم تعديل السند. حدّث الصفحة ثم أعد المحاولة." }, { status: 409 });
    }

    const storedCandidates = (storedResult.data ?? []) as StoredPhotoCandidate[];
    const storedByKey = new Map(storedCandidates.map((candidate) => [
      `${candidate.source_id}:${candidate.candidate_index}`,
      candidate,
    ]));
    if (storedByKey.size !== parsed.data.candidates.length) {
      return NextResponse.json({ message: "لا يمكن حذف مرشح صورة؛ صحح جميع المرشحين قبل الاعتماد." }, { status: 422 });
    }

    const productIds = [...new Set(parsed.data.candidates.map((candidate) => candidate.product_id))];
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
    const candidates = parsed.data.candidates.map((candidate) => {
      const stored = storedByKey.get(`${candidate.source_id}:${candidate.candidate_index}`);
      if (!stored) throw Object.assign(new Error("مرشح الصورة لا يطابق المعاينة المحفوظة."), { code: "23514" });
      const normalized = normalizeSerial(candidate.serial_number);
      if (!normalized || seen.has(normalized)) {
        throw Object.assign(new Error("الأرقام التسلسلية يجب أن تكون صالحة وفريدة داخل الصور."), { code: "23505" });
      }
      seen.add(normalized);
      const serialUnchanged = normalized === normalizeSerial(String(stored.raw_serial || ""));
      const storedWarnings = Array.isArray(stored.validation_warnings)
        ? stored.validation_warnings.map(String)
        : [];
      const warnings = storedWarnings.filter((warning) =>
        warning.includes("another draft") ? serialUnchanged : false
      );
      const confidence = Number(stored.confidence || 0);
      if (confidence < 0.9) warnings.push("Extraction confidence is below 90%; explicitly review this candidate.");
      return {
        ...candidate,
        raw_product_name: String(stored.raw_product_name || ""),
        raw_sku: String(stored.raw_sku || ""),
        raw_model: String(stored.raw_model || ""),
        raw_serial: String(stored.raw_serial || ""),
        raw_barcode: String(stored.raw_barcode || ""),
        normalized_serial: normalized,
        confidence,
        match_method: stored.match_method,
        validation_errors: [],
        validation_warnings: [...new Set(warnings)],
        status: warnings.length > 0 ? "warning" as const : "valid" as const,
      };
    });

    for (let index = 0; index < candidates.length; index += 400) {
      const serials = candidates.slice(index, index + 400).map((candidate) => candidate.normalized_serial);
      const duplicates = await db.from("product_inventory_units")
        .select("normalized_serial_number")
        .eq("organization_id", auth.orgId)
        .in("normalized_serial_number", serials);
      if (duplicates.error) throw Object.assign(new Error(duplicates.error.message), { code: duplicates.error.code });
      if ((duplicates.data ?? []).length > 0) {
        throw Object.assign(new Error("يوجد رقم تسلسلي مؤكد مسبقاً في المخزون."), { code: "23505" });
      }
    }

    const result = await (auth.admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }).rpc("execute_product_photo_commit", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_receipt_id: receiptId,
      p_expected_version: parsed.data.expected_version,
      p_warnings_accepted: parsed.data.warnings_accepted,
      p_candidates: candidates,
    });
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const commandResult = result.data as { receipt?: Record<string, unknown> } | null;
    if (!commandResult?.receipt) throw new Error("Photo commit returned no receipt.");
    const commercial = await applyCommercialTermsFromImportedRows(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      receiptId,
      expectedVersion: Number(commandResult.receipt.version),
      source: "photo_proposal",
      rows: candidates,
    });
    return NextResponse.json({ data: commercial.receipt });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد صور مخزون المنتجات.");
  }
}
