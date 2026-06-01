import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "hr_admin", "training_manager"]);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const membershipRecord = membership as Record<string, unknown> | null;
  const orgId = String(membershipRecord?.org_id || "");
  const role = String(membershipRecord?.role || "");

  if (membershipError || !orgId || !allowedRoles.has(role)) {
    return NextResponse.json({ message: "You are not allowed to send task messages." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const taskId = String((body as Record<string, unknown>).task_id || "").trim();
  const employeeId = String((body as Record<string, unknown>).employee_id || "").trim();
  const message = String((body as Record<string, unknown>).message || "").trim();

  if (!taskId) return NextResponse.json({ message: "Task id is required." }, { status: 400 });
  if (!employeeId) return NextResponse.json({ message: "Employee is required." }, { status: 400 });
  if (message.length < 2) return NextResponse.json({ message: "Message is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("id, title, created_by, status")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();

  if (taskError) return NextResponse.json({ message: taskError.message }, { status: 500 });
  if (!task) return NextResponse.json({ message: "Task was not found." }, { status: 404 });

  const taskRecord = task as Record<string, unknown>;
  if (role === "hr_admin" && String(taskRecord.created_by || "") !== user.id) {
    return NextResponse.json({ message: "You can message only employees on tasks you created." }, { status: 403 });
  }

  const { data: assignee, error: assigneeError } = await admin
    .from("employees")
    .select("id, user_id, full_name, manager_id")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (assigneeError) return NextResponse.json({ message: assigneeError.message }, { status: 500 });
  if (!assignee) return NextResponse.json({ message: "Employee was not found." }, { status: 404 });

  const assigneeRecord = assignee as Record<string, unknown>;
  if (role === "training_manager") {
    const { data: managerEmployee, error: managerError } = await admin
      .from("employees")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (managerError) return NextResponse.json({ message: managerError.message }, { status: 500 });
    const managerEmployeeId = String((managerEmployee as Record<string, unknown> | null)?.id || "");
    if (!managerEmployeeId || String(assigneeRecord.manager_id || "") !== managerEmployeeId) {
      return NextResponse.json({ message: "You can message only employees managed by you." }, { status: 403 });
    }
  }

  const { data: assignment, error: assignmentError } = await admin
    .from("task_assignments")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (assignmentError) return NextResponse.json({ message: assignmentError.message }, { status: 500 });
  if (!assignment) return NextResponse.json({ message: "This employee is not assigned to the task." }, { status: 404 });

  const { data: senderEmployee } = await admin
    .from("employees")
    .select("id, full_name")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  const senderRecord = senderEmployee as Record<string, unknown> | null;
  const senderEmployeeId = String(senderRecord?.id || "");
  const senderName = String(senderRecord?.full_name || user.email || "المسؤول");
  const assigneeName = String(assigneeRecord.full_name || "الموظف");
  const taskTitle = String(taskRecord.title || "مهمة");
  const assignmentStatus = String((assignment as Record<string, unknown>).status || taskRecord.status || "pending");

  const { data: update, error: updateError } = await admin
    .from("task_updates")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: senderEmployeeId || null,
      status: assignmentStatus,
      progress: assignmentStatus === "completed" ? 100 : assignmentStatus === "in_progress" ? 50 : 0,
      note: `رسالة إلى ${assigneeName}: ${message}`,
    } as never)
    .select()
    .single();

  if (updateError) return NextResponse.json({ message: updateError.message }, { status: 500 });

  const assigneeUserId = String(assigneeRecord.user_id || "");
  if (assigneeUserId) {
    await admin.from("notifications").insert({
      org_id: orgId,
      user_id: assigneeUserId,
      title: `رسالة جديدة بخصوص مهمة: ${taskTitle}`,
      body: `${senderName}: ${message}`,
      type: "task",
      link: `/tasks/mine?task=${encodeURIComponent(taskId)}`,
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data: { update } });
}
