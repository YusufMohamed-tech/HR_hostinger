"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Eye, EyeOff } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { getDefaultPathForRole } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const { currentUser, login } = useRoleContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (currentUser) {
      router.replace(getDefaultPathForRole(currentUser.role));
    }
  }, [currentUser, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const result = await login({ email, password });
    setMessage(result.message);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-muted">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Left branding panel — hidden on mobile, shown on lg+ */}
        <div className="relative overflow-hidden bg-white hidden lg:block">
          <div className="absolute -right-24 top-10 h-80 w-80 rotate-12 rounded-[48px] bg-slate-100/80" />
          <div className="absolute -right-8 bottom-8 h-64 w-64 rotate-12 rounded-[40px] bg-slate-100/70" />
          <div className="relative z-10 flex h-full flex-col justify-between p-8 lg:p-12">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wide text-slate-600">تطوير تالنت</p>
                <p className="text-xs text-slate-400">منصة ذكاء القوى العاملة</p>
              </div>
            </div>

            <div className="mt-10 space-y-5">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                قِس العمل. <span className="text-brand">وارفع الأداء.</span>
              </h1>
              <p className="text-slate-500 max-w-lg">
                نظام موارد بشرية ذكي للفرق الميدانية. تابع الأداء، حسّن الجداول،
                واربط بيانات الحضور بنتائج الرواتب.
              </p>
              <div className="grid gap-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  مؤشرات أداء وتحليلات إنتاجية لحظية
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  كشف ذكي للشذوذ في الحضور والحركة
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  جدولة القوى العاملة عبر المواقع
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-400">www.tatwir-ksa.com</div>
          </div>
        </div>

        {/* Right login form — full width on mobile */}
        <div className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            {/* Mobile-only branding */}
            <div className="flex items-center gap-3 mb-6 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
                <Network className="h-4 w-4" />
              </div>
              <span className="font-bold text-lg tracking-tight text-slate-900">تطوير تالنت</span>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-slate-900">تسجيل الدخول</h2>
              <p className="text-sm text-slate-500">أدخل بياناتك للوصول إلى لوحة التحكم.</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="أدخل كلمة المرور"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full bg-brand hover:bg-brand-dark text-white" disabled={submitting}>
                {submitting ? "جار تسجيل الدخول..." : "تسجيل الدخول"}
              </Button>

              {message && (
                <p className={`text-sm text-center ${message.includes("successful") || message.includes("نجاح") ? "text-brand-dark" : "text-red-600"}`}>
                  {message}
                </p>
              )}
            </form>

            <div className="mt-6 border-t pt-4">
              <p className="text-xs text-slate-400">استخدم بيانات حساب الشركة لتسجيل الدخول.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

