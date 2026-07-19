"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Laptop, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type TotpFactor = {
  id: string;
  friendly_name?: string;
  created_at: string;
};

type Enrollment = {
  id: string;
  qrCode: string;
  secret: string;
};

function qrSource(value: string) {
  if (value.startsWith("data:")) return value;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

function safeReturnPath() {
  if (typeof window === "undefined") return "/settings";
  const requested = new URLSearchParams(window.location.search).get("next");
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/settings";
}

export default function SecuritySettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [assuranceLevel, setAssuranceLevel] = useState<string | null>(null);
  const [lastSignIn, setLastSignIn] = useState<string | null>(null);
  const [device, setDevice] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSecurityState() {
    setLoading(true);
    setError("");
    const [factorResult, assuranceResult, userResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.getUser(),
    ]);

    const failure = factorResult.error || assuranceResult.error || userResult.error;
    if (failure) {
      setError("تعذر تحميل حالة الأمان. أعد تسجيل الدخول وحاول مرة أخرى.");
      setLoading(false);
      return;
    }

    setFactors(factorResult.data.totp);
    setAssuranceLevel(assuranceResult.data.currentLevel);
    setLastSignIn(userResult.data.user.last_sign_in_at || null);
    setDevice(window.navigator.userAgent);
    setLoading(false);
  }

  useEffect(() => {
    void loadSecurityState();
    // The browser client is stable for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnrollment() {
    setWorking(true);
    setError("");
    setMessage("");

    const currentFactors = await supabase.auth.mfa.listFactors();
    if (currentFactors.error) {
      setError("تعذر بدء إعداد التحقق بعاملين.");
      setWorking(false);
      return;
    }

    const unverified = currentFactors.data.all.filter(
      (factor) => factor.factor_type === "totp" && factor.status === "unverified"
    );
    for (const factor of unverified) {
      const removal = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removal.error) {
        setError("تعذر تنظيف محاولة إعداد سابقة. أعد تسجيل الدخول وحاول مرة أخرى.");
        setWorking(false);
        return;
      }
    }

    const result = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Tatwir Authenticator",
      issuer: "Tatwir HRMS",
    });
    if (result.error) {
      setError("تعذر إنشاء رمز التحقق. حاول مرة أخرى.");
    } else {
      setEnrollment({
        id: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
      });
    }
    setWorking(false);
  }

  async function verifyFactor() {
    const factorId = enrollment?.id || factors[0]?.id;
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة.");
      return;
    }

    setWorking(true);
    setError("");
    setMessage("");
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (result.error) {
      setError("رمز التحقق غير صحيح أو انتهت صلاحيته.");
      setWorking(false);
      return;
    }

    setEnrollment(null);
    setCode("");
    setMessage("تم تفعيل التحقق بعاملين وتأمين الجلسة الحالية.");
    await loadSecurityState();
    window.setTimeout(() => window.location.assign(safeReturnPath()), 700);
    setWorking(false);
  }

  async function signOutOtherSessions() {
    setWorking(true);
    setError("");
    setMessage("");
    const result = await supabase.auth.signOut({ scope: "others" });
    if (result.error) {
      setError("تعذر إنهاء الجلسات الأخرى.");
    } else {
      setMessage("تم إنهاء جميع الجلسات الأخرى بنجاح.");
    }
    setWorking(false);
  }

  const verified = factors.length > 0;
  const aal2 = assuranceLevel === "aal2";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">أمان الحساب</h1>
        <p className="mt-1 text-sm text-gray-500">إدارة عامل التحقق والجلسات المرتبطة بحسابك.</p>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {message && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700" role="status">{message}</p>}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand" />
            التحقق بعاملين (TOTP)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <p className="text-sm text-gray-500">جارٍ تحميل حالة الأمان...</p>
          ) : (
            <>
              <div className="rounded-lg border bg-gray-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>العامل المسجل</span>
                  <span className={verified ? "font-medium text-green-700" : "font-medium text-amber-700"}>
                    {verified ? "مفعّل" : "غير مفعّل"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span>حماية الجلسة الحالية</span>
                  <span className={aal2 ? "font-medium text-green-700" : "font-medium text-amber-700"}>
                    {aal2 ? "AAL2" : "تحتاج رمز تحقق"}
                  </span>
                </div>
              </div>

              {!verified && !enrollment && (
                <Button onClick={startEnrollment} disabled={working}>إعداد تطبيق المصادقة</Button>
              )}

              {enrollment && (
                <div className="space-y-4 rounded-xl border p-4">
                  <p className="text-sm text-gray-600">
                    امسح الرمز بتطبيق مصادقة، ثم أدخل الرمز المؤقت. لا تشارك المفتاح السري مع أي شخص.
                  </p>
                  <div className="flex justify-center rounded-lg bg-white p-3">
                    <Image
                      src={qrSource(enrollment.qrCode)}
                      alt="رمز إعداد تطبيق المصادقة"
                      width={220}
                      height={220}
                      unoptimized
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>المفتاح اليدوي</Label>
                    <code className="block break-all rounded bg-slate-100 p-3 text-left text-sm" dir="ltr">
                      {enrollment.secret}
                    </code>
                  </div>
                </div>
              )}

              {((verified && !aal2) || enrollment) && (
                <div className="max-w-sm space-y-3">
                  <Label htmlFor="totp-code">رمز التحقق</Label>
                  <Input
                    id="totp-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    dir="ltr"
                  />
                  <Button onClick={verifyFactor} disabled={working || code.length !== 6}>
                    <KeyRound className="ml-2 h-4 w-4" />
                    تحقق وتأمين الجلسة
                  </Button>
                </div>
              )}

              {aal2 && (
                <div className="flex items-center gap-2 text-sm font-medium text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  هذه الجلسة محمية بعاملين.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-brand" />
            الجلسات والأجهزة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-gray-50 p-4 text-sm">
            <p><span className="text-gray-500">آخر تسجيل دخول: </span>{lastSignIn ? new Date(lastSignIn).toLocaleString("ar-EG") : "غير متاح"}</p>
            <p className="mt-2 break-words"><span className="text-gray-500">الجهاز الحالي: </span>{device || "غير متاح"}</p>
          </div>
          <Button variant="outline" onClick={signOutOtherSessions} disabled={working || !aal2}>
            إنهاء جميع الجلسات الأخرى
          </Button>
          {!aal2 && <p className="text-xs text-amber-700">تحقق بالعامل الثاني أولاً للتحكم في الجلسات الأخرى.</p>}
        </CardContent>
      </Card>

      <Button asChild variant="ghost" className="w-fit">
        <Link href="/settings">العودة إلى الإعدادات</Link>
      </Button>
    </div>
  );
}
