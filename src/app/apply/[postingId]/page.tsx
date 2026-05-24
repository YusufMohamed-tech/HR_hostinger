"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Briefcase, CheckCircle, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getJobPostingById, createJobApplication } from "@/lib/services/recruitment";

export default function PublicApplicationPage() {
  const params = useParams();
  const postingId = typeof params.postingId === "string" ? params.postingId : "";
  const [posting, setPosting] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ candidate_name: "", email: "", phone: "", resume_url: "", cover_letter: "" });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    async function loadPosting() {
      if (!postingId) return;
      const { data } = await getJobPostingById(postingId);
      setPosting(data);
      setLoading(false);
    }
    loadPosting();
  }, [postingId]);

  const handleSubmit = async () => {
    if (!posting?.org_id || !form.candidate_name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: err } = await createJobApplication({
      org_id: posting.org_id,
      job_posting_id: postingId,
      candidate_name: form.candidate_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      resume_url: form.resume_url.trim() || undefined,
      cover_letter: form.cover_letter.trim() || undefined,
      status: "new",
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSubmitted(true);
  };

  const department = (posting?.department ?? null) as Record<string, unknown> | null;
  const location = (posting?.location ?? null) as Record<string, unknown> | null;
  const status = typeof posting?.status === "string" ? posting.status : "";
  const isClosed = ["closed", "filled"].includes(status);
  const description = typeof posting?.description === "string" ? posting.description : "";
  const requirements = typeof posting?.requirements === "string" ? posting.requirements : "";

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Tatwir Talent</p>
            <p className="text-xs text-slate-500">Career Application</p>
          </div>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-brand" />
              {loading ? "Loading position..." : String(posting?.title || "Position unavailable")}
            </CardTitle>
            {posting && (
              <p className="text-sm text-gray-500">
                {String(department?.name || "All departments")} · {String(location?.name || "Flexible location")}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {!loading && !posting && <p className="text-sm text-red-600">This job posting is not available.</p>}
            {isClosed && <p className="text-sm text-red-600">This position is no longer accepting applications.</p>}
            {submitted && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
                <CheckCircle className="mb-2 h-5 w-5" />
                <p className="font-medium">Application received.</p>
                <p className="text-sm">Our recruitment team will review your application.</p>
              </div>
            )}
            {posting && !submitted && !isClosed && (
              <>
                <div className="space-y-2 text-sm text-gray-600">
                  {description && <p>{description}</p>}
                  {requirements && <p>{requirements}</p>}
                </div>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Full Name</Label>
                    <Input value={form.candidate_name} onChange={(event) => set("candidate_name", event.target.value)} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Resume Link</Label>
                    <Input value={form.resume_url} onChange={(event) => set("resume_url", event.target.value)} placeholder="Drive, LinkedIn, or portfolio URL" />
                  </div>
                  <div className="space-y-2">
                    <Label>Cover Letter</Label>
                    <Input value={form.cover_letter} onChange={(event) => set("cover_letter", event.target.value)} />
                  </div>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit Application"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
