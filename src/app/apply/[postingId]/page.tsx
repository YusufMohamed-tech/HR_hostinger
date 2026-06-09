"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Briefcase, Building2, Calendar, CheckCircle, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { submitApplication } from "@/lib/services/candidate";
import type { FormQuestion } from "@/lib/services/recruitment";

const EMP_TYPE_MAP: Record<string, string> = {
  full_time: "دوام كامل",
  part_time: "دوام جزئي",
  contract: "عقد",
  internship: "تدريب",
};

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: FormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const base = "w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30";
  if (q.type === "textarea") {
    return <textarea className={`${base} resize-none`} rows={3} required={q.required} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.type === "select") {
    return (
      <select className={base} required={q.required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">اختر...</option>
        {(q.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (q.type === "yesno") {
    return (
      <div className="mt-1 flex gap-4">
        {["نعم", "لا"].map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" name={q.id} value={opt} checked={value === opt} onChange={() => onChange(opt)} required={q.required} />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === "date") {
    return <input type="date" className={base} required={q.required} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.type === "number") {
    return <input type="number" className={base} required={q.required} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" className={base} required={q.required} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function PublicApplyPage() {
  const params = useParams();
  const slug = params.postingId as string;

  const [posting, setPosting] = useState<Record<string, unknown> | null>(null);
  const [loadingPosting, setLoadingPosting] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cvFile, setCvFile] = useState<File | null>(null);

  useEffect(() => {
    fetch(`/api/candidate/posting?slug=${slug}`)
      .then((response) => response.json())
      .then(({ data }) => {
        setPosting(data ?? null);
        setLoadingPosting(false);
      })
      .catch(() => setLoadingPosting(false));
  }, [slug]);

  const questions: FormQuestion[] = Array.isArray(posting?.form_schema)
    ? (posting.form_schema as FormQuestion[])
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posting) return;
    setSubmitting(true);
    setMessage("");

    const { error } = await submitApplication({
      slug,
      candidate_name: name,
      email,
      phone: phone || undefined,
      answers,
      cv: cvFile,
    });

    setSubmitting(false);
    if (error) {
      setMessage(error);
      return;
    }
    setSubmitted(true);
  };

  if (loadingPosting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" dir="rtl">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  if (!posting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-3 pt-6 text-center">
            <Briefcase className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
            <p className="font-medium text-gray-700">الوظيفة غير متاحة</p>
            <p className="text-sm text-muted-foreground">انتهى الوقت المحدد للتقديم أو الوظيفة مغلقة.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-3 pt-6 text-center">
            <CheckCircle className="mx-auto h-14 w-14 text-green-500" />
            <p className="text-xl font-bold text-gray-900">تم إرسال طلبك بنجاح</p>
            <p className="text-sm text-muted-foreground">تم إرسال بياناتك إلى فريق الموارد البشرية، وسيتم التواصل معك عند الحاجة.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-brand/10 p-3 text-brand">
                <Briefcase className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-bold text-gray-900">{posting.title as string}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">{((posting as Record<string, unknown>).org as Record<string, string> | null)?.name || ""}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {Boolean(posting.company_name) && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {posting.company_name as string}
                    </span>
                  )}
                  {Boolean(posting.city) && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {posting.city as string}
                    </span>
                  )}
                  {((posting as Record<string, unknown>).department as Record<string, string> | null)?.name && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {((posting as Record<string, unknown>).department as Record<string, string>).name}
                    </span>
                  )}
                  {((posting as Record<string, unknown>).location as Record<string, string> | null)?.name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {((posting as Record<string, unknown>).location as Record<string, string>).name}
                    </span>
                  )}
                  {Boolean(posting.employment_type) && (
                    <span>{EMP_TYPE_MAP[posting.employment_type as string] || (posting.employment_type as string)}</span>
                  )}
                  {Boolean(posting.deadline) && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      آخر موعد: {new Date(posting.deadline as string).toLocaleDateString("ar-SA")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {Boolean(posting.description) && (
              <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{posting.description as string}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">نموذج التقديم</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>الاسم الكامل <span className="text-red-500">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" required className="mt-1" />
              </div>
              <div>
                <Label>البريد الإلكتروني <span className="text-red-500">*</span></Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required className="mt-1" />
              </div>
              <div>
                <Label>رقم الجوال</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" className="mt-1" />
              </div>
              <div>
                <Label>السيرة الذاتية</Label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setCvFile(e.target.files?.[0] || null)}
                  className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm text-gray-700"
                />
              </div>

              {questions.map((q) => (
                <div key={q.id}>
                  <Label>
                    {q.label}
                    {q.required && <span className="mr-1 text-red-500">*</span>}
                  </Label>
                  <div className="mt-1">
                    <QuestionField
                      q={q}
                      value={answers[q.id] || ""}
                      onChange={(value) => setAnswers((previous) => ({ ...previous, [q.id]: value }))}
                    />
                  </div>
                </div>
              ))}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand text-white hover:bg-brand-dark"
              >
                {submitting ? "جاري الإرسال..." : "إرسال الطلب"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
