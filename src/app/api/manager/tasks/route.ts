import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getValidationMessage, taskFormSchema } from "@/lib/validation";

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

  if (membershipError || !membershipRecord || !orgId) {
    return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
  }

  if (role !== "training_manager") {
    return NextResponse.json({ message: "Only managers can assign team tasks from this endpoint." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const initialMessage = String((body as Record<string, unknown>).initial_message || "").trim();
  const parsed = taskFormSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error) }, { status: 400 });
  }

  const assigneeEmployeeId = parsed.data.employee_id;
  if (!assigneeEmployeeId) {
    return NextResponse.json({ message: "Select an employee from your team." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: managerEmployee, error: managerError } = await admin
    .from("employees")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (managerError) {
    return NextResponse.json({ message: managerError.message }, { status: 500 });
  }

  const managerEmployeeId = String((managerEmployee as Record<string, unknown> | null)?.id || "");
  if (!managerEmployeeId) {
    return NextResponse.json({ message: "Manager employee profile is required." }, { status: 403 });
  }

  const { data: assignee, error: assigneeError } = await admin
    .from("employees")
    .select("id, user_id, full_name")
    .eq("org_id", orgId)
    .eq("id", assigneeEmployeeId)
    .eq("manager_id", managerEmployeeId)
    .maybeSingle();

  if (assigneeError) {
    return NextResponse.json({ message: assigneeError.message }, { status: 500 });
  }
  if (!assignee) {
    return NextResponse.json({ message: "You can assign tasks only to employees managed by you." }, { status: 403 });
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .insert({
      org_id: orgId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_date: parsed.data.due_date || null,
      location_id: null,
      created_by: user.id,
      status: "pending",
    } as never)
    .select()
    .single();

  if (taskError) {
    return NextResponse.json({ message: taskError.message }, { status: 500 });
  }

  const taskRecord = task as Record<string, unknown>;
  const taskId = String(taskRecord.id || "");
  const { data: assignment, error: assignmentError } = await admin
    .from("task_assignments")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: assigneeEmployeeId,
      status: "pending",
    } as never)
    .select()
    .single();

  if (assignmentError) {
    await admin.from("tasks").delete().eq("id", taskId);
    return NextResponse.json({ message: assignmentError.message }, { status: 500 });
  }

  await admin.from("task_updates").insert({
    org_id: orgId,
    task_id: taskId,
    employee_id: managerEmployeeId,
    status: "pending",
    progress: 0,
    note: initialMessage || "Task assigned by the direct manager.",
  } as never);

  const assigneeRecord = assignee as Record<string, unknown>;
  const assigneeUserId = typeof assigneeRecord.user_id === "string" ? assigneeRecord.user_id : "";
  if (assigneeUserId) {
    await admin.from("notifications").insert({
      org_id: orgId,
      user_id: assigneeUserId,
      title: "تم إسناد مهمة جديدة",
      body: initialMessage || parsed.data.title,
      type: "task",
      link: "/tasks",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data: { task, assignment } });
}

export async function PATCH(request: NextRequest) {
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

  if (membershipError || !membershipRecord || !orgId) {
    return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
  }

  if (role !== "training_manager") {
    return NextResponse.json({ message: "Only managers can update team tasks from this endpoint." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const taskId = String((body as Record<string, unknown>).id || "").trim();
  const parsed = taskFormSchema.safeParse(body);

  if (!taskId) {
    return NextResponse.json({ message: "Task id is required." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error) }, { status: 400 });
  }
  if (!parsed.data.employee_id) {
    return NextResponse.json({ message: "Select an employee from your team." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: managerEmployee, error: managerError } = await admin
    .from("employees")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (managerError) {
    return NextResponse.json({ message: managerError.message }, { status: 500 });
  }

  const managerEmployeeId = String((managerEmployee as Record<string, unknown> | null)?.id || "");
  if (!managerEmployeeId) {
    return NextResponse.json({ message: "Manager employee profile is required." }, { status: 403 });
  }

  const { data: currentAssignment, error: accessError } = await admin
    .from("task_assignments")
    .select("id, employee:employee_id(id, manager_id)")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .limit(1)
    .maybeSingle();

  if (accessError) {
    return NextResponse.json({ message: accessError.message }, { status: 500 });
  }

  const assignedEmployee = (currentAssignment as Record<string, unknown> | null)?.employee as Record<string, unknown> | undefined;
  if (!assignedEmployee || String(assignedEmployee.manager_id || "") !== managerEmployeeId) {
    return NextResponse.json({ message: "You can update only tasks assigned to your team." }, { status: 403 });
  }

  const { data: newAssignee, error: assigneeError } = await admin
    .from("employees")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", parsed.data.employee_id)
    .eq("manager_id", managerEmployeeId)
    .maybeSingle();

  if (assigneeError) {
    return NextResponse.json({ message: assigneeError.message }, { status: 500 });
  }
  if (!newAssignee) {
    return NextResponse.json({ message: "You can assign tasks only to employees managed by you." }, { status: 403 });
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_date: parsed.data.due_date || null,
      location_id: null,
    } as never)
    .eq("org_id", orgId)
    .eq("id", taskId)
    .select()
    .single();

  if (taskError) {
    return NextResponse.json({ message: taskError.message }, { status: 500 });
  }

  await admin
    .from("task_assignments")
    .update({ employee_id: parsed.data.employee_id } as never)
    .eq("org_id", orgId)
    .eq("task_id", taskId);

  await admin.from("task_updates").insert({
    org_id: orgId,
    task_id: taskId,
    employee_id: managerEmployeeId,
    status: "pending",
    progress: 0,
    note: "Task details were edited.",
  } as never);

  return NextResponse.json({ data: { task } });
}

