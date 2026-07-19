export interface SuperadminLeaveRequest {
  id: string;
  org_id: string;
  employee_id: string;
  leave_type: string;
  status: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  requested_at: string;
  requester_role: string;
  days: number;
  employee: {
    id: string;
    full_name: string | null;
    user_id: string | null;
    email: string | null;
    job_title: string | null;
  } | null;
  organization: {
    id: string;
    name: string | null;
    slug: string | null;
    status: string | null;
  } | null;
}

export interface SuperadminTaskAssignee {
  org_id: string;
  user_id: string;
  role: string;
  profile: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    title: string | null;
    account_status: string | null;
  } | null;
  organization: {
    id: string;
    name: string | null;
    slug: string | null;
    status: string | null;
  } | null;
  employee: {
    id: string;
    org_id: string;
    user_id: string | null;
    full_name: string | null;
    email: string | null;
    job_title: string | null;
  } | null;
}

type Result<T> = { data: T | null; error: { message: string } | null };

function buildFormData(values: Record<string, unknown>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (key === "attachments") continue;
    if (value !== undefined && value !== null) formData.append(key, String(value));
  }
  const attachments = Array.isArray(values.attachments) ? values.attachments : [];
  attachments.forEach((file) => {
    if (file instanceof File) formData.append("attachments", file);
  });
  return formData;
}

async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<Result<T>> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || fallbackMessage) },
    };
  }

  return {
    data: (payload?.data ?? payload ?? null) as T | null,
    error: null,
  };
}

export async function getSuperadminLeaveRequests() {
  const response = await fetch("/api/superadmin/leave-requests", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminLeaveRequest[]>(response, "Unable to load leave requests.");
}

export async function decideSuperadminLeaveRequest(values: {
  request_id: string;
  decision: "approved" | "rejected";
  note?: string;
}) {
  const response = await fetch("/api/superadmin/leave-requests", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  return parseResponse<Record<string, unknown>>(response, "Unable to update leave request.");
}

export async function getSuperadminTaskAssignees() {
  const response = await fetch("/api/superadmin/tasks", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  return parseResponse<SuperadminTaskAssignee[]>(response, "Unable to load task assignees.");
}

export async function createSuperadminTask(values: {
  target_org_id: string;
  assignee_user_id: string;
  title: string;
  description?: string;
  priority?: string;
  due_date?: string;
  attachments?: File[];
}) {
  const requestValues = { ...values, task_id: crypto.randomUUID(), command_id: crypto.randomUUID() };
  const hasAttachments = Boolean(values.attachments?.length);
  const response = await fetch("/api/superadmin/tasks", {
    method: "POST",
    headers: hasAttachments ? undefined : { "Content-Type": "application/json" },
    body: hasAttachments ? buildFormData(requestValues as unknown as Record<string, unknown>) : JSON.stringify(requestValues),
  });

  return parseResponse<Record<string, unknown>>(response, "Unable to create task.");
}
