import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import {
  EmployeeLifecycleError,
  inviteAndLinkEmployeeIdentity,
  setEmployeeIdentityPassword,
} from "@/lib/server/employee-lifecycle";
import { isStrongEmployeeAccountPassword } from "@/lib/employee-account-password";
import type { OrgRole } from "@/types/database";

const passwordSchema = z.string().refine(isStrongEmployeeAccountPassword);
const accountSchema = z.object({
  command_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().min(2).max(160).optional(),
  role: z.enum(["employee", "hr_admin", "hr_recruitment", "training_manager", "onground_agent_manager", "inventory_receiver", "promoter", "finance_manager", "accountant", "finance_viewer", "supervisor"]),
  password: passwordSchema,
});
const passwordUpdateSchema = z.object({
  employee_id: z.string().uuid(),
  password: passwordSchema,
});

function invalidPasswordResponse() {
  return NextResponse.json(
    { message: "Password must contain 12+ characters, uppercase and lowercase letters, and a number." },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const parsed = accountSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "password")) {
      return invalidPasswordResponse();
    }
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid employee account request." }, { status: 400 });
  }

  const employeeResult = await auth.admin
    .from("employees")
    .select("full_name")
    .eq("org_id", auth.orgId)
    .eq("id", parsed.data.employee_id)
    .maybeSingle();
  if (employeeResult.error) return NextResponse.json({ message: employeeResult.error.message }, { status: 500 });
  if (!employeeResult.data) return NextResponse.json({ message: "Employee was not found." }, { status: 404 });

  try {
    const result = await inviteAndLinkEmployeeIdentity(auth.admin, {
      orgId: auth.orgId,
      employeeId: parsed.data.employee_id,
      actorUserId: auth.user.id,
      commandId: parsed.data.command_id,
      email: parsed.data.email,
      fullName: parsed.data.full_name || employeeResult.data.full_name,
      role: parsed.data.role as OrgRole,
      password: parsed.data.password,
    });
    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        full_name: parsed.data.full_name || employeeResult.data.full_name,
        role: parsed.data.role,
      },
      employee: result.employee,
      delivery: result.createdWithPassword
        ? "password_account_created"
        : result.invited
          ? "invitation_sent"
          : "existing_account_linked",
      requestId: auth.requestId,
    });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to invite employee account.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const parsed = passwordUpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "password")) {
      return invalidPasswordResponse();
    }
    return NextResponse.json({ message: "Invalid employee password request." }, { status: 400 });
  }

  try {
    const result = await setEmployeeIdentityPassword(auth.admin, {
      orgId: auth.orgId,
      employeeId: parsed.data.employee_id,
      actorUserId: auth.user.id,
      password: parsed.data.password,
    });
    return NextResponse.json({
      user: { id: result.userId },
      password_updated: true,
      requestId: auth.requestId,
    });
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json(
      { message: lifecycleError?.message || "Unable to update employee password.", requestId: auth.requestId },
      { status: lifecycleError?.status || 500 }
    );
  }
}
