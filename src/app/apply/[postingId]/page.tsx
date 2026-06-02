"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Briefcase, CheckCircle, Calendar, MapPin, Building2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { createClient } from "@/lib/supabase/client";
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
  const base = "w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30";
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
      <div className="flex gap-4 mt-1">
        {["نعم", "لا"].map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
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
  // The [postingId] folder param is actually the public_slug
  const slug = params.postingId as string;
  const supabase = useMemo(() => createClient(), []);

  const [posting, setPosting] = useState<Record<string, unknown> | null>(null);
  const [loadingPosting, setLoadingPosting] = useState(true);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cvFile, setCvFile] = useState<File | null>(null);

  // Auth
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Load posting by slug (public fetch — no auth required)
  useEffect(() => {
    fetch(`/api/candidate/posting?slug=${slug}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setPosting(data ?? null);
        setLoadingPosting(false);
      })
      .catch(() => setLoadingPosting(false));
  }, [slug]);

  // Check current auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser({ id: data.user.id, email: data.user.email });
        setEmail(data.user.email || "");
      }
    });
  }, [supabase]);

  const questions: FormQuestion[] = Array.isArray(posting?.form_schema)
    ? (posting!.form_schema as FormQuestion[])
    : [];

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    if (authTab === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (error) setMessage(error.message);
      else {
        const { data } = await supabase.auth.getUser();
        if (data?.user) setUser({ id: data.user.id, email: data.user.email });
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: { data: { full_name: authName } },
      });
      if (error) setMessage(error.message);
      else setMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتفعيل الحساب، ثم سجّل الدخول.");
    }
    setAuthLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!posting) return;
    setSubmitting(true);

    // Upload CV if provided
    let cvUrl: string | undefined;
    if (cvFile) {
      const ext = cvFile.name.split(".").pop();
      const filePath = `cv/${user.id}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("recruitment").upload(filePath, cvFile, { upsert: true });
      if (uploadErr) {
        setSubmitting(false);
        setMessage("تعذّر رفع السيرة الذاتية. يرجى التحقق من الملف والمحاولة مرة أخرى، أو أرسل الطلب بدون سيرة ذاتية بعد حذف الملف المحدد.");
        return;
      }
      const { data: urlData } = supabase.storage.from("recruitment").getPublicUrl(filePath);
      cvUrl = urlData.publicUrl;
    }

    const { error } = await submitApplication({
      slug,
      candidate_name: name || user.email || "مجهول",
      phone: phone || undefined,
      answers,
      cv_url: cvUrl,
    });
    setSubmitting(false);
    if (error) {
      setMessage(error);
    } else {
      setSubmitted(true);
    }
  };

  if (loadingPosting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  if (!posting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <Briefcase className="w-12 h-12 mx-auto text-muted-foreground opacity-40" />
            <p className="text-gray-700 font-medium">الوظيفة غير متاحة</p>
            <p className="text-sm text-muted-foreground">انتهى الوقت المحدد للتقديم أو الوظيفة مغلقة.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <CheckCircle className="w-14 h-14 mx-auto text-green-500" />
            <p className="text-xl font-bold text-gray-900">تم تقديم طلبك بنجاح!</p>
            <p className="text-sm text-muted-foreground">سنتواصل معك قريباً عبر البريد الإلكتروني.</p>
            <Link href="/candidate/applications">
              <Button className="mt-2 bg-brand hover:bg-brand-dark text-white">
                عرض طلباتي
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header card */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-4">
              <div className="bg-brand/10 text-brand rounded-xl p-3">
                <Briefcase className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-bold text-gray-900">{posting.title as string}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">{((posting as Record<string, unknown>).org as Record<string, string> | null)?.name || ""}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                  {((posting as Record<string, unknown>).department as Record<string, string> | null)?.name && (
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      {((posting as Record<string, unknown>).department as Record<string, string>).name}
                    </span>
                  )}
                  {((posting as Record<string, unknown>).location as Record<string, string> | null)?.name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {((posting as Record<string, unknown>).location as Record<string, string>).name}
                    </span>
                  )}
                  {Boolean(posting.employment_type) && (
                    <span>{EMP_TYPE_MAP[posting.employment_type as string] || (posting.employment_type as string)}</span>
                  )}
                  {Boolean(posting.deadline) && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      آخر موعد: {new Date(posting.deadline as string).toLocaleDateString("ar-SA")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {Boolean(posting.description) && (
              <p className="text-sm text-gray-700 mt-4 whitespace-pre-line">{posting.description as string}</p>
            )}
          </CardContent>
        </Card>

        {/* Auth gate */}
        {!user ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="w-4 h-4" />
                تسجيل الدخول للتقديم
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4 border-b">
                <button
                  className={`pb-2 px-3 text-sm font-medium transition-colors ${authTab === "login" ? "border-b-2 border-brand text-brand" : "text-muted-foreground"}`}
                  onClick={() => setAuthTab("login")}
                >
                  تسجيل الدخول
                </button>
                <button
                  className={`pb-2 px-3 text-sm font-medium transition-colors ${authTab === "register" ? "border-b-2 border-brand text-brand" : "text-muted-foreground"}`}
                  onClick={() => setAuthTab("register")}
                >
                  إنشاء حساب
                </button>
              </div>
              <form onSubmit={handleAuth} className="space-y-3">
                {authTab === "register" && (
                  <div>
                    <Label>الاسم الكامل</Label>
                    <Input
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="محمد أحمد"
                      required
                      className="mt-1"
                    />
                  </div>
                )}
                <div>
                  <Label>البريد الإلكتروني</Label>
                  <Input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>كلمة المرور</Label>
                  <Input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>
                <Button type="submit" disabled={authLoading} className="w-full bg-brand hover:bg-brand-dark text-white">
                  {authLoading ? "جاري المعالجة..." : authTab === "login" ? "دخول" : "إنشاء حساب"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          /* Application form */
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">نموذج التقديم</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Fixed fields */}
                <div>
                  <Label>الاسم الكامل <span className="text-red-500">*</span></Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" required className="mt-1" />
                </div>
                <div>
                  <Label>البريد الإلكتروني <span className="text-red-500">*</span></Label>
                  <Input type="email" value={email} readOnly className="mt-1 bg-muted/40" />
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
                    className="mt-1 block w-full text-sm text-gray-700 border border-border rounded-md px-3 py-2"
                  />
                </div>

                {/* Custom questions */}
                {questions.map((q) => (
                  <div key={q.id}>
                    <Label>
                      {q.label}
                      {q.required && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    <div className="mt-1">
                      <QuestionField
                        q={q}
                        value={answers[q.id] || ""}
                        onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                      />
                    </div>
                  </div>
                ))}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brand hover:bg-brand-dark text-white"
                >
                  {submitting ? "جاري الإرسال..." : "تقديم الطلب"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
