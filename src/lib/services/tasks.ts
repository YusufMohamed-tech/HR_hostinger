import { createClient } from "@/lib/supabase/client";

function buildTaskFormData(values: Record<string, unknown>) {
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

function hasAttachments(values: Record<string, unknown>) {
  return Array.isArray(values.attachments) && values.attachments.some((file) => file instanceof File);
}

export async function getTasks(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .select("*, location:location_id(name), assignments:task_assignments(id, status, employee:employee_id(id, full_name)), updates:task_updates(status, note, attachments, created_at, employee:employee_id(full_name))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getTaskById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .select("*, assignments:task_assignments(*, employee:employee_id(full_name)), updates:task_updates(status, note, attachments, created_at, employee:employee_id(full_name))")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createTask(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createManagerTask(values: Record<string, unknown>) {
  const multipart = hasAttachments(values);
  const response = await fetch("/api/manager/tasks", {
    method: "POST",
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? buildTaskFormData(values) : JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to create team task.") },
    };
  }

  return {
    data: (payload?.data?.task ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}

export async function updateManagerTask(id: string, values: Record<string, unknown>) {
  const requestPayload = { id, ...values };
  const multipart = hasAttachments(requestPayload);
  const response = await fetch("/api/manager/tasks", {
    method: "PATCH",
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? buildTaskFormData(requestPayload) : JSON.stringify(requestPayload),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to update team task.") },
    };
  }

  return {
    data: (payload?.data?.task ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}

export async function updateTask(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteTask(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}

export async function assignTask(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("task_assignments")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateTaskAssignment(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("task_assignments")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateMyTaskAssignment(values: {
  assignment_id: string;
  status: string;
  note?: string;
  attachments?: File[];
}) {
  const multipart = Boolean(values.attachments?.length);
  const response = await fetch("/api/tasks/mine", {
    method: "PATCH",
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? buildTaskFormData(values as unknown as Record<string, unknown>) : JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to update task status.") },
    };
  }

  return {
    data: (payload?.data?.assignment ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}

export async function createTaskUpdate(values: Record<string, unknown>) {
  const multipart = hasAttachments(values);
  const response = await fetch("/api/tasks/updates", {
    method: "POST",
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? buildTaskFormData(values) : JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to add task update.") },
    };
  }

  return {
    data: (payload?.data?.update ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}

export async function createMyTaskUpdate(values: {
  task_id: string;
  status: string;
  progress?: number;
  note: string;
  attachments?: File[];
}) {
  const multipart = Boolean(values.attachments?.length);
  const response = await fetch("/api/tasks/updates", {
    method: "POST",
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? buildTaskFormData(values as unknown as Record<string, unknown>) : JSON.stringify(values),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to add task update.") },
    };
  }

  return {
    data: (payload?.data?.update ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}

export async function sendTaskMessage(values: {
  task_id: string;
  employee_id: string;
  message: string;
  attachments?: File[];
}) {
  const hasAttachments = Boolean(values.attachments?.length);
  const body = hasAttachments ? new FormData() : JSON.stringify(values);

  if (body instanceof FormData) {
    body.append("task_id", values.task_id);
    body.append("employee_id", values.employee_id);
    body.append("message", values.message);
    values.attachments?.forEach((file) => body.append("attachments", file));
  }

  const response = await fetch("/api/tasks/messages", {
    method: "POST",
    headers: hasAttachments ? undefined : { "Content-Type": "application/json" },
    body,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(payload?.message || "Unable to send task message.") },
    };
  }

  return {
    data: (payload?.data?.update ?? payload?.data ?? null) as Record<string, unknown> | null,
    error: null,
  };
}
