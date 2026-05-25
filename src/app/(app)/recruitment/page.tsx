"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Copy, ExternalLink, FileText, Plus, Save, Star } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  createJobPosting,
  getJobApplications,
  getJobPostings,
  getRecruitmentResumeUrl,
  updateJobApplication,
} from "@/lib/services/recruitment";
import { useDepartments, useLocations } from "@/hooks/use-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FormQuestion = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  required: boolean;
  options?: string;
};

const APPLICATION_STATUSES = [
  { value: "new", label: "New" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

export default function RecruitmentPage() {
  const { currentUser } = useRoleContext();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const canManageRecruitment = ["Admin", "HR_Admin", "HR_Recruitment"].includes(currentUser?.role || "");

  const loadRecruitment = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const [jobResult, applicationResult] = await Promise.all([
      getJobPostings(currentUser.orgId),
      getJobApplications(currentUser.orgId, selectedJobId === "all" ? undefined : selectedJobId),
    ]);
    setJobs(jobResult.data || []);
    setApplications(applicationResult.data || []);
    setLoading(false);
  }, [currentUser?.orgId, selectedJobId]);

  useEffect(() => {
    loadRecruitment();
  }, [loadRecruitment]);

  const activeJobs = jobs.filter((job) => ["open", "published"].includes(String(job.status || ""))).length;
  const publicOrigin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Recruitment</h1>
          <p className="text-sm text-gray-500">Create public job forms, share application links, and manage the hiring pipeline.</p>
        </div>
        {canManageRecruitment && (
          <CreateJobDialog
            departments={departments}
            locations={locations}
            onSuccess={loadRecruitment}
          />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Published jobs" value={String(activeJobs)} />
        <MetricCard label="Applications" value={String(applications.length)} />
        <MetricCard label="Interviews" value={String(applications.filter((app) => app.status === "interview").length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.35fr]">
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-brand" />
              Job postings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <EmptyRow text="Loading jobs..." />
            ) : jobs.length === 0 ? (
              <EmptyRow text="No jobs yet. Create the first posting to generate a public application link." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const jobId = String(job.id || "");
                    const department = (job.department ?? null) as Record<string, unknown> | null;
                    const status = String(job.status || "open");
                    const link = `${publicOrigin}/apply/${jobId}`;
                    return (
                      <TableRow
                        key={jobId}
                        className={selectedJobId === jobId ? "bg-brand-light/60" : undefined}
                        onClick={() => setSelectedJobId(jobId)}
                      >
                        <TableCell>
                          <div className="font-medium">{String(job.title || "Untitled")}</div>
                          <div className="text-xs text-gray-500">{String(department?.name || "All departments")}</div>
                        </TableCell>
                        <TableCell><StatusBadge status={status} /></TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigator.clipboard?.writeText(link);
                              }}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <a href={link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand" />
              Applications
            </CardTitle>
            <Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(value || "all")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={String(job.id)} value={String(job.id)}>{String(job.title || "Untitled")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <EmptyRow text="Loading applications..." />
            ) : applications.length === 0 ? (
              <EmptyRow text="No applications for this filter." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((application) => {
                    const job = (application.job ?? null) as Record<string, unknown> | null;
                    return (
                      <TableRow key={String(application.id)}>
                        <TableCell>
                          <div className="font-medium">{String(application.candidate_name || "Candidate")}</div>
                          <div className="text-xs text-gray-500">{String(application.email || "")}</div>
                        </TableCell>
                        <TableCell>{String(job?.title || "Unknown")}</TableCell>
                        <TableCell><StatusBadge status={String(application.status || "new")} /></TableCell>
                        <TableCell>
                          <ApplicationReviewDialog application={application} onSuccess={loadRecruitment} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="py-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-gray-500">{text}</div>;
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "hired" || status === "published" || status === "open"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "rejected" || status === "closed"
        ? "bg-red-50 text-red-700 border-red-200"
        : status === "interview" || status === "offer"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-amber-50 text-amber-700 border-amber-200";
  return <Badge variant="outline" className={className}>{status}</Badge>;
}

function CreateJobDialog({
  departments,
  locations,
  onSuccess,
}: {
  departments: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<FormQuestion[]>([
    { id: crypto.randomUUID(), label: "Why are you interested in this role?", type: "textarea", required: true },
  ]);
  const [form, setForm] = useState({
    title: "",
    department_id: "",
    location_id: "",
    employment_type: "full_time",
    experience_level: "",
    salary_range: "",
    description: "",
    requirements: "",
    status: "published",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value || "" }));

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "", type: "text", required: false },
    ]);
  };

  const updateQuestion = (id: string, values: Partial<FormQuestion>) => {
    setQuestions((prev) => prev.map((question) => question.id === id ? { ...question, ...values } : question));
  };

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.title.trim()) {
      setError("Job title is required.");
      return;
    }
    const cleanedQuestions = questions
      .filter((question) => question.label.trim())
      .map((question) => ({
        ...question,
        label: question.label.trim(),
        options: question.options?.trim() || undefined,
      }));

    setSubmitting(true);
    setError("");
    const { error: createError } = await createJobPosting({
      org_id: currentUser.orgId,
      title: form.title.trim(),
      department_id: form.department_id || undefined,
      location_id: form.location_id || undefined,
      employment_type: form.employment_type,
      experience_level: form.experience_level.trim() || undefined,
      salary_range: form.salary_range.trim() || undefined,
      description: form.description.trim() || undefined,
      requirements: form.requirements.trim() || undefined,
      status: form.status,
      created_by: currentUser.id,
      form_schema: cleanedQuestions,
    });
    setSubmitting(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    setOpen(false);
    setForm({
      title: "",
      department_id: "",
      location_id: "",
      employment_type: "full_time",
      experience_level: "",
      salary_range: "",
      description: "",
      requirements: "",
      status: "published",
    });
    setQuestions([{ id: crypto.randomUUID(), label: "Why are you interested in this role?", type: "textarea", required: true }]);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="h-4 w-4 ml-2" /> Create job form
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create job announcement</DialogTitle>
          <DialogDescription>Define the job details and the custom questions candidates must answer.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto py-4 pr-1">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Job title"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Department">
              <Select value={form.department_id} onValueChange={(value) => set("department_id", value)}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={String(department.id)} value={String(department.id)}>{String(department.name || "")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Location">
              <Select value={form.location_id} onValueChange={(value) => set("location_id", value)}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={String(location.id)} value={String(location.id)}>{String(location.name || "")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Employment type"><Input value={form.employment_type} onChange={(event) => set("employment_type", event.target.value)} /></Field>
            <Field label="Experience level"><Input value={form.experience_level} onChange={(event) => set("experience_level", event.target.value)} /></Field>
            <Field label="Salary range"><Input value={form.salary_range} onChange={(event) => set("salary_range", event.target.value)} /></Field>
          </div>
          <Field label="Job description"><Input value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
          <Field label="Requirements"><Input value={form.requirements} onChange={(event) => set("requirements", event.target.value)} /></Field>

          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium">Application form questions</p>
                <p className="text-xs text-gray-500">These fields appear on the public application link.</p>
              </div>
              <Button variant="outline" size="sm" onClick={addQuestion}>Add question</Button>
            </div>
            <div className="space-y-3">
              {questions.map((question, index) => (
                <div key={question.id} className="grid gap-2 rounded-md bg-gray-50 p-3 md:grid-cols-[1fr_140px_100px]">
                  <Input
                    placeholder={`Question ${index + 1}`}
                    value={question.label}
                    onChange={(event) => updateQuestion(question.id, { label: event.target.value })}
                  />
                  <Select value={question.type} onValueChange={(value) => updateQuestion(question.id, { type: value as FormQuestion["type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="textarea">Long text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="select">Options</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) => updateQuestion(question.id, { required: event.target.checked })}
                    />
                    Required
                  </label>
                  {question.type === "select" && (
                    <Input
                      className="md:col-span-3"
                      placeholder="Comma-separated options"
                      value={question.options || ""}
                      onChange={(event) => updateQuestion(question.id, { options: event.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            <Save className="h-4 w-4 ml-2" />
            {submitting ? "Creating..." : "Create and generate link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ApplicationReviewDialog({ application, onSuccess }: { application: Record<string, unknown>; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumeUrl, setResumeUrl] = useState("");
  const [status, setStatus] = useState(String(application.status || "new"));
  const [rating, setRating] = useState(String(application.rating || ""));
  const [notes, setNotes] = useState(String(application.notes || ""));
  const answers = useMemo(() => (application.application_answers ?? {}) as Record<string, unknown>, [application.application_answers]);

  useEffect(() => {
    async function loadResumeUrl() {
      const resumePath = typeof application.resume_url === "string" ? application.resume_url : "";
      if (!open || !resumePath) return;
      const { data } = await getRecruitmentResumeUrl(resumePath);
      setResumeUrl(data?.signedUrl || "");
    }
    loadResumeUrl();
  }, [application.resume_url, open]);

  const handleSave = async () => {
    setSaving(true);
    await updateJobApplication(String(application.id), {
      status,
      rating: rating ? Number(rating) : undefined,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Review</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{String(application.candidate_name || "Candidate")}</DialogTitle>
          <DialogDescription>{String(application.email || "")} {application.phone ? `· ${String(application.phone)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value || "new")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {APPLICATION_STATUSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Rating">
              <Select value={rating} onValueChange={(value) => setRating(value || "")}>
                <SelectTrigger><SelectValue placeholder="Rate" /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((item) => <SelectItem key={item} value={String(item)}>{item} stars</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="CV">
              {application.resume_url ? (
                resumeUrl ? (
                  <Button variant="outline" render={<a href={resumeUrl} target="_blank" rel="noreferrer" />}>
                    Open CV
                  </Button>
                ) : (
                  <div className="flex h-9 items-center text-sm text-gray-500">Preparing CV...</div>
                )
              ) : (
                <div className="flex h-9 items-center text-sm text-gray-500">No CV</div>
              )}
            </Field>
          </div>
          <Field label="Cover letter">
            <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
              {String(application.cover_letter || "No cover letter provided.")}
            </div>
          </Field>
          <div className="rounded-md border p-4">
            <p className="mb-3 font-medium">Form answers</p>
            {Object.keys(answers).length === 0 ? (
              <p className="text-sm text-gray-500">No custom answers.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(answers).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-xs font-medium text-gray-500">{key}</p>
                    <p className="text-sm text-gray-900">{String(value || "-")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="Recruiter notes">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave} disabled={saving}>
            <Star className="h-4 w-4 ml-2" />
            {saving ? "Saving..." : "Save review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
