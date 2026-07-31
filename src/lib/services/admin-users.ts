export type ManagedOrgRole =
  | "admin"
  | "hr_admin"
  | "hr_recruitment"
  | "onground_agent_manager"
  | "inventory_receiver"
  | "promoter"
  | "finance_manager"
  | "accountant"
  | "finance_viewer"
  | "supervisor";

export async function createManagedUser(values: {
  full_name: string;
  email: string;
  role: ManagedOrgRole;
  target_org_id?: string;
}) {
  const fingerprint = JSON.stringify(values);
  const scope = `hrms-command:platform-user-create:${fingerprint}`;
  const existing = typeof window !== "undefined" ? window.sessionStorage.getItem(scope) : null;
  const commandId = existing || crypto.randomUUID();
  if (typeof window !== "undefined" && !existing) window.sessionStorage.setItem(scope, commandId);
  const response = await fetch("/api/superadmin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, command_id: commandId }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload.message || "Unable to create user.") },
    };
  }

  if (typeof window !== "undefined") window.sessionStorage.removeItem(scope);

  return { data: payload.user as Record<string, unknown>, error: null };
}

export async function updateManagedUser(values: {
  user_id: string;
  target_org_id: string;
  action: "suspend" | "activate" | "reset_password" | "update_role";
  password?: string;
  role?: ManagedOrgRole;
}) {
  const fingerprint = JSON.stringify(values);
  const scope = `hrms-command:platform-user:${values.user_id}:${fingerprint}`;
  const existing = typeof window !== "undefined" ? window.sessionStorage.getItem(scope) : null;
  const commandId = existing || crypto.randomUUID();
  if (typeof window !== "undefined" && !existing) window.sessionStorage.setItem(scope, commandId);
  const response = await fetch("/api/superadmin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, command_id: commandId }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload.message || "Unable to update user.") },
    };
  }

  if (typeof window !== "undefined") window.sessionStorage.removeItem(scope);

  return { data: payload.user as Record<string, unknown>, error: null };
}
