import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { EmployeeLifecycleError, finalizeEmployeeOnboarding } from "@/lib/server/employee-lifecycle";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = z.object({ command_id: z.string().uuid() }).safeParse(body);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ message: "Valid employee and command ids are required." }, { status: 400 });
  }

  try {
    const employee = await finalizeEmployeeOnboarding(auth.admin, {
      orgId: auth.orgId,
      employeeId: id,
      actorUserId: auth.user.id,
      commandId: parsed.data.command_id,
    });
    return NextResponse.json({ employee, requestId: auth.requestId });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json({ message: lifecycleError?.message || "Unable to finalize onboarding." }, { status: lifecycleError?.status || 500 });
  }
}

