import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { employeeFormSchema, getValidationMessage } from "@/lib/validation";
import { requireTenantContext } from "@/lib/server/tenant-context";
import {
  beginEmployeeOnboarding,
  EmployeeLifecycleError,
  inviteAndLinkEmployeeIdentity,
} from "@/lib/server/employee-lifecycle";
import { isStrongEmployeeAccountPassword } from "@/lib/employee-account-password";
import type { OrgRole } from "@/types/database";

const requestSchema = z.object({
  command_id: z.string().uuid(),
  employee: employeeFormSchema,
  source_type: z.string().trim().min(1).max(80).optional(),
  source_id: z.string().uuid().nullable().optional(),
  account: z.object({
    command_id: z.string().uuid(),
    email: z.string().trim().email().max(255),
    full_name: z.string().trim().min(2).max(160).optional(),
    role: z.enum(["employee", "hr_admin", "hr_recruitment", "training_manager", "onground_agent_manager", "promoter", "finance_manager", "accountant", "finance_viewer", "supervisor"]),
    password: z.string().refine(isStrongEmployeeAccountPassword),
  }),
}).superRefine((value, context) => {
  if (!value.employee.email) {
    context.addIssue({ code: "custom", path: ["employee", "email"], message: "Employee email is required." });
  } else if (value.employee.email.toLowerCase() !== value.account.email.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["account", "email"], message: "Employee and login emails must match." });
  }
  if (!value.employee.hiring_date) {
    context.addIssue({ code: "custom", path: ["employee", "hiring_date"], message: "Employee starting date is required." });
  }
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
    const identity = await inviteAndLinkEmployeeIdentity(auth.admin, {
      orgId: auth.orgId,
      employeeId: String(employee.id),
      actorUserId: auth.user.id,
      commandId: parsed.data.account.command_id,
      email: parsed.data.account.email,
      fullName: parsed.data.account.full_name || String(employee.full_name),
      role: parsed.data.account.role as OrgRole,
      password: parsed.data.account.password,
    });
    return NextResponse.json({
      employee: identity.employee,
      account: {
        user_id: identity.user.id,
        email: identity.user.email,
        role: parsed.data.account.role,
        active: true,
      },
      requestId: auth.requestId,
    }, { status: 201 });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to begin employee onboarding.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}
