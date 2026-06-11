export interface SuperadminOrganization {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  memberCount: number;
  employeeCount: number;
  adminCount: number;
  hrAdminCount: number;
  hrRecruitmentCount: number;
}

export interface SuperadminOrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    title: string | null;
    account_status: string | null;
  } | null;
}

export interface SuperadminOrganizationDetail {
  organization: SuperadminOrganization;
  members: SuperadminOrganizationMember[];
  counts: {
    memberCount: number;
    employeeCount: number;
    adminCount: number;
    hrAdminCount: number;
    hrRecruitmentCount: number;
  };
}

export interface SuperadminAuditLog {
  id: string;
  actor_user_id: string | null;
  actor_role: string;
  action: string;
  target_org_id: string | null;
  target_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_profile: {
    user_id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  target_organization: {
    id: string;
    name: string | null;
    slug: string | null;
  } | null;
}

export interface SuperadminDashboardData {
  generated_at: string;
  stats: Record<string, unknown>;
  moduleCards: Array<{
    key: string;
    label: string;
    value: string | number;
    helper: string;
    href: string;
    tone: string;
  }>;
  decisionQueue: Array<{
    key: string;
    label: string;
    value: number;
    href: string;
  }>;
  recentActivity: Array<{
    id: string;
    source: string;
    title: string;
    description: string;
    actor: string;
    organization: string;
    occurred_at: string;
    href: string;
  }>;
  recentUsers: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    organization: string;
    created_at: string;
  }>;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    raw_status: string;
    members: number;
    employees: number;
    created_at: string;
  }>;
}

type Result<T> = { data: T | null; error: { message: string } | null };

async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<Result<T>> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || fallbackMessage) },
    };
  }

  return {
    data: (payload?.data ?? payload ?? null) as T | null,
    error: null,
  };
}

export async function getSuperadminOrganizations() {
  const response = await fetch("/api/superadmin/organizations", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminOrganization[]>(response, "Unable to load organizations.");
}

export async function getSuperadminDashboard() {
  const response = await fetch("/api/superadmin/dashboard", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminDashboardData>(response, "Unable to load superadmin dashboard.");
}

export async function getSuperadminOrganization(id: string) {
  const response = await fetch(`/api/superadmin/organizations/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminOrganizationDetail>(response, "Unable to load organization.");
}

export async function getSuperadminAuditLogs(limit = 100) {
  const response = await fetch(`/api/superadmin/audit?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminAuditLog[]>(response, "Unable to load audit logs.");
}

export async function createSuperadminOrganization(values: {
  name: string;
  slug?: string;
  status?: string;
}) {
  const response = await fetch("/api/superadmin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  return parseResponse<SuperadminOrganization>(response, "Unable to create organization.");
}

export async function updateSuperadminOrganization(
  id: string,
  values: { name?: string; slug?: string; status?: string }
) {
  const response = await fetch("/api/superadmin/organizations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...values }),
  });

  return parseResponse<SuperadminOrganization>(response, "Unable to update organization.");
}
