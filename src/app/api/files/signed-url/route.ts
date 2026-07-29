import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext, type TenantAuthContext } from "@/lib/server/tenant-context";
import { createObjectAccessUrl } from "@/lib/server/file-storage";

const inputSchema = z.object({
  bucket: z.enum(["balance-attachments", "recruitment", "task-attachments", "chat-attachments"]),
  path: z.string().trim().min(1).max(1600),
});

async function canReadTask(auth: TenantAuthContext, path: string) {
  const [orgId, taskId] = path.split("/");
  if (orgId !== auth.orgId || !z.string().uuid().safeParse(taskId).success) return false;
  const task = await auth.admin.from("tasks").select("created_by").eq("org_id", auth.orgId).eq("id", taskId).maybeSingle();
  if (task.error || !task.data) return false;
  if (["admin", "hr_admin"].includes(auth.role) || task.data.created_by === auth.user.id) return true;
  const assignments = await auth.admin.from("task_assignments").select("employee_id")
    .eq("org_id", auth.orgId).eq("task_id", taskId);
  if (assignments.error) return false;
  const employeeIds = (assignments.data || []).map((item) => item.employee_id);
  if (employeeIds.includes(auth.employeeId)) return true;
  if (!auth.employeeId || employeeIds.length === 0) return false;
  const managed = await auth.admin.from("employees").select("id").eq("org_id", auth.orgId)
    .in("id", employeeIds).eq("manager_id", auth.employeeId).limit(1);
  return !managed.error && Boolean(managed.data?.length);
}

async function canReadChat(auth: TenantAuthContext, path: string) {
  const [orgId, conversationId] = path.split("/");
  if (orgId !== auth.orgId || !z.string().uuid().safeParse(conversationId).success) return false;
  const participant = await auth.admin.from("chat_participants").select("id")
    .eq("org_id", auth.orgId).eq("conversation_id", conversationId).eq("user_id", auth.user.id).maybeSingle();
  return !participant.error && Boolean(participant.data);
}

async function canReadRecruitment(auth: TenantAuthContext, path: string) {
  if (!["admin", "hr_admin", "hr_recruitment"].includes(auth.role)) return false;
  if (path.startsWith(`${auth.orgId}/cv/`)) {
    const application = await auth.admin.from("job_applications").select("id")
      .eq("org_id", auth.orgId).or(`cv_url.eq.${path},resume_url.eq.${path}`).limit(1);
    return !application.error && Boolean(application.data?.length);
  }
  if (path.startsWith(`${auth.orgId}/application-files/`)) {
    const attachment = await auth.admin.from("recruitment_application_files").select("id")
      .eq("org_id", auth.orgId).eq("storage_path", path).limit(1);
    return !attachment.error && Boolean(attachment.data?.length);
  }
  return false;
}

async function canReadBalanceAttachment(auth: TenantAuthContext, path: string) {
  if (path.startsWith(`leave-requests/${auth.orgId}/`)) {
    const request = await auth.admin.from("leave_requests").select("employee_id")
      .eq("org_id", auth.orgId).eq("attachment_url", path).maybeSingle();
    if (request.error || !request.data) return false;
    if (request.data.employee_id === auth.employeeId || ["admin", "hr_admin", "hr_recruitment"].includes(auth.role)) return true;
    const employee = await auth.admin.from("employees")
      .select("user_id, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id)")
      .eq("org_id", auth.orgId).eq("id", request.data.employee_id).maybeSingle();
    if (employee.error || !employee.data) return false;
    const department = employee.data.department as unknown as { manager_employee_id?: string | null } | null;
    const location = employee.data.location as unknown as { manager_employee_id?: string | null } | null;
    if (auth.employeeId && [employee.data.manager_id, department?.manager_employee_id, location?.manager_employee_id].includes(auth.employeeId)) return true;
    if (auth.role === "sales_manager" && employee.data.user_id) {
      const member = await auth.admin.from("org_members").select("id").eq("org_id", auth.orgId)
        .eq("user_id", employee.data.user_id).eq("role", "sales").maybeSingle();
      return !member.error && Boolean(member.data);
    }
    return false;
  }
  const balance = await auth.admin.from("financial_balances").select("employee_id")
    .eq("org_id", auth.orgId).eq("attachment_url", path).maybeSingle();
  if (balance.error || !balance.data) return false;
  return balance.data.employee_id === auth.employeeId || ["admin", "hr_admin"].includes(auth.role);
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({}, request);
  if ("error" in auth) return auth.error;
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Attachment reference is invalid.", requestId: auth.requestId }, { status: 400 });
  const { bucket, path } = parsed.data;
  const allowed = bucket === "task-attachments" ? await canReadTask(auth, path)
    : bucket === "chat-attachments" ? await canReadChat(auth, path)
      : bucket === "recruitment" ? await canReadRecruitment(auth, path)
        : await canReadBalanceAttachment(auth, path);
  if (!allowed) return NextResponse.json({ message: "Attachment access is forbidden.", requestId: auth.requestId }, { status: 403 });
  const signedUrl = createObjectAccessUrl(bucket, path, { expiresIn: 600 });
  return NextResponse.json({ data: { signedUrl }, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } });
}
