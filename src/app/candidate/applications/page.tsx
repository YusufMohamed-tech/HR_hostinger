"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getCandidateApplications, getCandidateRecruitmentMessages } from "@/lib/services/recruitment";

export default function CandidateApplicationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [messagesByApplication, setMessagesByApplication] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadApplications = async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      setUserId("");
      setApplications([]);
      setMessagesByApplication({});
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data } = await getCandidateApplications();
    const nextApplications = data || [];
    setApplications(nextApplications);
    const applicationIds = nextApplications.map((application) => String(application.id || "")).filter(Boolean);
    const { data: messages } = await getCandidateRecruitmentMessages(applicationIds);
    const groupedMessages = (messages || []).reduce<Record<string, Record<string, unknown>[]>>((acc, message) => {
      const applicationId = String(message.job_application_id || "");
      if (!applicationId) return acc;
      acc[applicationId] = [...(acc[applicationId] || []), message];
      return acc;
    }, {});
    setMessagesByApplication(groupedMessages);
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
    setMessagesByApplication({});
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
                    const messages = messagesByApplication[String(application.id)] || [];
                    const history = Array.isArray(application.status_history) ? application.status_history as Record<string, unknown>[] : [];
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
                        {history.length > 0 && (
                          <div className="mt-3 rounded-lg bg-gray-50 p-3">
                            <p className="mb-2 text-sm font-medium text-gray-900">Status timeline</p>
                            <div className="space-y-2">
                              {history.slice(0, 5).map((entry, index) => (
                                <div key={`${String(entry.status || "status")}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <span className="text-gray-700">{String(entry.status || "update")}</span>
                                  <span className="text-xs text-gray-500">{formatDate(entry.at)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {messages.length > 0 && (
                          <div className="mt-3 rounded-lg border border-brand/15 bg-brand-light/50 p-3">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-brand-dark">
                              <MessageSquare className="h-4 w-4" />
                              Recruiter messages
                            </div>
                            <div className="space-y-2">
                              {messages.slice(0, 3).map((message) => (
                                <div key={String(message.id)} className="rounded-md bg-white p-3 text-sm">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <p className="font-medium text-gray-900">{String(message.subject || "Update")}</p>
                                    <p className="text-xs text-gray-500">{formatDate(message.sent_at)}</p>
                                  </div>
                                  <p className="mt-1 whitespace-pre-wrap text-gray-600">{String(message.body || "")}</p>
                                </div>
                              ))}
                            </div>
                          </div>
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

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}
