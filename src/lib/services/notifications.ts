import { createClient } from "@/lib/supabase/client";

export async function getNotifications(orgId: string, userId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("notifications")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createNotification(values: {
  org_id: string;
  user_id: string;
  title: string;
  message: string;
  type?: string;
  link?: string;
}) {
  const supabase = createClient();
  const result = await supabase
    .from("notifications")
    .insert({ ...values, is_read: false } as never)
    .select()
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function markNotificationRead(id: string, isRead = true) {
  const supabase = createClient();
  const result = await supabase
    .from("notifications")
    .update({ is_read: isRead } as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function markAllNotificationsRead(orgId: string, userId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("notifications")
    .update({ is_read: true } as never)
    .eq("org_id", orgId)
    .eq("user_id", userId);

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

