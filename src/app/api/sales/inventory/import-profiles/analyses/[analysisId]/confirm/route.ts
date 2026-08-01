import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PRODUCT_INVENTORY_WORKBOOK_HEADERS } from "@/lib/product-inventory/workbook";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ analysisId: string }> };

const canonicalField = z.enum(PRODUCT_INVENTORY_WORKBOOK_HEADERS);
const confirmSchema = z.object({
  command_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  header_mapping: z.record(z.string().min(1).max(200), canonicalField),
  default_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("SAR"),
  default_condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  default_ownership_type: z.enum(["purchased", "consignment"]).default("purchased"),
  approval_note: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { analysisId } = await context.params;
  if (!z.string().uuid().safeParse(analysisId).success) {
    return NextResponse.json({ message: "معرف تحليل القالب غير صالح." }, { status: 400 });
  }
  const parsed = confirmSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "مراجعة القالب غير صالحة." },
      { status: 400 }
    );
  }
  try {
    const db = productInventoryDb(auth.admin);
    const analysisResult = await db.from("product_inventory_import_analyses")
      .select("status, detected_mapping, field_proposals, result, expires_at")
      .eq("organization_id", auth.orgId)
      .eq("id", analysisId)
      .maybeSingle();
    if (analysisResult.error) {
      throw Object.assign(new Error(analysisResult.error.message), { code: analysisResult.error.code });
    }
    if (!analysisResult.data) {
      return NextResponse.json({ message: "تحليل القالب غير موجود." }, { status: 404 });
    }
    const recognition = (analysisResult.data.result as {
      recognition?: {
        headers?: string[];
        header_mapping?: Record<string, string>;
        field_proposals?: Array<{ field: string; header: string; confidence: number }>;
      };
    } | null)?.recognition;
    const allowedHeaders = new Set((recognition?.headers ?? []).filter(Boolean));
    const mappingEntries = Object.entries(parsed.data.header_mapping);
    if (
      mappingEntries.length < 4
      || mappingEntries.some(([header]) => !allowedHeaders.has(header))
      || new Set(mappingEntries.map(([header]) => header)).size !== mappingEntries.length
    ) {
      return NextResponse.json(
        { message: "خريطة المراجعة تحتوي على عمود غير موجود في ملف العينة." },
        { status: 400 }
      );
    }
    const detectedMapping = (recognition?.header_mapping
      ?? analysisResult.data.detected_mapping
      ?? {}) as Record<string, string>;
    const hasCorrections = JSON.stringify(Object.entries(parsed.data.header_mapping).sort())
      !== JSON.stringify(Object.entries(detectedMapping).sort());
    const proposals = (recognition?.field_proposals
      ?? analysisResult.data.field_proposals
      ?? []) as Array<{ field: string; header: string; confidence: number }>;
    const mappingConfidence = Object.fromEntries(mappingEntries.map(([header, field]) => {
      const proposal = proposals.find((candidate) => candidate.header === header && candidate.field === field);
      return [field, proposal?.confidence ?? 0.75];
    }));
    const { data, error } = await db.rpc("confirm_product_inventory_import_analysis", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_command_id: parsed.data.command_id,
      p_analysis_id: analysisId,
      p_profile_id: parsed.data.profile_id,
      p_payload: {
        name: parsed.data.name,
        header_mapping: parsed.data.header_mapping,
        mapping_confidence: mappingConfidence,
        has_corrections: hasCorrections,
        default_currency: parsed.data.default_currency,
        default_condition: parsed.data.default_condition,
        default_ownership_type: parsed.data.default_ownership_type,
        approval_note: parsed.data.approval_note || "",
      },
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد القالب الذي تم التعرف عليه.");
  }
}
