"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getCandidateApplications } from "@/lib/services/recruitment";

export default function CandidateApplicationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadApplications = async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      setUserId("");
      setApplications([]);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data } = await getCandidateApplications();
    setApplications(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadApplications();
    const { data } = supabase.auth.onAuthStateChange(() => {
      loadApplications();
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      return;
    }
    await loadApplications();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUserId("");
    setApplications([]);
  };

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Tatwir Talent</p>
            <p className="text-xs text-slate-500">Candidate portal</p>
          </div>
          {userId && (
            <Button variant="outline" className="mr-auto" onClick={signOut}>Sign out</Button>
          )}
        </div>

        {!userId ? (
          <Card className="mx-auto w-full max-w-md border-none shadow-sm">
            <CardHeader>
              <CardTitle>Sign in to track applications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              <Input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full bg-brand hover:bg-brand-dark text-white" onClick={signIn}>Sign in</Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>My applications</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-10 text-center text-sm text-gray-500">Loading applications...</div>
              ) : applications.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">No applications yet.</div>
              ) : (
                <div className="grid gap-3">
                  {applications.map((application) => {
                    const job = (application.job ?? null) as Record<string, unknown> | null;
                    const applicationStatus = String(application.status || "new");
                    return (
                      <div key={String(application.id)} className="rounded-lg border bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900">{String(job?.title || "Job application")}</p>
                            <p className="text-xs text-gray-500">Applied at {new Date(String(application.applied_at)).toLocaleDateString()}</p>
                          </div>
                          <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{applicationStatus}</Badge>
                        </div>
                        {Boolean(application.notes) && (
                          <p className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-600">{String(application.notes)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/">Back to website</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
