"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  Mail,
  Plus,
  Save,
  Star,
} from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  createJobPosting,
  createRecruitmentMessage,
  getJobApplications,
  getJobPostings,
  getRecruitmentMessages,
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

type CandidateScore = {
  score: number;
  skills: string[];
  missing: string[];
  highlights: string[];
  redFlags: string[];
  years: number;
  salaryExpectation?: number;
  noticePeriod?: string;
  education?: string;
  portfolio?: string;
  location?: string;
};

const PIPELINE = [
  { value: "new", label: "New" },
  { value: "screening", label: "Screening" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "interview", label: "Interview" },
  { value: "technical_test", label: "Technical Test" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

const MESSAGE_TEMPLATES = [
  {
    key: "received",
    label: "Application received",
    subject: "Application received",
    body: "Hi {{name}},\n\nThank you for applying for the {{job}} position. Our recruitment team will review your application and update you soon.",
  },
  {
    key: "interview",
    label: "Interview invitation",
    subject: "Interview invitation",
    body: "Hi {{name}},\n\nThank you for applying for the {{job}} position. We would like to invite you to an interview next week.",
  },
  {
    key: "test",
    label: "Technical test request",
    subject: "Technical test request",
    body: "Hi {{name}},\n\nWe would like to move you to the technical test stage for the {{job}} position. Please reply with your availability.",
  },
  {
    key: "rejection",
    label: "Rejection message",
    subject: "Application update",
    body: "Hi {{name}},\n\nThank you for your interest in {{job}}. After review, we will not move forward at this stage. We appreciate your time.",
  },
  {
    key: "offer",
    label: "Offer message",
    subject: "Offer update",
    body: "Hi {{name}},\n\nWe are pleased to move forward with your application for {{job}}. Our team will contact you with next steps.",
  },
  {
    key: "more_info",
    label: "Request more information",
    subject: "More information requested",
    body: "Hi {{name}},\n\nCould you please share more information about your experience related to the {{job}} position?",
  },
];

const SKILL_KEYWORDS = [
  "React", "TypeScript", "JavaScript", "Next.js", "Node.js", "GraphQL", "SQL", "PostgreSQL",
  "Supabase", "Tailwind", "CSS", "HTML", "Python", "Excel", "Payroll", "Recruitment", "HR",
  "Arabic", "English", "Sales", "Training", "Operations", "Leadership",
];

export default function RecruitmentPage() {
  const { currentUser } = useRoleContext();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("all");
  const [sortBy, setSortBy] = useState("newest");
  const [statusFilter, setStatusFilter] = useState("all");
  const [skillFilter, setSkillFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [educationFilter, setEducationFilter] = useState("");
  const [salaryFilter, setSalaryFilter] = useState("");
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

  const publicOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const selectedJob = selectedJobId === "all" ? null : jobs.find((job) => String(job.id) === selectedJobId) || null;

  const scoredApplications = useMemo(() => {
    return applications.map((application) => {
      const job = selectedJob || ((application.job ?? null) as Record<string, unknown> | null);
      return {
        application,
        score: scoreCandidate(application, job),
      };
    });
  }, [applications, selectedJob]);

  const visibleApplications = useMemo(() => {
    const salaryMax = Number(salaryFilter || 0);
    return scoredApplications
      .filter(({ application }) => statusFilter === "all" || String(application.status || "new") === statusFilter)
      .filter(({ score }) => !skillFilter.trim() || score.skills.some((skill) => skill.toLowerCase().includes(skillFilter.toLowerCase())))
      .filter(({ score }) => !locationFilter.trim() || String(score.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
      .filter(({ score }) => !educationFilter.trim() || String(score.education || "").toLowerCase().includes(educationFilter.toLowerCase()))
      .filter(({ score }) => !salaryMax || !score.salaryExpectation || score.salaryExpectation <= salaryMax)
      .sort((a, b) => {
        if (sortBy === "score") return b.score.score - a.score.score;
        if (sortBy === "experience") return b.score.years - a.score.years;
        if (sortBy === "salary") return (a.score.salaryExpectation || 0) - (b.score.salaryExpectation || 0);
        if (sortBy === "status") return String(a.application.status || "").localeCompare(String(b.application.status || ""));
        if (sortBy === "source") return String(a.application.source || "").localeCompare(String(b.application.source || ""));
        return new Date(String(b.application.applied_at || "")).getTime() - new Date(String(a.application.applied_at || "")).getTime();
      });
  }, [educationFilter, salaryFilter, scoredApplications, skillFilter, sortBy, statusFilter, locationFilter]);

  const activeJobs = jobs.filter((job) => ["open", "published"].includes(String(job.status || ""))).length;

  const moveCandidate = async (application: Record<string, unknown>, status: string) => {
    const history = Array.isArray(application.status_history) ? application.status_history : [];
    await updateJobApplication(String(application.id), {
      status,
      status_history: [
        ...history,
        { status, at: new Date().toISOString(), by: currentUser?.id || null },
      ],
    });
    await loadRecruitment();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Recruiter Dashboard</h1>
          <p className="text-sm text-gray-500">Manage job links, score candidates, move pipeline stages, and message applicants.</p>
        </div>
        {canManageRecruitment && (
          <CreateJobDialog departments={departments} locations={locations} onSuccess={loadRecruitment} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Published jobs" value={String(activeJobs)} />
        <MetricCard label="Applications" value={String(applications.length)} />
        <MetricCard label="Average score" value={`${averageScore(scoredApplications.map((item) => item.score.score))}%`} />
      </div>

      <JobDashboard
        jobs={jobs}
        applications={applications}
        selectedJobId={selectedJobId}
        publicOrigin={publicOrigin}
        onSelect={setSelectedJobId}
      />

      <Card className="border-none shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-brand" />
              Candidate Ranking
            </CardTitle>
            <Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(value || "all")}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={String(job.id)} value={String(job.id)}>{String(job.title || "Untitled")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value || "newest")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="score">Highest match score</SelectItem>
                <SelectItem value="experience">Most experience</SelectItem>
                <SelectItem value="salary">Salary expectation</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="source">Application source</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PIPELINE.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Skill" value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} />
            <Input placeholder="Location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} />
            <Input placeholder="Education" value={educationFilter} onChange={(event) => setEducationFilter(event.target.value)} />
            <Input placeholder="Max salary" type="number" value={salaryFilter} onChange={(event) => setSalaryFilter(event.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <EmptyRow text="Loading applications..." />
          ) : visibleApplications.length === 0 ? (
            <EmptyRow text="No candidates match the selected filters." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Highlights</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleApplications.map(({ application, score }) => {
                  const job = selectedJob || ((application.job ?? null) as Record<string, unknown> | null);
                  return (
                    <TableRow key={String(application.id)}>
                      <TableCell>
                        <div className="font-medium">{String(application.candidate_name || "Candidate")}</div>
                        <div className="text-xs text-gray-500">{String(application.email || "")}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-lg font-semibold text-brand-dark">{score.score}%</div>
                        <div className="text-xs text-gray-500">{score.years || 0} yrs exp</div>
                      </TableCell>
                      <TableCell>
                        <SignalList score={score} compact />
                      </TableCell>
                      <TableCell><StatusBadge status={String(application.status || "new")} /></TableCell>
                      <TableCell>
                        <ApplicationReviewDialog
                          application={application}
                          job={job}
                          candidateScore={score}
                          onMove={moveCandidate}
                          onSuccess={loadRecruitment}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PipelineBoard
        applications={visibleApplications}
        onDropCandidate={moveCandidate}
        onOpenCandidate={(application) => {
          const target = document.querySelector<HTMLButtonElement>(`[data-review-id="${String(application.id)}"]`);
          target?.click();
        }}
      />
    </div>
  );
}

function JobDashboard({
  jobs,
  applications,
  selectedJobId,
  publicOrigin,
  onSelect,
}: {
  jobs: Record<string, unknown>[];
  applications: Record<string, unknown>[];
  selectedJobId: string;
  publicOrigin: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-brand" />
          Job Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <EmptyRow text="No jobs yet. Create the first posting to generate a public application link." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {jobs.map((job) => {
              const jobId = String(job.id || "");
              const scopedApps = applications.filter((app) => String(app.job_posting_id || "") === jobId);
              const link = `${publicOrigin}/apply/${jobId}`;
              const scores = scopedApps.map((application) => scoreCandidate(application, job).score);
              return (
                <button
                  key={jobId}
                  className={`rounded-lg border bg-white p-4 text-right transition hover:border-brand ${selectedJobId === jobId ? "border-brand ring-2 ring-brand/10" : ""}`}
                  onClick={() => onSelect(jobId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{String(job.title || "Untitled")}</p>
                      <p className="text-xs text-gray-500">Source: public link - {daysRemaining(job.application_deadline)} days remaining</p>
                    </div>
                    <StatusBadge status={String(job.status || "open")} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <MiniStat label="Applications" value={String(scopedApps.length)} />
                    <MiniStat label="New" value={String(countByStatus(scopedApps, "new"))} />
                    <MiniStat label="Shortlisted" value={String(countByStatus(scopedApps, "shortlisted"))} />
                    <MiniStat label="Interviews" value={String(countByStatus(scopedApps, "interview"))} />
                    <MiniStat label="Rejected" value={String(countByStatus(scopedApps, "rejected"))} />
                    <MiniStat label="Avg score" value={`${averageScore(scores)}%`} />
                    <MiniStat label="Source" value="Link" />
                    <MiniStat label="Deadline" value={`${daysRemaining(job.application_deadline)}d`} />
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
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
                    <Button variant="ghost" size="sm" render={<a href={link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} />}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineBoard({
  applications,
  onDropCandidate,
  onOpenCandidate,
}: {
  applications: { application: Record<string, unknown>; score: CandidateScore }[];
  onDropCandidate: (application: Record<string, unknown>, status: string) => Promise<void>;
  onOpenCandidate: (application: Record<string, unknown>) => void;
}) {
  const [draggedId, setDraggedId] = useState("");
  const dragged = applications.find((item) => String(item.application.id) === draggedId)?.application;

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>Candidate Pipeline Board</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-4 2xl:grid-cols-8">
          {PIPELINE.map((stage) => {
            const stageApps = applications.filter(({ application }) => String(application.status || "new") === stage.value);
            return (
              <div
                key={stage.value}
                className="min-h-72 rounded-lg border bg-gray-50 p-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={async () => {
                  if (dragged) await onDropCandidate(dragged, stage.value);
                  setDraggedId("");
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-medium text-gray-800">{stage.label}</p>
                  <Badge variant="outline">{stageApps.length}</Badge>
                </div>
                <div className="space-y-2">
                  {stageApps.map(({ application, score }) => (
                    <button
                      key={String(application.id)}
                      draggable
                      onDragStart={() => setDraggedId(String(application.id))}
                      onClick={() => onOpenCandidate(application)}
                      className="w-full rounded-md border bg-white p-3 text-right shadow-sm transition hover:border-brand"
                    >
                      <p className="text-sm font-medium text-gray-900">{String(application.candidate_name || "Candidate")}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{score.score}%</Badge>
                        <span className="text-xs text-gray-500">{score.skills.slice(0, 2).join(", ") || "No skills"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-2">
      <p className="font-semibold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
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
        : status === "interview" || status === "offer" || status === "technical_test" || status === "shortlisted"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-amber-50 text-amber-700 border-amber-200";
  return <Badge variant="outline" className={className}>{PIPELINE.find((item) => item.value === status)?.label || status}</Badge>;
}

function SignalList({ score, compact = false }: { score: CandidateScore; compact?: boolean }) {
  const items = [...score.highlights.slice(0, compact ? 2 : 4), ...score.redFlags.slice(0, compact ? 1 : 3)];
  if (items.length === 0) return <span className="text-xs text-gray-500">No signals</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => {
        const isRisk = item.startsWith("Missing") || item.includes("above") || item.includes("Incomplete");
        return (
          <Badge key={item} variant="outline" className={isRisk ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}>
            {isRisk ? <AlertTriangle className="ml-1 h-3 w-3" /> : <CheckCircle2 className="ml-1 h-3 w-3" />}
            {item}
          </Badge>
        );
      })}
    </div>
  );
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
    { id: crypto.randomUUID(), label: "Years of experience", type: "number", required: true },
    { id: crypto.randomUUID(), label: "Expected salary", type: "number", required: false },
    { id: crypto.randomUUID(), label: "Notice period", type: "text", required: false },
    { id: crypto.randomUUID(), label: "Portfolio link", type: "text", required: false },
  ]);
  const [form, setForm] = useState({
    title: "",
    department_id: "",
    location_id: "",
    employment_type: "full_time",
    experience_level: "",
    salary_range: "",
    application_deadline: "",
    description: "",
    requirements: "",
    status: "published",
  });

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value || "" }));

  const addQuestion = () => {
    setQuestions((prev) => [...prev, { id: crypto.randomUUID(), label: "", type: "text", required: false }]);
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
      .map((question) => ({ ...question, label: question.label.trim(), options: question.options?.trim() || undefined }));

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
      application_deadline: form.application_deadline || undefined,
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
      application_deadline: "",
      description: "",
      requirements: "",
      status: "published",
    });
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
          <DialogDescription>Define the job details, deadline, and application questions.</DialogDescription>
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
                  {departments.map((department) => <SelectItem key={String(department.id)} value={String(department.id)}>{String(department.name || "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Location">
              <Select value={form.location_id} onValueChange={(value) => set("location_id", value)}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => <SelectItem key={String(location.id)} value={String(location.id)}>{String(location.name || "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Employment type"><Input value={form.employment_type} onChange={(event) => set("employment_type", event.target.value)} /></Field>
            <Field label="Minimum experience"><Input value={form.experience_level} onChange={(event) => set("experience_level", event.target.value)} placeholder="Example: 3 years" /></Field>
            <Field label="Salary range"><Input value={form.salary_range} onChange={(event) => set("salary_range", event.target.value)} placeholder="Example: 8000-12000" /></Field>
            <Field label="Application deadline"><Input type="date" value={form.application_deadline} onChange={(event) => set("application_deadline", event.target.value)} /></Field>
          </div>
          <Field label="Job description"><Input value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
          <Field label="Requirements / required skills"><Input value={form.requirements} onChange={(event) => set("requirements", event.target.value)} placeholder="React, TypeScript, 3 years experience..." /></Field>

          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium">Application form questions</p>
                <p className="text-xs text-gray-500">These fields feed scoring, filters, highlights, and candidate profiles.</p>
              </div>
              <Button variant="outline" size="sm" onClick={addQuestion}>Add question</Button>
            </div>
            <div className="space-y-3">
              {questions.map((question, index) => (
                <div key={question.id} className="grid gap-2 rounded-md bg-gray-50 p-3 md:grid-cols-[1fr_140px_100px]">
                  <Input placeholder={`Question ${index + 1}`} value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} />
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
                    <input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />
                    Required
                  </label>
                  {question.type === "select" && (
                    <Input className="md:col-span-3" placeholder="Comma-separated options" value={question.options || ""} onChange={(event) => updateQuestion(question.id, { options: event.target.value })} />
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

function ApplicationReviewDialog({
  application,
  job,
  candidateScore,
  onMove,
  onSuccess,
}: {
  application: Record<string, unknown>;
  job: Record<string, unknown> | null;
  candidateScore: CandidateScore;
  onMove: (application: Record<string, unknown>, status: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumeUrl, setResumeUrl] = useState("");
  const [status, setStatus] = useState(String(application.status || "new"));
  const [rating, setRating] = useState(String(application.rating || ""));
  const [notes, setNotes] = useState(String(application.notes || ""));
  const [messageTemplate, setMessageTemplate] = useState("received");
  const [messageBody, setMessageBody] = useState("");
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const [cvSearch, setCvSearch] = useState("");
  const answers = useMemo(() => (application.application_answers ?? {}) as Record<string, unknown>, [application.application_answers]);
  const history = Array.isArray(application.status_history) ? application.status_history as Record<string, unknown>[] : [];

  useEffect(() => {
    async function loadResumeUrl() {
      const resumePath = typeof application.resume_url === "string" ? application.resume_url : "";
      if (!open || !resumePath) return;
      const { data } = await getRecruitmentResumeUrl(resumePath);
      setResumeUrl(data?.signedUrl || "");
    }
    async function loadMessages() {
      if (!open) return;
      const { data } = await getRecruitmentMessages(String(application.id));
      setMessages(data || []);
    }
    loadResumeUrl();
    loadMessages();
  }, [application.id, application.resume_url, open]);

  useEffect(() => {
    const template = MESSAGE_TEMPLATES.find((item) => item.key === messageTemplate) || MESSAGE_TEMPLATES[0];
    setMessageBody(renderMessage(template.body, application, job));
  }, [application, job, messageTemplate]);

  const handleSave = async () => {
    setSaving(true);
    await updateJobApplication(String(application.id), {
      status,
      rating: rating ? Number(rating) : undefined,
      notes: notes.trim() || undefined,
      status_history: [
        ...history,
        { status, at: new Date().toISOString(), by: currentUser?.id || null },
      ],
    });
    setSaving(false);
    setOpen(false);
    onSuccess();
  };

  const sendMessage = async () => {
    const template = MESSAGE_TEMPLATES.find((item) => item.key === messageTemplate) || MESSAGE_TEMPLATES[0];
    await createRecruitmentMessage({
      org_id: application.org_id,
      job_application_id: application.id,
      sender_user_id: currentUser?.id,
      candidate_user_id: application.candidate_user_id || undefined,
      template_key: template.key,
      subject: renderMessage(template.subject, application, job),
      body: messageBody,
    });
    const { data } = await getRecruitmentMessages(String(application.id));
    setMessages(data || []);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-review-id={String(application.id)} variant="outline" size="sm" />}>Open</DialogTrigger>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{String(application.candidate_name || "Candidate")}</DialogTitle>
          <DialogDescription>{String(application.email || "")} {application.phone ? `- ${String(application.phone)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[74vh] gap-4 overflow-y-auto py-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Match Score" value={`${candidateScore.score}%`} />
              <MetricCard label="Experience" value={`${candidateScore.years || 0} yrs`} />
              <MetricCard label="Rating" value={rating ? `${rating}/5` : "-"} />
              <MetricCard label="Source" value={String(application.source || "public_link")} />
            </div>

            <Card>
              <CardHeader><CardTitle>Candidate Profile</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-2">
                  <ProfileLine label="Name" value={String(application.candidate_name || "-")} />
                  <ProfileLine label="Contact" value={`${String(application.email || "-")} ${application.phone ? `- ${String(application.phone)}` : ""}`} />
                  <ProfileLine label="Education" value={candidateScore.education || "-"} />
                  <ProfileLine label="Portfolio" value={candidateScore.portfolio || "-"} />
                  <ProfileLine label="Expected salary" value={candidateScore.salaryExpectation ? String(candidateScore.salaryExpectation) : "-"} />
                  <ProfileLine label="Notice period" value={candidateScore.noticePeriod || "-"} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Parsed skills</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {candidateScore.skills.length ? candidateScore.skills.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>) : <span className="text-gray-500">No parsed skills</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Highlights and red flags</p>
                  <div className="mt-2"><SignalList score={candidateScore} /></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Application Answers</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(answers).length === 0 ? (
                  <p className="text-sm text-gray-500">No custom answers.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(answers).map(([key, value]) => (
                      <div key={key} className="rounded-md bg-gray-50 p-3">
                        <p className="text-xs font-medium text-gray-500">{key}</p>
                        <p className="text-sm text-gray-900">{String(value || "-")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Status History</CardTitle></CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-sm text-gray-500">No status history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {history.slice().reverse().map((item, index) => (
                      <div key={`${String(item.status)}-${index}`} className="flex items-center justify-between rounded-md bg-gray-50 p-2 text-sm">
                        <StatusBadge status={String(item.status || "")} />
                        <span className="text-xs text-gray-500">{formatDate(item.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => onMove(application, "shortlisted")}>Shortlist</Button>
                  <Button variant="outline" onClick={() => onMove(application, "rejected")}>Reject</Button>
                  <Button variant="outline" onClick={() => onMove(application, "interview")}>Move to interview</Button>
                  <Button variant="outline" onClick={() => onMove(application, "technical_test")}>Technical test</Button>
                </div>
                <Field label="Assign to another recruiter">
                  <Input placeholder="Recruiter email or name" />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>CV Preview</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="Search inside CV" value={cvSearch} onChange={(event) => setCvSearch(event.target.value)} />
                  {resumeUrl && (
                    <Button variant="outline" render={<a href={resumeUrl} target="_blank" rel="noreferrer" />}>
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {cvSearch && <p className="text-xs text-gray-500">Use the browser PDF search for <span className="font-medium">{cvSearch}</span> inside the preview.</p>}
                {resumeUrl ? (
                  <iframe src={resumeUrl} className="h-72 w-full rounded-md border" title="CV preview" />
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-md border text-sm text-gray-500">No CV uploaded</div>
                )}
                <div className="rounded-md bg-gray-50 p-3 text-sm">
                  <p className="font-medium">CV vs requirements</p>
                  <p className="text-gray-600">Strong: {candidateScore.skills.slice(0, 5).join(", ") || "-"}</p>
                  <p className="text-gray-600">Missing: {candidateScore.missing.join(", ") || "-"}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recruiter Review</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label="Status">
                  <Select value={status} onValueChange={(value) => setStatus(value || "new")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIPELINE.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
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
                <Field label="Internal notes">
                  <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Messages</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Select value={messageTemplate} onValueChange={(value) => setMessageTemplate(value || "received")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MESSAGE_TEMPLATES.map((template) => <SelectItem key={template.key} value={template.key}>{template.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <textarea className="min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} />
                <Button variant="outline" onClick={sendMessage}><Mail className="h-4 w-4 ml-2" />Send message</Button>
                <div className="space-y-2">
                  {messages.slice(0, 3).map((message) => (
                    <div key={String(message.id)} className="rounded-md bg-gray-50 p-2 text-xs text-gray-600">
                      <p className="font-medium text-gray-800">{String(message.subject || "")}</p>
                      <p>{String(message.body || "").slice(0, 120)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
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

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  );
}

function scoreCandidate(application: Record<string, unknown>, job?: Record<string, unknown> | null): CandidateScore {
  const answers = (application.application_answers ?? {}) as Record<string, unknown>;
  const text = [
    application.cover_letter,
    ...Object.values(answers),
  ].map(String).join(" ").toLowerCase();
  const requirements = String(job?.requirements || "").toLowerCase();
  const requiredSkills = SKILL_KEYWORDS.filter((skill) => requirements.includes(skill.toLowerCase()));
  const candidateSkills = SKILL_KEYWORDS.filter((skill) => text.includes(skill.toLowerCase()) || requirements.includes(skill.toLowerCase()) && text.includes(skill.split(".")[0].toLowerCase()));
  const missing = requiredSkills.filter((skill) => !candidateSkills.includes(skill));
  const years = extractNumberByKeys(answers, ["experience", "years"]);
  const minYears = extractNumber(String(job?.experience_level || job?.requirements || ""));
  const salaryExpectation = extractNumberByKeys(answers, ["salary", "expected"]);
  const salaryRange = extractSalaryRange(String(job?.salary_range || ""));
  const noticePeriod = findAnswerByKeys(answers, ["notice"]);
  const education = findAnswerByKeys(answers, ["education", "degree", "university"]);
  const portfolio = findAnswerByKeys(answers, ["portfolio", "github", "behance", "linkedin"]);
  const location = findAnswerByKeys(answers, ["location", "city"]);

  let score = 20;
  const highlights: string[] = [];
  const redFlags: string[] = [];

  if (requiredSkills.length) {
    score += Math.round((candidateSkills.filter((skill) => requiredSkills.includes(skill)).length / requiredSkills.length) * 35);
  }
  if (years && minYears && years >= minYears) {
    score += 20;
    highlights.push(`Has ${years} years experience`);
  } else if (minYears && years < minYears) {
    redFlags.push(`Missing required experience (${minYears}+ years)`);
  }
  if (salaryExpectation && salaryRange.max && salaryExpectation <= salaryRange.max) {
    score += 10;
  } else if (salaryExpectation && salaryRange.max && salaryExpectation > salaryRange.max) {
    redFlags.push("Salary expectation is above budget");
  }
  if (location && String(job?.location || "").toLowerCase().includes(location.toLowerCase())) score += 10;
  if (noticePeriod && /immediate|now|available|0|فور/i.test(noticePeriod)) {
    score += 5;
    highlights.push("Available immediately");
  }
  if (portfolio) {
    score += 5;
    highlights.push("Strong portfolio link");
  }
  if (!application.resume_url) redFlags.push("Incomplete application: missing CV");
  missing.slice(0, 3).forEach((skill) => redFlags.push(`Missing required skill: ${skill}`));
  candidateSkills.slice(0, 4).forEach((skill) => highlights.push(`Strong match: ${skill}`));

  return {
    score: Math.max(0, Math.min(100, score)),
    skills: candidateSkills,
    missing,
    highlights: Array.from(new Set(highlights)),
    redFlags: Array.from(new Set(redFlags)),
    years,
    salaryExpectation: salaryExpectation || undefined,
    noticePeriod,
    education,
    portfolio,
    location,
  };
}

function extractNumberByKeys(answers: Record<string, unknown>, keys: string[]) {
  const entry = Object.entries(answers).find(([key]) => keys.some((needle) => key.toLowerCase().includes(needle)));
  return extractNumber(String(entry?.[1] || ""));
}

function findAnswerByKeys(answers: Record<string, unknown>, keys: string[]) {
  const entry = Object.entries(answers).find(([key]) => keys.some((needle) => key.toLowerCase().includes(needle)));
  return entry ? String(entry[1] || "") : "";
}

function extractNumber(text: string) {
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function extractSalaryRange(text: string) {
  const numbers = Array.from(text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)).map((match) => Number(match[0].replace(/,/g, "")));
  return { min: numbers[0] || 0, max: numbers[1] || numbers[0] || 0 };
}

function averageScore(scores: number[]) {
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function countByStatus(applications: Record<string, unknown>[], status: string) {
  return applications.filter((application) => String(application.status || "new") === status).length;
}

function daysRemaining(value: unknown) {
  if (!value) return 0;
  const diff = new Date(String(value)).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function formatDate(value: unknown) {
  if (!value) return "-";
  return new Date(String(value)).toLocaleString();
}

function renderMessage(template: string, application: Record<string, unknown>, job?: Record<string, unknown> | null) {
  return template
    .replaceAll("{{name}}", String(application.candidate_name || "there"))
    .replaceAll("{{job}}", String(job?.title || "the role"));
}
