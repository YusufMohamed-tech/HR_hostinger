"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    try {
      await fetch("/api/auth/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setMessage("إذا كان البريد مسجلاً، فسيصلك رابط آمن لإعادة تعيين كلمة المرور.");
    } catch {
      setMessage("تعذر إرسال الطلب حالياً. يرجى المحاولة لاحقاً.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6" dir="rtl">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">استعادة كلمة المرور</h1>
        <p className="mt-2 text-sm text-slate-500">
          أدخل بريدك الإلكتروني وسنرسل تعليمات الاستعادة إذا كان الحساب موجوداً.
        </p>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "جارٍ الإرسال..." : "إرسال رابط الاستعادة"}
          </Button>
        </form>

        {message && <p className="mt-4 text-sm text-slate-600" role="status">{message}</p>}

        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand hover:text-brand-dark">
          العودة إلى تسجيل الدخول
        </Link>
      </section>
    </main>
  );
}
