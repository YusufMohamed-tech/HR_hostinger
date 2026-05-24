import { createClient } from "@/lib/supabase/client";

export async function getAttendance(orgId: string, workDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_records")
    .select("*, employee:employee_id(full_name, employee_code), shift:shift_id(name, shift_type, location:location_id(name))")
    .eq("org_id", orgId)
    .order("check_in_at", { ascending: false });

  if (workDate) {
    query = query.eq("work_date", workDate);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeAttendance(employeeId: string, workDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_records")
    .select("*")
    .eq("employee_id", employeeId)
    .order("work_date", { ascending: false });

  if (workDate) {
    query = query.eq("work_date", workDate);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createCheckIn(values: Record<string, unknown>) {
  const supabase = createClient();
  const employeeId = values.employee_id as string;
  const currentDevice = values.check_in_device as string;

  // Device locking logic
  const empRes = await supabase.from("employees").select("registered_device_id").eq("id", employeeId).single();
  const employee = empRes.data as { registered_device_id?: string | null } | null;
  const registeredDevice = employee?.registered_device_id;

  if (registeredDevice && registeredDevice !== currentDevice) {
    return { data: null, error: { message: "Attendance locked to your registered device. Please use your primary device." } };
  } else if (!registeredDevice) {
    // Register this device implicitly on first use
    await supabase.from("employees").update({ registered_device_id: currentDevice } as never).eq("id", employeeId);
  }

  const result = await supabase
    .from("attendance_records")
    .insert(values as never)
    .select()
    .single();

  if (result.error && result.error.code === "23505") { // unique constraint violation
    return { data: null, error: { message: "You have already checked in for today." } };
  }

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateCheckOut(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("attendance_records")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function uploadAttendanceSelfie(
  orgId: string,
  employeeId: string,
  workDate: string,
  file: File
) {
  const supabase = createClient();
  const fileExt = file.name.split(".").pop() || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
  const filePath = `${orgId}/${employeeId}/${workDate}/${fileName}`;

  const result = await supabase
    .storage
    .from("attendance-selfies")
    .upload(filePath, file, { upsert: true });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}
