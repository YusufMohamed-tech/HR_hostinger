import { createClient } from "@/lib/supabase/client";

export async function getCourses(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("courses" as never)
    .select("*, enrollments(count), course_modules(count)")
    .eq("org_id", orgId)
    .order("title");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getCourseById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("courses" as never)
    .select("*, course_modules(*), enrollments(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
