"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    if (password !== confirmation) {
      setMessage("كلمتا المرور غير متطابقتين.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setMessage(payload.message || "تعذر تحديث كلمة المرور.");
        return;
      }
      setMessage("تم تحديث كلمة المرور. سيتم تحويلك لتسجيل الدخول.");
      window.setTimeout(() => router.replace("/login"), 900);
    } catch {
      setMessage("تعذر تحديث كلمة المرور حالياً.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6" dir="rtl">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">تعيين كلمة مرور جديدة</h1>
        <p className="mt-2 text-sm text-slate-500">
          استخدم 12 حرفاً على الأقل تتضمن أحرفاً كبيرة وصغيرة ورقماً.
        </p>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور الجديدة</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation">تأكيد كلمة المرور</Label>
            <Input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
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
