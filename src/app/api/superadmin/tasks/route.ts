import { NextRequest, NextResponse } from "next/server";
import { getFormFiles, uploadTaskUpdateAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

const assignableRoles = new Set(["hr_admin", "hr_recruitment"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function getAssignableUsers() {
  const admin = createAdminClient();
  const membersResult = await admin
    .from("org_members")
    .select("org_id, user_id, role")
    .in("role", Array.from(assignableRoles));

  if (membersResult.error) return { data: null, error: membersResult.error };

  const members = (membersResult.data ?? []) as Record<string, unknown>[];
  const userIds = Array.from(new Set(members.map((member) => String(member.user_id || "")).filter(Boolean)));
  const orgIds = Array.from(new Set(members.map((member) => String(member.org_id || "")).filter(Boolean)));

  const [profilesResult, organizationsResult, employeesResult] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("user_id, full_name, email, title, account_status").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? admin.from("organizations").select("id, name, slug, status").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin.from("employees").select("id, org_id, user_id, full_name, email, job_title").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error) return { data: null, error: profilesResult.error };
  if (organizationsResult.error) return { data: null, error: organizationsResult.error };
  if (employeesResult.error) return { data: null, error: employeesResult.error };

  const profilesByUserId = new Map(
    ((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [
      String(profile.user_id || ""),
      profile,
    ])
  );
  const organizationsById = new Map(
    ((organizationsResult.data ?? []) as Record<string, unknown>[]).map((organization) => [
      String(organization.id || ""),
      organization,
    ])
  );
  const employeesByOrgUser = new Map(
    ((employeesResult.data ?? []) as Record<string, unknown>[]).map((employee) => [
      `${employee.org_id}:${employee.user_id}`,
      employee,
    ])
  );

  return {
    data: members.map((member) => {
      const orgId = String(member.org_id || "");
      const userId = String(member.user_id || "");
      return {
        org_id: orgId,
        user_id: userId,
        role: String(member.role || ""),
        profile: profilesByUserId.get(userId) ?? null,
        organization: organizationsById.get(orgId) ?? null,
        employee: employeesByOrgUser.get(`${orgId}:${userId}`) ?? null,
      };
    }),
    error: null,
  };
}

async function ensureEmployeeForUser(values: {
  orgId: string;
  userId: string;
  role: string;
}) {
  const admin = createAdminClient();
  const existingResult = await admin
    .from("employees")
    .select("id")
    .eq("org_id", values.orgId)
    .eq("user_id", values.userId)
    .maybeSingle();

  if (existingResult.error) return { data: null, error: existingResult.error };
  if (existingResult.data) return { data: String((existingResult.data as Record<string, unknown>).id || ""), error: null };

  const profileResult = await admin
    .from("profiles")
    .select("full_name, email, title")
    .eq("user_id", values.userId)
    .maybeSingle();

  if (profileResult.error) return { data: null, error: profileResult.error };

  const profile = asRecord(profileResult.data);
  const fullName = String(profile.full_name || profile.email || "HR User");
  const email = typeof profile.email === "string" ? profile.email : null;
  const title = typeof profile.title === "string"
    ? profile.title
    : values.role === "hr_recruitment" ? "HR Recruiter" : "HR Admin";

  const createResult = await admin
    .from("employees")
    .insert({
      org_id: values.orgId,
      user_id: values.userId,
      full_name: fullName,
      email,
      job_title: title,
      status: "Active",
    } as never)
    .select("id")
    .single();

  if (createResult.error) return { data: null, error: createResult.error };

  return { data: String((createResult.data as Record<string, unknown>).id || ""), error: null };
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const result = await getAssignableUsers();
  if (result.error) {
    return NextResponse.json({ message: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = {
      target_org_id: formData.get("target_org_id"),
      assignee_user_id: formData.get("assignee_user_id"),
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority"),
      due_date: formData.get("due_date"),
    };
  } else {
    body = await request.json().catch(() => ({}));
  }
  const orgId = String(body.target_org_id || "").trim();
  const assigneeUserId = String(body.assignee_user_id || "").trim();
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const priority = String(body.priority || "medium").trim();
  const dueDate = String(body.due_date || "").trim();

  if (!orgId) return NextResponse.json({ message: "Target organization is required." }, { status: 400 });
  if (!assigneeUserId) return NextResponse.json({ message: "Assignee is required." }, { status: 400 });
  if (title.length < 2) return NextResponse.json({ message: "Task title is required." }, { status: 400 });
  if (!["low", "medium", "high", "urgent"].includes(priority)) {
    return NextResponse.json({ message: "Unsupported priority." }, { status: 400 });
  }
  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError }, { status: 400 });
  }

  const admin = createAdminClient();
  const memberResult = await admin
    .from("org_members")
    .select("org_id, user_id, role")
    .eq("org_id", orgId)
    .eq("user_id", assigneeUserId)
    .maybeSingle();

  if (memberResult.error) return NextResponse.json({ message: memberResult.error.message }, { status: 500 });

  const member = memberResult.data as Record<string, unknown> | null;
  const role = String(member?.role || "");
  if (!member || !assignableRoles.has(role)) {
    return NextResponse.json({ message: "Task can only be assigned to HR Admin or HR Recruitment." }, { status: 403 });
  }

  const employeeResult = await ensureEmployeeForUser({ orgId, userId: assigneeUserId, role });
  if (employeeResult.error || !employeeResult.data) {
    return NextResponse.json({ message: employeeResult.error?.message || "Unable to prepare assignee employee profile." }, { status: 500 });
  }

  const taskResult = await admin
    .from("tasks")
    .insert({
      org_id: orgId,
      title,
      description: description || null,
      priority,
      due_date: dueDate || null,
      created_by: auth.user.id,
      status: "pending",
    } as never)
    .select()
    .single();

  if (taskResult.error) return NextResponse.json({ message: taskResult.error.message }, { status: 500 });

  const task = taskResult.data as Record<string, unknown>;
  const taskId = String(task.id || "");
  const assignmentResult = await admin
    .from("task_assignments")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: employeeResult.data,
      status: "pending",
    } as never)
    .select()
    .single();

  if (assignmentResult.error) {
    await admin.from("tasks").delete().eq("id", taskId);
    return NextResponse.json({ message: assignmentResult.error.message }, { status: 500 });
  }

  await admin.from("task_updates").insert({
    org_id: orgId,
    task_id: taskId,
    employee_id: employeeResult.data,
    status: "pending",
    progress: 0,
    note: "تم إسناد المهمة من المشرف العام.",
  } as never);

  if (files.length > 0) {
    const attachmentUpdateResult = await admin
      .from("task_updates")
      .insert({
        org_id: orgId,
        task_id: taskId,
        employee_id: employeeResult.data,
        status: "pending",
        progress: 0,
        note: "مرفقات إسناد المهمة من المشرف العام.",
      } as never)
      .select()
      .single();

    if (attachmentUpdateResult.error) {
      return NextResponse.json({ message: attachmentUpdateResult.error.message }, { status: 500 });
    }

    const uploadResult = await uploadTaskUpdateAttachments(admin, {
      orgId,
      taskId,
      updateId: String((attachmentUpdateResult.data as Record<string, unknown>).id || ""),
      files,
    });
    if (uploadResult.error) return NextResponse.json({ message: uploadResult.error.message }, { status: 500 });
  }

  await admin.from("notifications").insert({
    org_id: orgId,
    user_id: assigneeUserId,
    title: "تم إسناد مهمة جديدة",
    body: title,
    type: "task",
    link: "/tasks/mine",
    is_read: false,
  } as never);

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: "platform_task.created",
    targetOrgId: orgId,
    targetUserId: assigneeUserId,
    targetType: "task",
    targetId: taskId,
    metadata: {
      title,
      priority,
      due_date: dueDate || null,
      assignee_role: role,
      employee_id: employeeResult.data,
    },
  });

  return NextResponse.json({
    data: {
      task,
      assignment: assignmentResult.data,
    },
  });
}
