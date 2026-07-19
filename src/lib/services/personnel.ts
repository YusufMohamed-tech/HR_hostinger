import { createClient } from "@/lib/supabase/client";

export async function getPersonnelFiles(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("personnel_files")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

function personnelFormData(mode: "personnel_file" | "employee_contract", values: Record<string, unknown>, file: File) {
  const formData = new FormData();
  formData.append("mode", mode);
  formData.append("row_id", crypto.randomUUID());
  formData.append("command_id", crypto.randomUUID());
  formData.append("file", file);
  for (const [key, value] of Object.entries(values)) {
    if (key === "org_id" || value === undefined || value === null || value === "") continue;
    formData.append(key, String(value));
  }
  return formData;
}

export async function createPersonnelFile(values: Record<string, unknown>, file: File) {
  const response = await fetch("/api/personnel/files", { method: "POST", body: personnelFormData("personnel_file", values, file) });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to register personnel file.") } };
}

export async function getPersonnelFileUrl(id: string, ownerType: "personnel_file" | "employee_contract" | "employee_document") {
  const response = await fetch(`/api/personnel/files?id=${encodeURIComponent(id)}&owner_type=${encodeURIComponent(ownerType)}`,
    { method: "GET", cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as { signedUrl: string } | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to open personnel file.") } };
}

export async function getSocialInsurance(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("social_insurance")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function upsertSocialInsurance(values: Record<string, unknown>) {
  const employeeId = String(values.employee_id || "");
  const employeeRate = Number(values.employee_rate_percent ?? values.contribution_rate ?? 0);
  const employerRate = Number(values.employer_rate_percent ?? 0);
  const response = await fetch("/api/payroll/social-insurance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employee_id: employeeId,
      command_id: crypto.randomUUID(),
      registered: values.registered !== false && values.status !== "inactive",
      gosi_number: values.gosi_number,
      registration_date: values.registration_date,
      scheme_code: values.scheme_code,
      contributory_wage: Number(values.contributory_wage ?? 0),
      maximum_contributory_wage: Number(values.maximum_contributory_wage ?? 0),
      employee_rate_basis_points: Math.round(employeeRate * 100),
      employer_rate_basis_points: Math.round(employerRate * 100),
      prorate_partial_month: Boolean(values.prorate_partial_month),
      effective_from: values.effective_from,
      effective_to: values.effective_to,
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return response.ok
    ? { data: (payload.socialInsurance || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(payload.message || "Unable to configure social insurance.") } };
}

export async function getEmployeeContracts(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("employee_contracts")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("start_date", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createEmployeeContract(values: Record<string, unknown>, file: File) {
  const response = await fetch("/api/personnel/files", { method: "POST", body: personnelFormData("employee_contract", values, file) });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to register employee contract.") } };
}

export async function enqueuePersonnelComplianceReminders() {
  const response = await fetch("/api/personnel/compliance", { method: "POST" });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as { alertsEnqueued: number } | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to enqueue compliance reminders.") } };
}
