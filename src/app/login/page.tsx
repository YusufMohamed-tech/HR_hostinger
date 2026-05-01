"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Role } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roles: Role[] = ["Super Admin", "Admin", "Team Leader", "Employee"];

export default function LoginPage() {
  const router = useRouter();
  const { currentUser, login } = useRoleContext();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Employee");

  useEffect(() => {
    if (currentUser) {
      router.replace("/");
    }
  }, [currentUser, router]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    login({ email, name, role });
    router.replace("/");
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
              <p className="text-sm text-slate-500">Choose a role to preview the system.</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
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
                <Label>Role</Label>
                <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full bg-brand hover:bg-brand-dark text-white">
                Continue to dashboard
              </Button>
            </form>

            <p className="mt-4 text-xs text-slate-400">
              Demo mode only. Authentication will be replaced by Supabase magic link.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
