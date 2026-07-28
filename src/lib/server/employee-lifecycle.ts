import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { armIdentityDeletion, cancelIdentityDeletion } from "@/lib/server/identity-reconciliation";
import type { Json, OrgRole } from "@/types/database";

type AdminClient = ReturnType<typeof createAdminClient>;
type EmployeeRow = Record<string, unknown>;

export class EmployeeLifecycleError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "EmployeeLifecycleError";
    this.status = status;
    this.code = code;
  }
}

function lifecycleError(error: { message: string; code?: string } | null, fallback: string) {
  const code = error?.code;
  const status = code === "23505" ? 409
    : code === "23503" || code === "P0002" ? 404
      : code === "23514" || code === "22023" ? 400
        : code === "42501" ? 403
          : 500;
  return new EmployeeLifecycleError(error?.message || fallback, status, code);
}

function firstRow(data: unknown, fallback: string) {
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") throw new EmployeeLifecycleError(fallback, 500);
  return row as EmployeeRow;
}

export async function beginEmployeeOnboarding(
  admin: AdminClient,
  values: {
    orgId: string;
    actorUserId: string;
    commandId: string;
    employee: Json;
    sourceType?: string;
    sourceId?: string | null;
  }
) {
  if (values.sourceId) {
    const existing = await admin
      .from("employee_lifecycle_commands")
      .select("employee_id, status")
      .eq("org_id", values.orgId)
      .eq("source_type", values.sourceType || "hr")
      .eq("source_id", values.sourceId)
      .eq("action", "begin_onboarding")
      .eq("status", "completed")
      .maybeSingle();
    if (existing.error) throw lifecycleError(existing.error, "Unable to inspect employee onboarding state.");
    if (existing.data?.employee_id) {
      const employee = await admin
        .from("employees")
        .select("*")
        .eq("org_id", values.orgId)
        .eq("id", String(existing.data.employee_id))
        .single();
      if (employee.error || !employee.data) throw lifecycleError(employee.error, "Onboarded employee was not found.");
      return employee.data as EmployeeRow;
    }
  }

  const { data, error } = await admin.rpc("begin_employee_onboarding", {
    p_org_id: values.orgId,
    p_actor_user_id: values.actorUserId,
    p_command_id: values.commandId,
    p_employee: values.employee,
    p_source_type: values.sourceType || "hr",
    p_source_id: values.sourceId || null,
  });
  if (error) throw lifecycleError(error, "Unable to begin employee onboarding.");
  return firstRow(data, "Employee onboarding returned no employee.");
}

export async function finalizeEmployeeOnboarding(
  admin: AdminClient,
  values: { orgId: string; employeeId: string; actorUserId: string; commandId: string }
) {
  const { data, error } = await admin.rpc("finalize_employee_onboarding", {
    p_org_id: values.orgId,
    p_employee_id: values.employeeId,
    p_actor_user_id: values.actorUserId,
    p_command_id: values.commandId,
  });
  if (error) throw lifecycleError(error, "Unable to finalize employee onboarding.");
  return firstRow(data, "Employee finalization returned no employee.");
}

export async function setEmployeeLocations(
  admin: AdminClient,
  values: { orgId: string; employeeId: string; locationIds: string[]; primaryLocationId?: string | null }
) {
  const { error } = await admin.rpc("set_employee_locations", {
    p_org_id: values.orgId,
    p_employee_id: values.employeeId,
    p_location_ids: [...new Set(values.locationIds.filter(Boolean))],
    p_primary_location_id: values.primaryLocationId || null,
  });
  if (error) throw lifecycleError(error, "Unable to update employee locations.");
}

export async function offboardEmployee(
  admin: AdminClient,
  values: {
    orgId: string;
    employeeId: string;
    actorUserId: string;
    commandId: string;
    effectiveDate: string;
    reason: string;
    terminationType?: string;
  }
) {
  const { data, error } = await admin.rpc("offboard_employee", {
    p_org_id: values.orgId,
    p_employee_id: values.employeeId,
    p_actor_user_id: values.actorUserId,
    p_command_id: values.commandId,
    p_effective_date: values.effectiveDate,
    p_reason: values.reason,
    p_termination_type: values.terminationType || "termination",
  });
  if (error) throw lifecycleError(error, "Unable to offboard employee.");
  const employee = firstRow(data, "Employee offboarding returned no employee.");
  return employee;
}

export async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  let page = 1;
  const perPage = 100;
  const normalizedEmail = email.trim().toLowerCase();

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new EmployeeLifecycleError(error.message, 500);
    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

export async function inviteAndLinkEmployeeIdentity(
  admin: AdminClient,
  values: {
    orgId: string;
    employeeId: string;
    actorUserId: string;
    commandId: string;
    email: string;
    fullName: string;
    role: OrgRole;
    password?: string;
  }
) {
  const employeeResult = await admin
    .from("employees")
    .select("id, org_id, user_id, lifecycle_status")
    .eq("org_id", values.orgId)
    .eq("id", values.employeeId)
    .maybeSingle();
  if (employeeResult.error) throw lifecycleError(employeeResult.error, "Unable to load employee.");
  if (!employeeResult.data) throw new EmployeeLifecycleError("Employee was not found.", 404);
  if (["offboarding", "offboarded", "archived"].includes(String(employeeResult.data.lifecycle_status))) {
    throw new EmployeeLifecycleError("Login access cannot be created for an offboarded employee.", 409);
  }

  const email = values.email.trim().toLowerCase();
  let authUser = await findAuthUserByEmail(admin, email);
  let invited = false;
  let createdWithPassword = false;
  let cleanupJobId = "";

  if (authUser) {
    const membership = await admin.from("org_members").select("org_id, role").eq("user_id", authUser.id).maybeSingle();
    if (membership.error) throw lifecycleError(membership.error, "Unable to inspect existing login account.");
    if (membership.data && membership.data.org_id !== values.orgId) {
      throw new EmployeeLifecycleError("This email is already attached to another organization.", 409);
    }
    if (membership.data && membership.data.role !== values.role) {
      throw new EmployeeLifecycleError("This login already has a different organization role.", 409);
    }
    if (employeeResult.data.user_id && employeeResult.data.user_id !== authUser.id) {
      throw new EmployeeLifecycleError("Employee already has a different login account.", 409);
    }
  } else {
    const identity = values.password
      ? await admin.auth.admin.createUser({
          email,
          password: values.password,
          email_confirm: true,
          user_metadata: { full_name: values.fullName, identity_command_id: values.commandId },
        })
      : await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: values.fullName, identity_command_id: values.commandId },
        });
    if (identity.error || !identity.data.user) {
      throw new EmployeeLifecycleError(
        identity.error?.message || (values.password ? "Unable to create employee account." : "Unable to invite employee."),
        500
      );
    }
    authUser = identity.data.user;
    invited = !values.password;
    createdWithPassword = Boolean(values.password);
    try {
      cleanupJobId = await armIdentityDeletion(admin, {
        orgId: values.orgId,
        userId: authUser.id,
        sourceType: "provisioning_safety",
        sourceId: values.commandId,
        reason: "Delete provisioned identity if employee linking never completes.",
        actorUserId: values.actorUserId,
        requestId: values.commandId,
      });
    } catch (error) {
      await admin.auth.admin.deleteUser(authUser.id).catch(() => undefined);
      throw new EmployeeLifecycleError(
        error instanceof Error ? error.message : "Unable to protect the employee invitation with cleanup reconciliation.",
        500
      );
    }
  }

  const link = await admin.rpc("link_employee_identity", {
    p_org_id: values.orgId,
    p_employee_id: values.employeeId,
    p_actor_user_id: values.actorUserId,
    p_command_id: values.commandId,
    p_user_id: authUser.id,
    p_email: email,
    p_full_name: values.fullName,
    p_role: values.role,
  });

  if (link.error) {
    throw lifecycleError(link.error, "Unable to link employee login account.");
  }
  const linkedEmployee = firstRow(link.data, "Identity linking returned no employee.");

  if (cleanupJobId) {
    await cancelIdentityDeletion(admin, cleanupJobId, "Employee identity linked successfully.");
  }

  const lifecycleStatus = String(linkedEmployee.lifecycle_status || "").toLowerCase();
  const employmentStatus = String(linkedEmployee.status || "").toLowerCase();
  if (lifecycleStatus === "active" || (!lifecycleStatus && employmentStatus === "active")) {
    const activation = await admin
      .from("profiles")
      .update({ account_status: "Active" })
      .eq("org_id", values.orgId)
      .eq("user_id", authUser.id)
      .select("user_id")
      .single();
    if (activation.error) {
      throw lifecycleError(activation.error, "Unable to activate employee login account.");
    }
  }

  return {
    employee: linkedEmployee,
    user: authUser,
    invited,
    createdWithPassword,
  };
}
