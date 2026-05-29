export async function createManagedUser(values: {
  full_name: string;
  email: string;
  password: string;
  role: "admin" | "hr_admin" | "hr_recruitment";
  target_org_id?: string;
}) {
  const response = await fetch("/api/superadmin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload.message || "Unable to create user.") },
    };
  }

  return { data: payload.user as Record<string, unknown>, error: null };
}

export async function updateManagedUser(values: {
  user_id: string;
  target_org_id: string;
  action: "suspend" | "activate" | "reset_password";
  password?: string;
}) {
  const response = await fetch("/api/superadmin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload.message || "Unable to update user.") },
    };
  }

  return { data: payload.user as Record<string, unknown>, error: null };
}
