import { createClient } from "@/lib/supabase/client";

export async function getJobPostings(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getPublishedJobPostings() {
  const supabase = createClient();
  const result = await supabase
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .in("status", ["open", "published"])
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getJobPostingById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createJobPosting(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("job_postings")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateJobPosting(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("job_postings")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getJobApplications(orgId: string, jobId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("job_applications")
    .select("*, job:job_posting_id(title, department:department_id(name), location:location_id(name))")
    .eq("org_id", orgId)
    .order("applied_at", { ascending: false });

  if (jobId) {
    query = query.eq("job_posting_id", jobId);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getCandidateApplications() {
  const supabase = createClient();
  const result = await supabase
    .from("job_applications")
    .select("*, job:job_posting_id(title, description, requirements, status, department:department_id(name), location:location_id(name))")
    .order("applied_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getCandidateApplicationForPosting(postingId: string, candidateUserId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("job_applications")
    .select("*")
    .eq("job_posting_id", postingId)
    .eq("candidate_user_id", candidateUserId)
    .maybeSingle();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createJobApplication(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("job_applications")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function uploadRecruitmentResume(postingId: string, file: File) {
  const supabase = createClient();
  const extension = file.name.split(".").pop() || "bin";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const filePath = `${postingId}/${fileName}`;

  const result = await supabase.storage
    .from("recruitment-resumes")
    .upload(filePath, file, { upsert: false });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function getRecruitmentResumeUrl(path: string) {
  const supabase = createClient();
  const result = await supabase.storage
    .from("recruitment-resumes")
    .createSignedUrl(path, 60 * 10);

  return result as unknown as { data: { signedUrl: string } | null; error: { message: string } | null };
}

export async function updateJobApplication(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("job_applications")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
