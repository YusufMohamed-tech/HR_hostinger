"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Eye, EyeOff } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
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
      router.replace("/");
    }
  }, [currentUser, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const result = await login({ email, password });
    setMessage(result.message);
    setSubmitting(false);

    if (result.success) {
      router.replace("/");
    }
  };

  return (
    <div className="min-h-screen bg-muted">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="relative overflow-hidden bg-white">
          <div className="absolute -right-24 top-10 h-80 w-80 rotate-12 rounded-[48px] bg-slate-100/80" />
          <div className="absolute -right-8 bottom-8 h-64 w-64 rotate-12 rounded-[40px] bg-slate-100/70" />
          <div className="relative z-10 flex h-full flex-col justify-between p-8 lg:p-12">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wide text-slate-600">Tatwir Talent</p>
                <p className="text-xs text-slate-400">Workforce Intelligence Platform</p>
              </div>
            </div>

            <div className="mt-10 space-y-5">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                Measure Work. <span className="text-brand">Maximize Performance.</span>
              </h1>
              <p className="text-slate-500 max-w-lg">
                AI-driven HRMS for deskless teams. Track performance, optimize shifts,
                and connect workforce data to payroll outcomes.
              </p>
              <div className="grid gap-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  KPI and productivity analytics in real time
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  AI anomaly detection for attendance and movement
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  Workforce scheduling across locations
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-400">www.tatwir-ksa.com</div>
          </div>
        </div>

        <div className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
              <p className="text-sm text-slate-500">Enter your credentials to access the dashboard.</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
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
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full bg-brand hover:bg-brand-dark text-white" disabled={submitting}>
                {submitting ? "Signing in..." : "Sign in"}
              </Button>

              {message && (
                <p className={`text-sm text-center ${message.includes("successful") ? "text-brand-dark" : "text-red-600"}`}>
                  {message}
                </p>
              )}
            </form>

            <div className="mt-6 border-t pt-4">
              <p className="text-xs text-slate-400 mb-3">Demo accounts:</p>
              <div className="grid gap-1.5 text-xs text-slate-500">
                <div className="flex justify-between"><span className="font-medium">Super Admin</span><span>superadmin1234@gmail.com / superadmin</span></div>
                <div className="flex justify-between"><span className="font-medium">Admin</span><span>admin@tatwir.com / admin1234</span></div>
                <div className="flex justify-between"><span className="font-medium">Team Leader</span><span>leader@tatwir.com / leader1234</span></div>
                <div className="flex justify-between"><span className="font-medium">Employee</span><span>employee@tatwir.com / employee1234</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
