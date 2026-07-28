import { NextRequest, NextResponse } from "next/server";
import { productInventoryLossSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  executeProductInventoryLossCommand,
  productInventoryDb,
  productInventoryError,
} from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_inventory_loss_records")
      .select("*, unit:unit_id(id, raw_serial_number, status, product:product_id(name, sku))")
      .eq("organization_id", auth.orgId)
      .order("recorded_at", { ascending: false })
      .limit(250);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل سجل فاقد وتلف المنتجات.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productInventoryLossSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات فاقد المخزون غير صالحة." },
      { status: 400 }
    );
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductInventoryLossCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر إثبات فاقد أو تلف المنتج.");
  }
}
