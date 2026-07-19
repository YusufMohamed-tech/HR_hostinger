import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { employeeFormSchema, getValidationMessage } from "@/lib/validation";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { beginEmployeeOnboarding, EmployeeLifecycleError } from "@/lib/server/employee-lifecycle";

const requestSchema = z.object({
  command_id: z.string().uuid(),
  employee: employeeFormSchema,
  source_type: z.string().trim().min(1).max(80).optional(),
  source_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error), requestId: auth.requestId }, { status: 400 });
  }

  try {
    const employee = await beginEmployeeOnboarding(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      commandId: parsed.data.command_id,
      employee: parsed.data.employee,
      sourceType: parsed.data.source_type || "hr",
      sourceId: parsed.data.source_id,
    });
    return NextResponse.json({ employee, requestId: auth.requestId }, { status: 201 });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to begin employee onboarding.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}

