import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { EmployeeLifecycleError, setEmployeeLocations } from "@/lib/server/employee-lifecycle";

type RouteContext = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  location_ids: z.array(z.string().uuid()).max(100),
  primary_location_id: z.string().uuid().nullable().optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ message: "Valid employee and locations are required." }, { status: 400 });
  }
  try {
    await setEmployeeLocations(auth.admin, {
      orgId: auth.orgId,
      employeeId: id,
      locationIds: parsed.data.location_ids,
      primaryLocationId: parsed.data.primary_location_id,
    });
    return NextResponse.json({ ok: true, requestId: auth.requestId });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json({ message: lifecycleError?.message || "Unable to update locations." }, { status: lifecycleError?.status || 500 });
  }
}

