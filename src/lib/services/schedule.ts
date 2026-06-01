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
  const supabase = createClient();
  const orgId = String(values.org_id || "");
  const name = String(values.name || "").trim();
  const normalizedName = name.toLowerCase();

  if (!orgId || !name) {
    return {
      data: null,
      error: { message: "اسم الوردية مطلوب." },
    };
  }

  const existing = await supabase
    .from("shifts")
    .select("id, name")
    .eq("org_id", orgId);

  const hasDuplicate = (existing.data || []).some((shift: Record<string, unknown>) =>
    String(shift.name || "").trim().toLowerCase() === normalizedName
  );

  if (hasDuplicate) {
    return {
      data: null,
      error: { message: "يوجد وردية بنفس الاسم بالفعل. اختر اسمًا مختلفًا." },
    };
  }

  const result = await supabase
    .from("shifts")
    .insert({ ...values, name } as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateShift(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const orgId = String(values.org_id || "");
  const name = typeof values.name === "string" ? values.name.trim() : "";

  if (orgId && name) {
    const existing = await supabase
      .from("shifts")
      .select("id, name")
      .eq("org_id", orgId);

    const normalizedName = name.toLowerCase();
    const hasDuplicate = (existing.data || []).some((shift: Record<string, unknown>) =>
      String(shift.id || "") !== id &&
      String(shift.name || "").trim().toLowerCase() === normalizedName
    );

    if (hasDuplicate) {
      return {
        data: null,
        error: { message: "يوجد وردية بنفس الاسم بالفعل. اختر اسمًا مختلفًا." },
      };
    }
  }

  const result = await supabase
    .from("shifts")
    .update((name ? { ...values, name } : values) as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteShift(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
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
  const supabase = createClient();
  const result = await supabase
    .from("employee_shifts")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function removeEmployeeShift(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_shifts")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
