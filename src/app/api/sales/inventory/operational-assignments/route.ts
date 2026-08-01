import { NextRequest, NextResponse } from "next/server";
import { productInventoryOperationalAssignmentSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { loadProductEmployeeCustodyManagerData } from "@/lib/server/product-inventory-custody";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const data = await loadProductEmployeeCustodyManagerData(auth.admin, auth.orgId);
    return NextResponse.json({
      data: {
        assignments: data.assignments,
        employees: data.employees,
        projects: data.projects,
        locations: data.locations,
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل تكليفات عهدة المنتجات.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productInventoryOperationalAssignmentSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات التكليف غير صالحة." },
      { status: 400 }
    );
  }
  const { assignment_id: assignmentId, expected_version: expectedVersion, ...payload } = parsed.data;
  try {
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "save_product_inventory_operational_assignment",
      {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_assignment_id: assignmentId ?? null,
        p_expected_version: expectedVersion ?? null,
        p_payload: payload,
      }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data }, { status: assignmentId ? 200 : 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر حفظ تكليف عهدة المنتجات.");
  }
}
