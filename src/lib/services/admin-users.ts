export async function createManagedUser(values: {
  full_name: string;
  email: string;
  password: string;
  role: "hr_admin" | "hr_recruitment";
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
