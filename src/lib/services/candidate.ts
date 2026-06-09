// Candidate service — calls /api/candidate/* endpoints

export type CandidateApplication = {
  id: string;
  job_posting_id: string;
  candidate_id: string;
  candidate_name: string;
  email: string;
  phone: string | null;
  status: string;
  answers: Record<string, string>;
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
  cv_url?: string;
  cv?: File | null;
}) {
  if (values.cv) {
    const formData = new FormData();
    formData.append("slug", values.slug);
    formData.append("candidate_name", values.candidate_name);
    formData.append("email", values.email || "");
    formData.append("phone", values.phone || "");
    formData.append("answers", JSON.stringify(values.answers || {}));
    formData.append("cv", values.cv);

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
    body: JSON.stringify(values),
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
