export type FinanceTeamRole = "finance_manager" | "accountant" | "finance_viewer";

export type FinanceTeamMember = {
  user_id: string;
  org_id: string;
  role: FinanceTeamRole;
  full_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  status: string;
  employee_id: string | null;
  job_title: string | null;
  created_at: string | null;
};

type ApiResult<T> = { data: T | null; error: string | null };

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: String(payload.message || "تعذر تنفيذ العملية.") };
  return { data: payload.data as T, error: null };
}

export async function getFinanceTeam() {
  return apiFetch<FinanceTeamMember[]>("/api/accounting/team");
}

export async function createFinanceTeamMember(values: {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  role: FinanceTeamRole;
}) {
  return apiFetch<FinanceTeamMember>("/api/accounting/team", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateFinanceTeamMember(values: {
  user_id: string;
  role?: FinanceTeamRole;
  full_name?: string;
  phone?: string;
  status?: "active" | "inactive" | "suspended";
}) {
  return apiFetch<FinanceTeamMember>("/api/accounting/team", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}
