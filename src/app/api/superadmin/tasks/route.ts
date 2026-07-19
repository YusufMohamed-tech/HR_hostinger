import { NextRequest, NextResponse } from "next/server";
import { getFormFiles, validateTaskAttachments } from "@/lib/server/task-attachments";
import { executeTaskSave, taskCommandStatus } from "@/lib/server/task-commands";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin/server";
import type { OrgRole } from "@/types/database";

const assignableRoles = new Set(["hr_admin", "hr_recruitment"]);

async function getAssignableUsers() {
  const admin = createAdminClient();
  const membersResult = await admin.from("org_members").select("org_id, user_id, role")
    .in("role", Array.from(assignableRoles) as OrgRole[]);
  if (membersResult.error) return { data: null, error: membersResult.error };
  const members = (membersResult.data ?? []) as Record<string, unknown>[];
  const userIds = Array.from(new Set(members.map((member) => String(member.user_id || "")).filter(Boolean)));
  const orgIds = Array.from(new Set(members.map((member) => String(member.org_id || "")).filter(Boolean)));
  const [profilesResult, organizationsResult, employeesResult] = await Promise.all([
    userIds.length ? admin.from("profiles").select("user_id, full_name, email, title, account_status").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length ? admin.from("organizations").select("id, name, slug, status").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length ? admin.from("employees").select("id, org_id, user_id, full_name, email, job_title").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = profilesResult.error || organizationsResult.error || employeesResult.error;
  if (error) return { data: null, error };
  const profiles = new Map((profilesResult.data ?? []).map((row) => [row.user_id, row]));
  const organizations = new Map((organizationsResult.data ?? []).map((row) => [row.id, row]));
  const employees = new Map((employeesResult.data ?? []).map((row) => [`${row.org_id}:${row.user_id}`, row]));
  return { data: members.map((member) => ({
    ...member,
    profile: profiles.get(String(member.user_id || "")) ?? null,
    organization: organizations.get(String(member.org_id || "")) ?? null,
    employee: employees.get(`${member.org_id}:${member.user_id}`) ?? null,
  })), error: null };
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;
  const result = await getAssignableUsers();
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;
  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = Object.fromEntries(["target_org_id", "assignee_user_id", "task_id", "command_id", "title",
      "description", "priority", "due_date"].map((key) => [key, formData.get(key)]));
  } else body = await request.json().catch(() => ({}));
  const orgId = String(body.target_org_id || "").trim();
  const assigneeUserId = String(body.assignee_user_id || "").trim();
  const taskId = String(body.task_id || "").trim();
  const commandId = String(body.command_id || "").trim();
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const priority = String(body.priority || "medium").trim();
  const dueDate = String(body.due_date || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(orgId) || !uuidPattern.test(assigneeUserId) || !uuidPattern.test(taskId)
      || !uuidPattern.test(commandId) || title.length < 2 || title.length > 160
      || !["low", "medium", "high", "urgent"].includes(priority)) {
    return NextResponse.json({ message: "Platform task command data is invalid." }, { status: 400 });
  }
  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) return NextResponse.json({ message: attachmentError }, { status: 400 });

  const admin = createAdminClient();
  const [memberResult, employeeResult] = await Promise.all([
    admin.from("org_members").select("role").eq("org_id", orgId).eq("user_id", assigneeUserId).maybeSingle(),
    admin.from("employees").select("id").eq("org_id", orgId).eq("user_id", assigneeUserId)
      .eq("lifecycle_status", "active").maybeSingle(),
  ]);
  const lookupError = memberResult.error || employeeResult.error;
  if (lookupError) return NextResponse.json({ message: lookupError.message }, { status: 500 });
  if (!memberResult.data || !assignableRoles.has(String(memberResult.data.role || ""))) {
    return NextResponse.json({ message: "Task can only be assigned to HR Admin or HR Recruitment." }, { status: 403 });
  }
  if (!employeeResult.data?.id) {
    return NextResponse.json({ message: "The assignee must complete employee onboarding first." }, { status: 409 });
  }
  const result = await executeTaskSave(admin, {
    orgId,
    actorUserId: auth.user.id,
    requestId: crypto.randomUUID(),
    commandId,
    taskId,
    title,
    description,
    priority,
    dueDate: dueDate || undefined,
    assigneeEmployeeId: employeeResult.data.id,
    note: "تم إسناد المهمة من المشرف العام.",
    files,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message },
      { status: taskCommandStatus("code" in result.error ? String(result.error.code || "") : undefined) });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
