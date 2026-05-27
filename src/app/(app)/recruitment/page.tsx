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
  { value: "new", label: "جديد" },
  { value: "screening", label: "فرز أولي" },
  { value: "shortlisted", label: "قائمة مختصرة" },
  { value: "interview", label: "مقابلة" },
  { value: "technical_test", label: "اختبار فني" },
  { value: "offer", label: "عرض وظيفي" },
  { value: "hired", label: "تم التعيين" },
  { value: "rejected", label: "مرفوض" },
];

const MESSAGE_TEMPLATES = [
  {
    key: "received",
    label: "استلام الطلب",
    subject: "تم استلام طلبك",
    body: "مرحبا {{name}}،\n\nشكرا لتقديمك على وظيفة {{job}}. سيقوم فريق التوظيف بمراجعة طلبك وتحديث حالته داخل المنصة.",
  },
  {
    key: "interview",
    label: "دعوة مقابلة",
    subject: "دعوة للمقابلة",
    body: "مرحبا {{name}}،\n\nنرغب في دعوتك لمقابلة بخصوص وظيفة {{job}}. يرجى مشاركة الأوقات المناسبة لك.",
  },
  {
    key: "test",
    label: "طلب اختبار فني",
    subject: "اختبار فني",
    body: "مرحبا {{name}}،\n\nتم نقلك إلى مرحلة الاختبار الفني لوظيفة {{job}}. يرجى متابعة التعليمات داخل المنصة.",
  },
  {
    key: "rejection",
    label: "رسالة اعتذار",
    subject: "تحديث على طلبك",
    body: "مرحبا {{name}}،\n\nشكرا لاهتمامك بوظيفة {{job}}. بعد المراجعة لن نكمل في هذه المرحلة، ونقدر وقتك واهتمامك.",
  },
  {
    key: "offer",
    label: "رسالة عرض",
    subject: "تحديث العرض الوظيفي",
    body: "مرحبا {{name}}،\n\nيسعدنا إبلاغك بالانتقال للخطوات التالية في طلبك على وظيفة {{job}}.",
  },
  {
    key: "more_info",
    label: "طلب معلومات إضافية",
    subject: "مطلوب معلومات إضافية",
    body: "مرحبا {{name}}،\n\nيرجى إضافة معلومات أكثر عن خبرتك المرتبطة بوظيفة {{job}}.",
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">لوحة التوظيف</h1>
          <p className="text-sm text-gray-500">إدارة روابط الوظائف، تقييم المرشحين، نقل المراحل، ومتابعة رسائل المرشحين داخل المنصة.</p>
        </div>
        {canManageRecruitment && (
          <CreateJobDialog departments={departments} locations={locations} onSuccess={loadRecruitment} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="الوظائف المنشورة" value={String(activeJobs)} />
        <MetricCard label="طلبات التقديم" value={String(applications.length)} />
        <MetricCard label="متوسط المطابقة" value={`${averageScore(scoredApplications.map((item) => item.score.score))}%`} />
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
              ترتيب المرشحين
            </CardTitle>
            <Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(value || "all")}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوظائف</SelectItem>
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
                <SelectItem value="newest">الأحدث</SelectItem>
                <SelectItem value="score">أعلى مطابقة</SelectItem>
                <SelectItem value="experience">الأكثر خبرة</SelectItem>
                <SelectItem value="salary">الراتب المتوقع</SelectItem>
                <SelectItem value="status">الحالة</SelectItem>
                <SelectItem value="source">مصدر الطلب</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {PIPELINE.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="مهارة" value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} />
            <Input placeholder="مدينة" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} />
            <Input placeholder="تعليم" value={educationFilter} onChange={(event) => setEducationFilter(event.target.value)} />
            <Input placeholder="أقصى راتب" type="number" value={salaryFilter} onChange={(event) => setSalaryFilter(event.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <EmptyRow text="جاري تحميل الطلبات..." />
          ) : visibleApplications.length === 0 ? (
            <EmptyRow text="لا يوجد مرشحون مطابقون للفلاتر." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المرشح</TableHead>
                  <TableHead>المطابقة</TableHead>
                  <TableHead>المؤشرات</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المراجعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleApplications.map(({ application, score }) => {
                  const job = selectedJob || ((application.job ?? null) as Record<string, unknown> | null);
                  return (
                    <TableRow key={String(application.id)}>
                      <TableCell>
                        <div className="font-medium">{String(application.candidate_name || "مرشح")}</div>
                        <div className="text-xs text-gray-500">{String(application.email || "")}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-lg font-semibold text-brand-dark">{score.score}%</div>
                        <div className="text-xs text-gray-500">{score.years || 0} سنة خبرة</div>
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
          لوحة الوظائف
        </CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <EmptyRow text="لا توجد وظائف حتى الآن. أنشئ أول إعلان لتوليد رابط التقديم." />
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
                      <p className="font-semibold text-gray-900">{String(job.title || "بدون عنوان")}</p>
                      <p className="text-xs text-gray-500">المصدر: رابط عام - متبقي {daysRemaining(job.application_deadline)} يوم</p>
                    </div>
                    <StatusBadge status={String(job.status || "open")} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <MiniStat label="الطلبات" value={String(scopedApps.length)} />
                    <MiniStat label="جديد" value={String(countByStatus(scopedApps, "new"))} />
                    <MiniStat label="مختصر" value={String(countByStatus(scopedApps, "shortlisted"))} />
                    <MiniStat label="مقابلات" value={String(countByStatus(scopedApps, "interview"))} />
                    <MiniStat label="مرفوض" value={String(countByStatus(scopedApps, "rejected"))} />
                    <MiniStat label="المتوسط" value={`${averageScore(scores)}%`} />
                    <MiniStat label="المصدر" value="رابط" />
                    <MiniStat label="الموعد" value={`${daysRemaining(job.application_deadline)}ي`} />
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
        <CardTitle>مسار المرشحين</CardTitle>
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
                      <p className="text-sm font-medium text-gray-900">{String(application.candidate_name || "مرشح")}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{score.score}%</Badge>
                        <span className="text-xs text-gray-500">{score.skills.slice(0, 2).join(", ") || "لا توجد مهارات"}</span>
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
  if (items.length === 0) return <span className="text-xs text-gray-500">لا توجد مؤشرات</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => {
        const isRisk = item.startsWith("Missing") || item.includes("above") || item.includes("Incomplete") || item.includes("غير") || item.includes("أعلى") || item.includes("أقل");
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
    { id: crypto.randomUUID(), label: "سنوات الخبرة", type: "number", required: true },
    { id: crypto.randomUUID(), label: "الراتب المتوقع", type: "number", required: false },
    { id: crypto.randomUUID(), label: "مدة الإشعار", type: "text", required: false },
    { id: crypto.randomUUID(), label: "رابط الأعمال", type: "text", required: false },
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
      setError("عنوان الوظيفة مطلوب.");
      return;
    }
    if (!form.application_deadline) {
      setError("تاريخ نهاية التقديم مطلوب.");
      return;
    }
    if (new Date(form.application_deadline) < new Date(new Date().toISOString().slice(0, 10))) {
      setError("تاريخ نهاية التقديم يجب أن يكون اليوم أو تاريخا مستقبليا.");
      return;
    }
    if (!form.requirements.trim()) {
      setError("المهارات أو المتطلبات مطلوبة لحساب المطابقة.");
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
        <Plus className="h-4 w-4 ml-2" /> إنشاء إعلان وظيفة
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>إنشاء إعلان وظيفة</DialogTitle>
          <DialogDescription>حدد بيانات الوظيفة، آخر موعد للتقديم، وأسئلة نموذج المرشح.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto py-4 pr-1">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="عنوان الوظيفة"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
            <Field label="الحالة">
              <Select value={form.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">منشور</SelectItem>
                  <SelectItem value="open">مفتوح</SelectItem>
                  <SelectItem value="draft">مسودة</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="القسم">
              <Select value={form.department_id} onValueChange={(value) => set("department_id", value)}>
                <SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger>
                <SelectContent>
                  {departments.map((department) => <SelectItem key={String(department.id)} value={String(department.id)}>{String(department.name || "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الموقع">
              <Select value={form.location_id} onValueChange={(value) => set("location_id", value)}>
                <SelectTrigger><SelectValue placeholder="اختر الموقع" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => <SelectItem key={String(location.id)} value={String(location.id)}>{String(location.name || "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع التوظيف"><Input value={form.employment_type} onChange={(event) => set("employment_type", event.target.value)} /></Field>
            <Field label="الخبرة المطلوبة"><Input value={form.experience_level} onChange={(event) => set("experience_level", event.target.value)} placeholder="مثال: 3 سنوات" /></Field>
            <Field label="نطاق الراتب"><Input value={form.salary_range} onChange={(event) => set("salary_range", event.target.value)} placeholder="مثال: 8000-12000" /></Field>
            <Field label="آخر موعد للتقديم"><Input type="date" value={form.application_deadline} onChange={(event) => set("application_deadline", event.target.value)} /></Field>
          </div>
          <Field label="وصف الوظيفة"><Input value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
          <Field label="المتطلبات / المهارات المطلوبة"><Input value={form.requirements} onChange={(event) => set("requirements", event.target.value)} placeholder="React, TypeScript, 3 years experience..." /></Field>

          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium">أسئلة نموذج التقديم</p>
                <p className="text-xs text-gray-500">هذه الحقول تغذي التقييم والفلاتر والمؤشرات وملف المرشح.</p>
              </div>
              <Button variant="outline" size="sm" onClick={addQuestion}>إضافة سؤال</Button>
            </div>
            <div className="space-y-3">
              {questions.map((question, index) => (
                <div key={question.id} className="grid gap-2 rounded-md bg-gray-50 p-3 md:grid-cols-[1fr_140px_100px]">
                  <Input placeholder={`سؤال ${index + 1}`} value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} />
                  <Select value={question.type} onValueChange={(value) => updateQuestion(question.id, { type: value as FormQuestion["type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">نص</SelectItem>
                      <SelectItem value="textarea">نص طويل</SelectItem>
                      <SelectItem value="number">رقم</SelectItem>
                      <SelectItem value="date">تاريخ</SelectItem>
                      <SelectItem value="select">اختيارات</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />
                    مطلوب
                  </label>
                  {question.type === "select" && (
                    <Input className="md:col-span-3" placeholder="اختيارات مفصولة بفواصل" value={question.options || ""} onChange={(event) => updateQuestion(question.id, { options: event.target.value })} />
                  )}
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            <Save className="h-4 w-4 ml-2" />
            {submitting ? "جاري الإنشاء..." : "إنشاء وتوليد الرابط"}
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
  const storedSkills = Array.isArray(application.extracted_skills) ? application.extracted_skills.map(String) : [];
  const storedHighlights = Array.isArray(application.highlights) ? application.highlights.map(String) : [];
  const storedRedFlags = Array.isArray(application.red_flags) ? application.red_flags.map(String) : [];
  const storedScore = Number(application.match_score || 0);
  const text = [
    application.cover_letter,
    ...Object.values(answers),
  ].map(String).join(" ").toLowerCase();
  const requirements = String(job?.requirements || "").toLowerCase();
  const requiredSkills = SKILL_KEYWORDS.filter((skill) => requirements.includes(skill.toLowerCase()));
  const candidateSkills = Array.from(new Set([
    ...storedSkills,
    ...SKILL_KEYWORDS.filter((skill) => text.includes(skill.toLowerCase()) || requirements.includes(skill.toLowerCase()) && text.includes(skill.split(".")[0].toLowerCase())),
  ]));
  const missing = requiredSkills.filter((skill) => !candidateSkills.includes(skill));
  const years = extractNumberByKeys(answers, ["experience", "years", "خبرة", "سنوات"]);
  const minYears = extractNumber(String(job?.experience_level || job?.requirements || ""));
  const salaryExpectation = extractNumberByKeys(answers, ["salary", "expected", "راتب"]);
  const salaryRange = extractSalaryRange(String(job?.salary_range || ""));
  const noticePeriod = findAnswerByKeys(answers, ["notice", "إشعار"]);
  const education = findAnswerByKeys(answers, ["education", "degree", "university", "تعليم", "جامعة"]);
  const portfolio = findAnswerByKeys(answers, ["portfolio", "github", "behance", "linkedin", "أعمال"]);
  const location = findAnswerByKeys(answers, ["location", "city", "مدينة", "موقع"]);

  let score = storedScore || 20;
  const highlights: string[] = [...storedHighlights];
  const redFlags: string[] = [...storedRedFlags];

  if (requiredSkills.length) {
    score += Math.round((candidateSkills.filter((skill) => requiredSkills.includes(skill)).length / requiredSkills.length) * 35);
  }
  if (years && minYears && years >= minYears) {
    score += 20;
    highlights.push(`خبرة ${years} سنوات`);
  } else if (minYears && years < minYears) {
    redFlags.push(`الخبرة أقل من المطلوب (${minYears}+ سنوات)`);
  }
  if (salaryExpectation && salaryRange.max && salaryExpectation <= salaryRange.max) {
    score += 10;
  } else if (salaryExpectation && salaryRange.max && salaryExpectation > salaryRange.max) {
    redFlags.push("الراتب المتوقع أعلى من الميزانية");
  }
  if (location && String(job?.location || "").toLowerCase().includes(location.toLowerCase())) score += 10;
  if (noticePeriod && /immediate|now|available|0|فور/i.test(noticePeriod)) {
    score += 5;
    highlights.push("متاح فورا");
  }
  if (portfolio) {
    score += 5;
    highlights.push("يوجد رابط أعمال قوي");
  }
  if (!application.resume_url) redFlags.push("الطلب غير مكتمل: السيرة الذاتية غير مرفقة");
  missing.slice(0, 3).forEach((skill) => redFlags.push(`مهارة مطلوبة غير موجودة: ${skill}`));
  candidateSkills.slice(0, 4).forEach((skill) => highlights.push(`مطابقة قوية: ${skill}`));

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
