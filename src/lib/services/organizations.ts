type OrganizationSettingsPayload = {
  organization: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  features: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
};

async function apiFetch<T>(path: string, options?: RequestInit) {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { data: null, error: { message: String(payload?.message || "Unable to load organization.") } };
    }
    return { data: (payload?.data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Unable to reach the server." } };
  }
}

export async function getCurrentOrganizationSettings() {
  return apiFetch<OrganizationSettingsPayload>("/api/organization/settings");
}

export async function updateCurrentOrganizationSettings(values: {
  name?: string;
  settings?: Record<string, unknown>;
}) {
  return apiFetch<OrganizationSettingsPayload>("/api/organization/settings", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function getOrganizations() {
  const result = await getCurrentOrganizationSettings();
  return {
    data: result.data?.organization ? [result.data.organization] : [],
    error: result.error,
  };
}

export async function createOrganization(_values: Record<string, unknown>) {
  void _values;
  return {
    data: null,
    error: { message: "Workspace organization creation is managed from the superadmin console." },
  };
}

export async function updateOrganization(_id: string, values: Record<string, unknown>) {
  return updateCurrentOrganizationSettings({
    name: typeof values.name === "string" ? values.name : undefined,
    settings: values.settings as Record<string, unknown> | undefined,
  });
}

export async function deleteOrganization(_id: string) {
  void _id;
  return {
    error: { message: "Organizations are soft-deleted from the superadmin console; hard delete is disabled." },
  };
}
