import { createClient } from "@/lib/supabase/client";

/**
 * Creates a notification for all admin users in an organization.
 */
async function notifyAdmins(orgId: string, title: string, body: string, type: "system" | "attendance" | "task" | "leave" = "system") {
  const supabase = createClient();
  
  // Get all admin users in the org
  const { data: admins } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");
    
  if (!admins || admins.length === 0) return;
  
  const notifications = admins.map((admin: Record<string, unknown>) => ({
    org_id: orgId,
    user_id: String(admin.user_id),
    title,
    body,
    type,
    is_read: false
  }));
  
  await supabase.from("notifications").insert(notifications as never);
}

/**
 * Creates a notification for a specific employee.
 */
async function notifyEmployee(
  orgId: string,
  employeeId: string,
  title: string,
  body: string,
  type: "system" | "attendance" | "task" | "leave" = "system",
  link?: string
) {
  const supabase = createClient();
  
  // Get the user_id for the employee
  const { data: employee } = await supabase
    .from("employees")
    .select("user_id")
    .eq("id", employeeId)
    .single();
    
  if (!employee || !(employee as Record<string, unknown>).user_id) return;
  
  await supabase.from("notifications").insert({
    org_id: orgId,
    user_id: String((employee as Record<string, unknown>).user_id),
    title,
    body,
    type,
    link: link || null,
    is_read: false
  } as never);
}

export async function notifyHrLateArrival(orgId: string, employeeName: string, lateMinutes: number) {
  await notifyAdmins(
    orgId, 
    "Late Arrival Alert", 
    `${employeeName} has checked in late by ${lateMinutes} minutes.`, 
    "attendance"
  );
}

export async function notifyTaskAssigned(orgId: string, employeeId: string, taskTitle: string, taskId?: string) {
  await notifyEmployee(
    orgId,
    employeeId,
    "New Task Assigned",
    `You have been assigned a new task: "${taskTitle}".`,
    "task",
    taskId ? `/tasks/mine?task=${encodeURIComponent(taskId)}` : "/tasks/mine"
  );
}

export async function notifyLeaveDecision(orgId: string, employeeId: string, leaveType: string, status: "approved" | "rejected") {
  await notifyEmployee(
    orgId,
    employeeId,
    "Leave Request Update",
    `Your ${leaveType} leave request has been ${status}.`,
    "leave"
  );
}
