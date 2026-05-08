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
  const result = await supabase
    .from("attendance_records")
    .insert(values as never)
    .select()
    .single();

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
