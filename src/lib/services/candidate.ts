// Candidate service — calls /api/candidate/* endpoints

export type CandidateApplication = {
  id: string;
  job_posting_id: string;
  candidate_id: string;
  candidate_name: string;
  email: string;
  phone: string | null;
  status: string;
  version: number;
  offer_status: "pending" | "accepted" | "declined" | "withdrawn" | null;
  offered_at: string | null;
  offer_responded_at: string | null;
  answers: Record<string, string | CandidateFileAnswer>;
  cv_url: string | null;
  stage_history: Array<{
    stage: string;
    changed_by: string;
    changed_at: string;
    note?: string | null;
  }>;
  applied_at: string;
  updated_at: string;
  job?: {
    id: string;
    title: string;
    employment_type: string | null;
    deadline: string | null;
    status: string;
    department?: { name: string } | null;
    location?: { name: string } | null;
    org?: { name: string } | null;
  } | null;
  interviews?: Array<{
    id: string;
    scheduled_at: string | null;
    interview_date: string;
    type: string | null;
    location: string | null;
    notes: string | null;
  }>;
};

export type CandidateFileAnswer = {
  path: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  scan_status: "clean";
  scan_engine: string;
  scanned_at: string;
};

export type CandidateNotification = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const json = (await res.json()) as { data?: T; error?: string };
    if (!res.ok) return { data: null, error: json.error ?? "خطأ غير متوقع" };
    return { data: json.data ?? null, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "خطأ في الاتصال" };
  }
}

export async function submitApplication(values: {
  slug: string;
  candidate_name: string;
  email?: string;
  phone?: string;
  answers: Record<string, string>;
  answer_files?: Record<string, File | null>;
  cv_url?: string;
  cv?: File | null;
  application_id: string;
  command_id: string;
}) {
  const answerFiles = Object.entries(values.answer_files || {})
    .filter((entry): entry is [string, File] => entry[1] instanceof File);
  if (values.cv || answerFiles.length > 0) {
    const formData = new FormData();
    formData.append("slug", values.slug);
    formData.append("candidate_name", values.candidate_name);
    formData.append("email", values.email || "");
    formData.append("phone", values.phone || "");
    formData.append("answers", JSON.stringify(values.answers || {}));
    formData.append("application_id", values.application_id);
    formData.append("command_id", values.command_id);
    if (values.cv) formData.append("cv", values.cv);
    for (const [questionId, file] of answerFiles) formData.append(`answer_file:${questionId}`, file);

    try {
      const res = await fetch("/api/candidate/apply", {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as { data?: { id: string }; error?: string };
      if (!res.ok) return { data: null, error: json.error ?? "خطأ غير متوقع" };
      return { data: json.data ?? null, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : "خطأ في الاتصال" };
    }
  }

  return apiFetch<{ id: string }>("/api/candidate/apply", {
    method: "POST",
    body: JSON.stringify({ ...values, cv: undefined, answer_files: undefined }),
  });
}

export async function getCandidateApplications() {
  return apiFetch<CandidateApplication[]>("/api/candidate/applications");
}

export async function getCandidateNotifications() {
  return apiFetch<CandidateNotification[]>("/api/candidate/notifications");
}

export async function markCandidateNotificationsRead() {
  return apiFetch<{ success: boolean }>("/api/candidate/notifications", {
    method: "PATCH",
  });
}

export async function respondToCandidateOffer(applicationId: string, response: "accepted" | "declined") {
  return apiFetch<CandidateApplication>(`/api/candidate/applications/${applicationId}/offer`, {
    method: "POST",
    body: JSON.stringify({ response, command_id: crypto.randomUUID() }),
  });
}
