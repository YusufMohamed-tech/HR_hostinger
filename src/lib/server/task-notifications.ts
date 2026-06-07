import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

type TaskNotificationInput = {
  orgId: string;
  taskId: string;
  actorUserId: string;
  actorEmployeeId: string;
  action: "note" | "status";
  status?: string;
  note?: string;
};

const statusLabels: Record<string, string> = {
  pending: "معلق",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  delayed: "متأخر",
};

export async function notifyTaskStakeholders(admin: AdminClient, input: TaskNotificationInput) {
  const { orgId, taskId, actorUserId, actorEmployeeId, action } = input;

  const { data: task } = await admin
    .from("tasks")
    .select("id, title, created_by")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();

  const { data: actor } = await admin
    .from("employees")
    .select("id, full_name, manager_id")
    .eq("org_id", orgId)
    .eq("id", actorEmployeeId)
    .maybeSingle();

  const taskRecord = task as Record<string, unknown> | null;
  const actorRecord = actor as Record<string, unknown> | null;
  const taskTitle = String(taskRecord?.title || "مهمة");
  const actorName = String(actorRecord?.full_name || "موظف");
  const recipients = new Set<string>();

  const creatorUserId = typeof taskRecord?.created_by === "string" ? taskRecord.created_by : "";
  if (creatorUserId && creatorUserId !== actorUserId) {
    recipients.add(creatorUserId);
  }

  const managerId = typeof actorRecord?.manager_id === "string" ? actorRecord.manager_id : "";
  if (managerId) {
    const { data: manager } = await admin
      .from("employees")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("id", managerId)
      .maybeSingle();
    const managerUserId = String((manager as Record<string, unknown> | null)?.user_id || "");
    if (managerUserId && managerUserId !== actorUserId) {
      recipients.add(managerUserId);
    }
  }

  const { data: admins } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["admin", "hr_admin"]);

  for (const adminMember of (admins || []) as Record<string, unknown>[]) {
    const userId = String(adminMember.user_id || "");
    if (userId && userId !== actorUserId) {
      recipients.add(userId);
    }
  }

  if (recipients.size === 0) return;

  const isCompletion = input.status === "completed";
  const statusText = input.status ? statusLabels[input.status] || input.status : "";
  const title = action === "note"
    ? `رسالة جديدة على مهمة: ${taskTitle}`
    : isCompletion
      ? `تم إكمال مهمة: ${taskTitle}`
      : `تحديث حالة مهمة: ${taskTitle}`;
  const body = action === "note"
    ? `${actorName}: ${input.note || "أرسل رسالة جديدة."}`
    : `${actorName} غيّر حالة المهمة إلى ${statusText}.${input.note ? ` ${input.note}` : ""}`;

  const rows = Array.from(recipients).map((userId) => ({
    org_id: orgId,
    user_id: userId,
    title,
    body,
    type: "task",
    link: `/tasks?task=${encodeURIComponent(taskId)}`,
    is_read: false,
  }));

  await admin.from("notifications").insert(rows as never);
}
