import { createClient } from "@/lib/supabase/client";

export async function getAttendance(orgId: string, workDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_records")
    .select("*, employee:employee_id(full_name, employee_code, manager_id), location:location_id(name), shift:shift_id(name, shift_type, location:location_id(name))")
    .eq("org_id", orgId)
    .order("check_in_at", { ascending: false });

  if (workDate) {
    query = query.eq("work_date", workDate);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeAttendance(orgId: string, employeeId: string, workDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_records")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("work_date", { ascending: false });

  if (workDate) {
    query = query.eq("work_date", workDate);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createCheckIn(values: Record<string, unknown>) {
  const key = `attendance:check-in:${String(values.org_id || "")}:${String(values.employee_id || "")}:${String(values.work_date || "today")}`;
  const requestId = attendanceRequestId(key, values.request_id);
  return attendanceCommand("/api/attendance/check-in", {
    requestId,
    latitude: Number(values.check_in_lat),
    longitude: Number(values.check_in_lng),
    accuracyMeters: numericOrNull(values.check_in_accuracy_meters || values.accuracy_meters),
    deviceLabel: String(values.check_in_device || "").slice(0, 500) || null,
    deviceSignal: String(values.device_fingerprint || "").slice(0, 500) || null,
    photoPath: String(values.check_in_photo_path || "").slice(0, 1500) || null,
  });
}

export async function updateCheckOut(orgId: string, employeeId: string, id: string, values: Record<string, unknown>) {
  const key = `attendance:check-out:${orgId}:${employeeId}:${id}`;
  const requestId = attendanceRequestId(key, values.request_id);
  return attendanceCommand("/api/attendance/check-out", {
    attendanceId: id,
    requestId,
    latitude: Number(values.check_out_lat),
    longitude: Number(values.check_out_lng),
    accuracyMeters: numericOrNull(values.check_out_accuracy_meters || values.accuracy_meters),
    deviceLabel: String(values.check_out_device || "").slice(0, 500) || null,
    deviceSignal: String(values.device_fingerprint || "").slice(0, 500) || null,
  });
}

function numericOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function attendanceRequestId(key: string, supplied: unknown) {
  if (typeof supplied === "string" && supplied) return supplied;
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

async function attendanceCommand(path: string, body: Record<string, unknown>) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { data: null, error: { message: String(data.message || "Unable to record attendance.") } };
    }
    return { data: (data.record ?? null) as Record<string, unknown> | null, error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Unable to connect to attendance service." },
    };
  }
}

export async function notifyMissingAttendanceLocation(action: "check_in" | "check_out") {
  try {
    const response = await fetch("/api/attendance/missing-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; message?: string; error?: string };
    if (!response.ok) return { data: null, error: { message: json.message || json.error || "تعذر إرسال تنبيه الموارد البشرية." } };
    return { data: json.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." } };
  }
}
