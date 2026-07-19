import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { employeeFormSchema, getValidationMessage } from "@/lib/validation";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { EmployeeLifecycleError, offboardEmployee } from "@/lib/server/employee-lifecycle";

const updateSchema = employeeFormSchema.partial().omit({ status: true }).extend({
  can_multi_checkin: z.boolean().optional(),
  carrier_supervisor_id: z.string().uuid().nullable().optional(),
});
const masterUpdateSchema = z.object({
  command_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  employee: updateSchema,
  location_ids: z.array(z.string().uuid()).optional(),
  primary_location_id: z.string().uuid().nullable().optional(),
  managed_department_ids: z.array(z.string().uuid()).optional(),
});
const offboardSchema = z.object({
  command_id: z.string().uuid(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(1000),
  termination_type: z.enum(["resignation", "termination", "end_of_contract", "retirement", "other"]).default("termination"),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ message: "Invalid employee id." }, { status: 400 });

  const parsed = masterUpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data.employee || {}).length === 0) {
    return NextResponse.json({ message: parsed.success ? "No employee fields were provided." : getValidationMessage(parsed.error) }, { status: 400 });
  }

  const { data, error } = await auth.admin.rpc("update_employee_master", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id, p_employee_id: id,
    p_expected_version: parsed.data.expected_version, p_updates: parsed.data.employee,
    p_location_ids: parsed.data.location_ids ?? null,
    p_primary_location_id: parsed.data.primary_location_id ?? null,
    p_managed_department_ids: parsed.data.managed_department_ids ?? null,
  });
  if (error) {
    const status = error.code === "P0002" ? 404
      : ["23505", "40001"].includes(error.code || "") ? 409
        : error.code === "42501" ? 403
          : ["22023", "23503", "23514", "22P02"].includes(error.code || "") ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ employee: data, requestId: auth.requestId });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const parsed = offboardSchema.safeParse(await request.json().catch(() => ({})));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ message: !parsed.success ? getValidationMessage(parsed.error) : "Invalid employee id." }, { status: 400 });
  }

  try {
    const employee = await offboardEmployee(auth.admin, {
      orgId: auth.orgId,
      employeeId: id,
      actorUserId: auth.user.id,
      commandId: parsed.data.command_id,
      effectiveDate: parsed.data.effective_date,
      reason: parsed.data.reason,
      terminationType: parsed.data.termination_type,
    });
    return NextResponse.json({ employee, requestId: auth.requestId });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to offboard employee.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}
