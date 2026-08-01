import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ profileId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { profileId } = await context.params;
  if (!z.string().uuid().safeParse(profileId).success) {
    return NextResponse.json({ message: "معرف إصدار القالب غير صالح." }, { status: 400 });
  }
  try {
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "activate_product_inventory_import_profile",
      { p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_profile_id: profileId }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تفعيل إصدار قالب الاستيراد.");
  }
}
