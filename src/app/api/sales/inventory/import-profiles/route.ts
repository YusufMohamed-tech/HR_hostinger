import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

const profileSchema = z.object({
  profile_id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  supplier_company_id: z.string().uuid().optional(),
  sheet_name: z.string().trim().max(160).optional(),
  use_first_sheet: z.boolean().default(true),
  header_row: z.coerce.number().int().min(1).max(100).default(1),
  header_mapping: z.record(z.string().min(1), z.string().min(1)),
  required_fields: z.array(z.string().min(1)).min(2).max(30),
  default_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("SAR"),
  default_condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  default_ownership_type: z.enum(["purchased", "consignment"]).default("purchased"),
  is_active: z.boolean().default(true),
  sample_file_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  approval_note: z.string().trim().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_inventory_import_profiles")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل إصدارات قالب الاستيراد.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = profileSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "إعدادات القالب غير صالحة." }, { status: 400 });
  }
  const { profile_id: profileId, ...payload } = parsed.data;
  try {
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "create_product_inventory_import_profile",
      {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_profile_id: profileId,
        p_payload: payload,
      }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر حفظ إصدار قالب الاستيراد.");
  }
}
