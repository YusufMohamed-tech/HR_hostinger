export type OnboardingEmployee = {
  id: string;
  full_name: string;
  employee_code: string | null;
  email: string | null;
  lifecycle_status: string;
  onboarding_status: string;
  onboarding_progress: number;
  onboarding_due_at: string | null;
};

export type OnboardingCase = {
  id: string;
  employee_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  progress_percent: number;
  target_completion_at: string | null;
};

export type OnboardingItem = {
  id: string;
  employee_id: string;
  requirement_code: string;
  label_ar: string;
  label_en: string;
  category: string;
  evidence_kind: string;
  employee_can_submit: boolean;
  severity: string;
  capability: string | null;
  status: string;
  due_at: string | null;
  managed_file_id: string | null;
  decision_reason: string | null;
};

export type CapabilityReadiness = {
  employee_id: string;
  capability: string;
  account_and_employment_active: boolean;
  is_ready: boolean;
  blocking_requirements: string[];
};

export type OnboardingWorkspace = {
  employees: OnboardingEmployee[];
  cases: OnboardingCase[];
  items: OnboardingItem[];
  capabilities: CapabilityReadiness[];
  canManage: boolean;
};

export async function getOnboardingWorkspace(employeeId?: string) {
  const params = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const response = await fetch(`/api/hr/onboarding${params}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as OnboardingWorkspace | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to load onboarding readiness.") } };
}

export async function updateOnboardingItem(values: {
  item_id: string;
  action: "request" | "review" | "verify" | "reject" | "waive" | "not_applicable" | "reopen" | "set_due";
  reason?: string | null;
  due_at?: string | null;
}) {
  const response = await fetch("/api/hr/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: payload?.data || null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to update onboarding item.") } };
}

export async function createOnboardingRequirement(values: {
  employee_id: string;
  label_ar: string;
  label_en?: string | null;
  category?: "identity" | "contract" | "compliance" | "payroll" | "attendance" | "employment" | "other";
  evidence_kind?: "document" | "form" | "assignment" | "approval" | "none";
  severity?: "required" | "compliance" | "capability" | "recommended";
  capability?: "general" | "payroll" | "payroll_payment" | "attendance" | "inventory" | "sales" | "accounting" | null;
  due_at?: string | null;
  employee_can_submit?: boolean;
}) {
  const response = await fetch("/api/hr/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: payload?.data || null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to add employee requirement.") } };
}
