"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Briefcase, CheckCircle, Network, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  createJobApplication,
  getCandidateApplicationForPosting,
  getJobPostingById,
  uploadRecruitmentResume,
} from "@/lib/services/recruitment";

type FormQuestion = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  required?: boolean;
  options?: string;
};

export default function PublicApplicationPage() {
  const params = useParams();
  const postingId = typeof params.postingId === "string" ? params.postingId : "";
  const supabase = useMemo(() => createClient(), []);
  const [posting, setPosting] = useState<Record<string, unknown> | null>(null);
  const [candidateUserId, setCandidateUserId] = useState("");
  const [existingApplication, setExistingApplication] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [form, setForm] = useState({ candidate_name: "", email: "", phone: "", cover_letter: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const questions = useMemo(() => {
    const value = posting?.form_schema;
    return Array.isArray(value) ? value as FormQuestion[] : [];
  }, [posting?.form_schema]);

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const setAnswer = (key: string, value: string) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const loadCandidateApplication = useCallback(async (userId: string) => {
    if (!postingId || !userId) return;
    const { data } = await getCandidateApplicationForPosting(postingId, userId);
    setExistingApplication(data || null);
  }, [postingId]);

  useEffect(() => {
    async function load() {
      if (!postingId) return;
      const [{ data: postingData }, { data: userData }] = await Promise.all([
        getJobPostingById(postingId),
        supabase.auth.getUser(),
      ]);
      setPosting(postingData);
      const user = userData?.user;
      if (user) {
        setCandidateUserId(user.id);
        const email = user.email || "";
        const name = String(user.user_metadata?.full_name || "");
        setForm((prev) => ({ ...prev, candidate_name: prev.candidate_name || name, email: prev.email || email }));
        await loadCandidateApplication(user.id);
      }
      setLoading(false);
    }
    load();
  }, [loadCandidateApplication, postingId, supabase]);

  const handleAuth = async () => {
    setError("");
    setAuthMessage("");
    if (!authForm.email.trim() || !authForm.password.trim()) {
      setError("Email and password are required.");
      return;
    }

    const result = authMode === "signup"
      ? await supabase.auth.signUp({
          email: authForm.email.trim(),
          password: authForm.password,
          options: { data: { full_name: authForm.name.trim() } },
        })
      : await supabase.auth.signInWithPassword({
          email: authForm.email.trim(),
          password: authForm.password,
        });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const user = result.data.user;
    if (!user) {
      setAuthMessage("Account created. Please confirm your email, then sign in to complete the application.");
      setAuthMode("signin");
      return;
    }

    setCandidateUserId(user.id);
    setForm((prev) => ({
      ...prev,
      candidate_name: prev.candidate_name || authForm.name || String(user.user_metadata?.full_name || ""),
      email: prev.email || user.email || authForm.email,
    }));
    await loadCandidateApplication(user.id);
  };

  const handleSubmit = async () => {
    if (!candidateUserId) {
      setError("Please create an account or sign in first.");
      return;
    }
    if (!posting?.org_id || !form.candidate_name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    for (const question of questions) {
      if (question.required && !String(answers[question.label] || "").trim()) {
        setError(`Please answer: ${question.label}`);
        return;
      }
    }

    setSubmitting(true);
    setError("");
    let resumePath: string | undefined;
    if (resumeFile) {
      const { data: uploadData, error: uploadError } = await uploadRecruitmentResume(postingId, resumeFile);
      if (uploadError) {
        setError(uploadError.message);
        setSubmitting(false);
        return;
      }
      resumePath = uploadData?.path;
    }

    const { data, error: submitError } = await createJobApplication({
      org_id: posting.org_id,
      job_posting_id: postingId,
      candidate_user_id: candidateUserId,
      candidate_name: form.candidate_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      resume_url: resumePath,
      cover_letter: form.cover_letter.trim() || undefined,
      application_answers: answers,
      status: "new",
      source: "public_link",
    });
    setSubmitting(false);
    if (submitError) {
      setError(submitError.message);
      return;
    }
    setExistingApplication(data);
    setSubmitted(true);
  };

  const department = (posting?.department ?? null) as Record<string, unknown> | null;
  const location = (posting?.location ?? null) as Record<string, unknown> | null;
  const status = typeof posting?.status === "string" ? posting.status : "";
  const isClosed = ["closed", "filled", "draft"].includes(status);
  const description = typeof posting?.description === "string" ? posting.description : "";
  const requirements = typeof posting?.requirements === "string" ? posting.requirements : "";
  const jobMeta = [posting?.employment_type, posting?.experience_level, posting?.salary_range]
    .filter(Boolean)
    .map(String)
    .join(" · ");

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Tatwir Talent</p>
            <p className="text-xs text-slate-500">Career application</p>
          </div>
          <Button variant="outline" className="mr-auto" asChild>
            <Link href="/candidate/applications">My applications</Link>
          </Button>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-brand" />
              {loading ? "Loading position..." : String(posting?.title || "Position unavailable")}
            </CardTitle>
            {posting && (
              <p className="text-sm text-gray-500">
                {String(department?.name || "All departments")} · {String(location?.name || "Flexible location")}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {!loading && !posting && <p className="text-sm text-red-600">This job posting is not available.</p>}
            {isClosed && <p className="text-sm text-red-600">This position is not accepting applications.</p>}
            {(submitted || existingApplication) && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
                <CheckCircle className="mb-2 h-5 w-5" />
                <p className="font-medium">Application received.</p>
                <p className="text-sm">Current status: {String((existingApplication?.status || "new"))}</p>
                <Button variant="outline" className="mt-3" asChild>
                  <Link href="/candidate/applications">Track all applications</Link>
                </Button>
              </div>
            )}

            {posting && !existingApplication && !isClosed && (
              <>
                <div className="space-y-2 text-sm text-gray-600">
                  {description && <p>{description}</p>}
                  {requirements && <p>{requirements}</p>}
                  {jobMeta && <p>{jobMeta}</p>}
                </div>

                {!candidateUserId && (
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-brand" />
                      <p className="font-medium">{authMode === "signup" ? "Create candidate account" : "Sign in to continue"}</p>
                    </div>
                    <div className="grid gap-3">
                      {authMode === "signup" && (
                        <Input placeholder="Full name" value={authForm.name} onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))} />
                      )}
                      <Input placeholder="Email" type="email" value={authForm.email} onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))} />
                      <Input placeholder="Password" type="password" value={authForm.password} onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))} />
                      {authMessage && <p className="text-sm text-green-700">{authMessage}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleAuth}>
                          {authMode === "signup" ? "Create account" : "Sign in"}
                        </Button>
                        <Button variant="ghost" onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>
                          {authMode === "signup" ? "I already have an account" : "Create a new account"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {candidateUserId && (
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>Full name</Label>
                      <Input value={form.candidate_name} onChange={(event) => set("candidate_name", event.target.value)} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>CV / Resume</Label>
                      <Input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Cover letter</Label>
                      <Input value={form.cover_letter} onChange={(event) => set("cover_letter", event.target.value)} />
                    </div>
                    {questions.map((question) => (
                      <QuestionField
                        key={question.id || question.label}
                        question={question}
                        value={answers[question.label] || ""}
                        onChange={(value) => setAnswer(question.label, value)}
                      />
                    ))}
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
                      {submitting ? "Submitting..." : "Submit application"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuestionField({ question, value, onChange }: { question: FormQuestion; value: string; onChange: (value: string) => void }) {
  const options = String(question.options || "").split(",").map((item) => item.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      <Label>{question.label}{question.required ? " *" : ""}</Label>
      {question.type === "select" ? (
        <select
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select an option</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : question.type === "textarea" ? (
        <textarea
          className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          type={question.type === "date" || question.type === "number" ? question.type : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
