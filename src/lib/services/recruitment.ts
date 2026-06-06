// Recruitment service — calls /api/recruitment/* endpoints server-side

export type FormQuestion = {
  id: string;
  type: "text" | "textarea" | "select" | "file" | "date" | "yesno" | "number";
  label: string;
  options?: string[];
  required: boolean;
  order: number;
  accept?: string;
};

export type StageHistoryEntry = {
  stage: string;
  changed_by: string;
  changed_at: string;
  note?: string | null;
};

export type JobPosting = {
  id: string;
  org_id: string;
  created_by: string | null;
  title: string;
  department_id: string | null;
  location_id: string | null;
  company_name: string | null;
  city: string | null;
  employment_type: string | null;
  description: string | null;
  requirements: string | null;
  salary_min: number | null;
  salary_max: number | null;
  deadline: string | null;
  status: string;
  form_schema: FormQuestion[];
  public_slug: string | null;
  created_at: string;
  updated_at: string;
  department?: { name: string } | null;
  location?: { name: string } | null;
  application_count?: number;
  new_this_week?: number;
};

export type JobApplication = {
  id: string;
  org_id: string;
  job_posting_id: string;
  candidate_id: string | null;
  candidate_name: string;
  email: string;
  phone: string | null;
  resume_url: string | null;
  cv_url: string | null;
  answers: Record<string, string>;
  status: string;
  stage_history: StageHistoryEntry[];
  recruiter_notes: string | null;
  score: number | null;
  applied_at: string;
  updated_at: string;
};

export type Interview = {
  id: string;
  org_id: string;
  job_application_id: string;
  interview_date: string;
  scheduled_at: string | null;
  location: string | null;
  type: string | null;
  notes: string | null;
  feedback: string | null;
  result: string;
  created_by: string | null;
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

export async function getJobPostings() {
  return apiFetch<JobPosting[]>("/api/recruitment/postings");
}

export async function getJobPosting(id: string) {
  return apiFetch<JobPosting>(`/api/recruitment/postings/${id}`);
}

export async function createJobPosting(values: Partial<JobPosting> & { status?: string }) {
  return apiFetch<JobPosting>("/api/recruitment/postings", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateJobPosting(id: string, values: Partial<JobPosting> & { status?: string }) {
  return apiFetch<JobPosting>(`/api/recruitment/postings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function getApplications(postingId?: string) {
  const url = postingId
    ? `/api/recruitment/applications?posting_id=${postingId}`
    : "/api/recruitment/applications";
  return apiFetch<JobApplication[]>(url);
}

export async function getApplication(id: string) {
  return apiFetch<JobApplication>(`/api/recruitment/applications/${id}`);
}

export async function updateApplication(
  id: string,
  values: { recruiter_notes?: string; score?: number; status?: string }
) {
  return apiFetch<JobApplication>(`/api/recruitment/applications/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function updateApplicationStage(id: string, stage: string, note?: string) {
  return apiFetch<JobApplication>(`/api/recruitment/applications/${id}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage, note }),
  });
}

export async function scheduleInterview(data: {
  application_id: string;
  scheduled_at: string;
  type: string;
  location?: string;
  notes?: string;
}) {
  return apiFetch<Interview>("/api/recruitment/interviews", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getInterviews(applicationId: string) {
  return apiFetch<Interview[]>(`/api/recruitment/interviews?application_id=${applicationId}`);
}

export async function hireCandidate(applicationId: string) {
  return apiFetch<{ employee_id: string }>("/api/recruitment/hire", {
    method: "POST",
    body: JSON.stringify({ application_id: applicationId }),
  });
}

