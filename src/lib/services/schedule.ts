import { createClient } from "@/lib/supabase/client";

export async function getShifts(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts")
    .select("*, location:location_id(name)")
    .eq("org_id", orgId)
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createShift(values: Record<string, unknown>) {
  const name = String(values.name || "").trim();
  if (!name) {
    return {
      data: null,
      error: { message: "اسم الوردية مطلوب." },
    };
  }
  return scheduleCommand({ action: "save_shift", command_id: crypto.randomUUID(), target_id: crypto.randomUUID(),
    expected_version: null, name, shift_type: values.shift_type, start_time: values.start_time,
    end_time: values.end_time, location_id: values.location_id || null });
}

export async function updateShift(id: string, values: Record<string, unknown>) {
  const name = typeof values.name === "string" ? values.name.trim() : "";
  return scheduleCommand({ action: "save_shift", command_id: crypto.randomUUID(), target_id: id,
    expected_version: Number(values.expected_version), name, shift_type: values.shift_type,
    start_time: values.start_time, end_time: values.end_time, location_id: values.location_id || null });
}

export async function deleteShift(id: string, expectedVersion: number) {
  return scheduleCommand({ action: "delete_shift", command_id: crypto.randomUUID(), target_id: id,
    expected_version: expectedVersion });
}

export async function getEmployeeShifts(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("employee_shifts")
    .select("*, shift:shift_id(name, shift_type, start_time, end_time, location:location_id(name)), employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const result = await query.order("start_date", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function assignEmployeeShift(values: Record<string, unknown>) {
  return scheduleCommand({ action: "assign_shift", command_id: crypto.randomUUID(), target_id: crypto.randomUUID(),
    employee_id: values.employee_id, shift_id: values.shift_id,
    start_date: values.start_date || undefined, end_date: values.end_date || undefined });
}

export async function removeEmployeeShift(id: string, expectedVersion: number) {
  return scheduleCommand({ action: "remove_assignment", command_id: crypto.randomUUID(), target_id: id,
    expected_version: expectedVersion });
}

async function scheduleCommand(values: Record<string, unknown>) {
  try {
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": crypto.randomUUID() },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: Record<string, unknown>;
      message?: string;
    };
    return response.ok
      ? { data: payload.data || null, error: null }
      : { data: null, error: { message: payload.message || "تعذر تنفيذ أمر الجدول." } };
  } catch {
    return { data: null, error: { message: "تعذر الاتصال بخدمة الجداول." } };
  }
}
