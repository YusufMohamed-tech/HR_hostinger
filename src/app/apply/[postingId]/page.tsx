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

const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const SKILL_KEYWORDS = [
  "react", "typescript", "javascript", "node", "next", "vue", "angular", "python", "java",
  "sql", "postgres", "supabase", "excel", "power bi", "sales", "customer service", "hr",
  "recruitment", "payroll", "training", "operations", "leadership", "arabic", "english",
];

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
      setError("البريد الإلكتروني وكلمة المرور مطلوبان.");
      return;
    }
    if (authMode === "signup" && authForm.password.length < 8) {
      setError("كلمة المرور يجب ألا تقل عن 8 أحرف.");
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
      setAuthMessage("تم إنشاء الحساب. أكد بريدك الإلكتروني ثم سجل الدخول لإكمال الطلب.");
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
      setError("سجل الدخول أو أنشئ حسابا أولا.");
      return;
    }
    if (!posting?.org_id || !form.candidate_name.trim() || !form.email.trim()) {
      setError("الاسم والبريد الإلكتروني مطلوبان.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError("اكتب بريدا إلكترونيا صحيحا.");
      return;
    }
    if (isClosed) {
      setError("انتهى استقبال الطلبات لهذه الوظيفة.");
      return;
    }
    if (!resumeFile) {
      setError("يرجى إرفاق السيرة الذاتية.");
      return;
    }
    if (!ALLOWED_RESUME_TYPES.has(resumeFile.type)) {
      setError("السيرة الذاتية يجب أن تكون PDF أو DOC أو DOCX.");
      return;
    }
    if (resumeFile.size > MAX_RESUME_BYTES) {
      setError("حجم السيرة الذاتية يجب ألا يتجاوز 10MB.");
      return;
    }
    for (const question of questions) {
      if (question.required && !String(answers[question.label] || "").trim()) {
        setError(`يرجى الإجابة على: ${question.label}`);
        return;
      }
    }

    setSubmitting(true);
    setError("");
    const { data: uploadData, error: uploadError } = await uploadRecruitmentResume(postingId, resumeFile);
    if (uploadError) {
      setError(uploadError.message);
      setSubmitting(false);
      return;
    }
    const resumePath = uploadData?.path;
    const insights = getApplicationInsights(posting, answers, form.cover_letter);

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
      status_history: [{ status: "new", at: new Date().toISOString(), by: "candidate", note: "Application submitted" }],
      extracted_skills: insights.extractedSkills,
      highlights: insights.highlights,
      red_flags: insights.redFlags,
      match_score: insights.matchScore,
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
  const deadline = typeof posting?.application_deadline === "string" ? posting.application_deadline : "";
  const isDeadlinePassed = Boolean(deadline && new Date(deadline) < new Date(new Date().toISOString().slice(0, 10)));
  const isClosed = ["closed", "filled", "draft"].includes(status) || isDeadlinePassed;
  const description = typeof posting?.description === "string" ? posting.description : "";
  const requirements = typeof posting?.requirements === "string" ? posting.requirements : "";
  const jobMeta = [posting?.employment_type, posting?.experience_level, posting?.salary_range]
    .filter(Boolean)
    .map(String)
    .join(" - ");

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">تطوير تالنت</p>
            <p className="text-xs text-slate-500">بوابة التقديم</p>
          </div>
          <Button variant="outline" className="mr-auto" asChild>
            <Link href="/candidate/applications">طلباتي</Link>
          </Button>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-brand" />
              {loading ? "جاري تحميل الوظيفة..." : String(posting?.title || "الوظيفة غير متاحة")}
            </CardTitle>
            {posting && (
              <p className="text-sm text-gray-500">
                {String(department?.name || "كل الأقسام")} - {String(location?.name || "موقع مرن")}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {!loading && !posting && <p className="text-sm text-red-600">رابط الوظيفة غير متاح.</p>}
            {isClosed && <p className="text-sm text-red-600">هذه الوظيفة لا تستقبل طلبات حاليا.</p>}
            {(submitted || existingApplication) && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
                <CheckCircle className="mb-2 h-5 w-5" />
                <p className="font-medium">تم استلام الطلب.</p>
                <p className="text-sm">الحالة الحالية: {String((existingApplication?.status || "new"))}</p>
                <Button variant="outline" className="mt-3" asChild>
                  <Link href="/candidate/applications">متابعة كل الطلبات</Link>
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
                      <p className="font-medium">{authMode === "signup" ? "إنشاء حساب مرشح" : "تسجيل الدخول للمتابعة"}</p>
                    </div>
                    <div className="grid gap-3">
                      {authMode === "signup" && (
                        <Input placeholder="الاسم الكامل" value={authForm.name} onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))} />
                      )}
                      <Input placeholder="البريد الإلكتروني" type="email" value={authForm.email} onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))} />
                      <Input placeholder="كلمة المرور" type="password" value={authForm.password} onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))} />
                      {authMessage && <p className="text-sm text-green-700">{authMessage}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleAuth}>
                          {authMode === "signup" ? "إنشاء حساب" : "تسجيل الدخول"}
                        </Button>
                        <Button variant="ghost" onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>
                          {authMode === "signup" ? "لدي حساب بالفعل" : "إنشاء حساب جديد"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {candidateUserId && (
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>الاسم الكامل</Label>
                      <Input value={form.candidate_name} onChange={(event) => set("candidate_name", event.target.value)} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>البريد الإلكتروني</Label>
                        <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>الجوال</Label>
                        <Input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>السيرة الذاتية</Label>
                      <Input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
                    </div>
                    <div className="space-y-2">
                      <Label>خطاب تعريفي</Label>
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
                      {submitting ? "جاري الإرسال..." : "إرسال الطلب"}
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
          <option value="">اختر</option>
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

function getApplicationInsights(
  posting: Record<string, unknown>,
  answers: Record<string, string>,
  coverLetter: string
) {
  const candidateText = `${Object.values(answers).join(" ")} ${coverLetter}`.toLowerCase();
  const requirementText = String(posting.requirements || "").toLowerCase();
  const extractedSkills = SKILL_KEYWORDS.filter((skill) => candidateText.includes(skill));
  const requiredSkills = SKILL_KEYWORDS.filter((skill) => requirementText.includes(skill));
  const matchedRequired = requiredSkills.filter((skill) => extractedSkills.includes(skill));
  const missingRequired = requiredSkills.filter((skill) => !extractedSkills.includes(skill));
  const answeredCount = Object.values(answers).filter((value) => value.trim()).length;
  const requiredScore = requiredSkills.length > 0
    ? Math.round((matchedRequired.length / requiredSkills.length) * 70)
    : 35;
  const answerScore = Math.min(20, answeredCount * 5);
  const coverLetterScore = coverLetter.trim().length >= 80 ? 10 : coverLetter.trim() ? 5 : 0;
  const matchScore = Math.min(100, requiredScore + answerScore + coverLetterScore);

  return {
    extractedSkills,
    matchScore,
    highlights: [
      ...matchedRequired.map((skill) => `Matches required skill: ${skill}`),
      coverLetter.trim().length >= 80 ? "Detailed cover letter" : null,
    ].filter(Boolean),
    redFlags: [
      ...missingRequired.map((skill) => `Missing required skill: ${skill}`),
      extractedSkills.length === 0 ? "No recognized skills in answers" : null,
    ].filter(Boolean),
  };
}
