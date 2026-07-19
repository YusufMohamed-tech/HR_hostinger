"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Briefcase, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";

export default function CandidateRegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [registered, setRegistered] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setMessage("استخدم 12 حرفًا على الأقل مع حرف كبير وصغير ورقم.");
      return;
    }
    setLoading(true);
    const response = await fetch("/api/auth/candidate-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      setMessage(String(payload?.message || "تعذر إنشاء الحساب."));
    } else {
      setRegistered(true);
    }
  };

  if (registered) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-2xl mb-3">
            <Briefcase className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">تم إنشاء حسابك!</h2>
          <p className="text-sm text-muted-foreground">
            تحقق من بريدك الإلكتروني لتفعيل الحساب، ثم سجّل الدخول.
          </p>
          <Link href="/candidate/login">
            <Button className="mt-2 bg-brand hover:bg-brand-dark text-white">
              تسجيل الدخول
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand/10 rounded-2xl mb-3">
            <Briefcase className="w-7 h-7 text-brand" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">إنشاء حساب</h1>
          <p className="text-sm text-muted-foreground mt-1">بوابة المتقدمين — تطوير تالنت</p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>الاسم الكامل</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="محمد أحمد"
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label>البريد الإلكتروني</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                  autoComplete="email"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>كلمة المرور</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="12 حرفًا مع حرف كبير وصغير ورقم"
                    className="pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-brand hover:bg-brand-dark text-white"
              >
                {loading ? "جاري الإنشاء..." : "إنشاء الحساب"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-4">
              لديك حساب بالفعل؟{" "}
              <Link href="/candidate/login" className="text-brand underline">
                تسجيل الدخول
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          هذه البوابة للمتقدمين فقط.{" "}
          <Link href="/login" className="underline">
            دخول الموظفين
          </Link>
        </p>
      </div>

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
