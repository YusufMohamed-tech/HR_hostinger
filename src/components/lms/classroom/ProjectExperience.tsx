"use client";

import React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  ListChecks,
  MessageSquare,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClassroomProject, submitClassroomProject, updateWorkspaceState } from "@/lib/services/learn";
import { L, N, R, S, Spinner, StatusPill, formatDate, useClassroomContext } from "./shared";

const submissionLabels: Record<string, { label: string; className: string }> = {
  submitted: { label: "قيد المراجعة", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  late: { label: "مُرسل متأخر", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  reviewed: { label: "تمت المراجعة", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  accepted: { label: "مقبول", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "مرفوض", className: "bg-destructive/10 text-destructive" },
  needs_revision: { label: "يحتاج مراجعة", className: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
};

export function ProjectExperience({ enrollmentId, taskId }: { enrollmentId: string; taskId: string }) {
  const classroom = useClassroomContext();
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [answerText, setAnswerText] = React.useState("");
  const [answerUrl, setAnswerUrl] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const response = await getClassroomProject(enrollmentId, taskId);
    if (response.error) {
      setError(response.error.message);
      setData(null);
    } else {
      setData(response.data);
      const submission = R(R(response.data).submission);
      setAnswerText(S(submission.submission_text));
      setAnswerUrl(S(submission.submission_url));
      setError(null);
    }
    setLoading(false);
  }, [enrollmentId, taskId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    updateWorkspaceState(enrollmentId, { last_task_id: taskId, last_route: `/learn/${enrollmentId}/project/${taskId}`, current_tab: "project" }).catch(() => null);
  }, [enrollmentId, taskId]);

  if (loading && !data) return <Spinner label="جار تحميل المشروع..." />;
  if (error) return <p className="py-10 text-center text-sm text-muted-foreground">{error}</p>;
  if (!data) return null;

  const project = R(data.project);
  const rubric = R(data.rubric);
  const rubricItems = L(rubric.items);
  const submission = R(data.submission);
  const latestReview = R(data.latestReview);
  const reviewItems = L(data.reviewItems);
  const status = S(submission.status);
  const statusMeta = submissionLabels[status];
  const canSubmit = !submission.id || (project.allow_resubmission !== false && ["needs_revision", "rejected"].includes(status));

  const submit = async () => {
    if (!answerText.trim() && !answerUrl.trim()) return;
    setSubmitting(true);
    const response = await submitClassroomProject(enrollmentId, taskId, {
      submission_text: answerText.trim() || undefined,
      submission_url: answerUrl.trim() || undefined,
    });
    setSubmitting(false);
    if (!response.error) {
      await load();
      classroom.refetch();
    } else {
      setError(response.error.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* Overview */}
      <section className="rounded-2xl border border-border bg-gradient-to-l from-primary/10 via-card to-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ClipboardList className="h-5 w-5" /></span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">مشروع</span>
          {statusMeta ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>{statusMeta.label}</span> : null}
        </div>
        <h1 className="text-xl font-bold">{S(project.title)}</h1>
        {S(project.description) ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{S(project.description)}</p> : null}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {S(project.due_date) ? <span>الموعد النهائي: {formatDate(project.due_date)}</span> : null}
          {N(project.estimated_minutes) > 0 ? <span>الوقت المقدر: {N(project.estimated_minutes)} دقيقة</span> : null}
          <span>{project.is_required !== false ? "مطلوب للإكمال" : "اختياري"}</span>
        </div>
      </section>

      {S(project.why_it_matters) ? (
        <div className="flex gap-3 rounded-xl border border-border bg-card p-4">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">لماذا هذا المشروع مهم</p>
            <p className="mt-1 text-sm text-muted-foreground">{S(project.why_it_matters)}</p>
          </div>
        </div>
      ) : null}

      {/* Instructions */}
      {S(project.instructions) ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> التعليمات</h2>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-muted-foreground dark:prose-invert">{S(project.instructions)}</div>
        </div>
      ) : null}

      {/* Rubric */}
      {rubricItems.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-primary" /> معايير التقييم</h2>
          <div className="space-y-2">
            {rubricItems.map((item, index) => (
              <div key={index} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{S(R(item).title)}</p>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{N(R(item).points)} نقطة</span>
                </div>
                {S(R(item).passing_criteria) ? <p className="mt-1 text-xs text-muted-foreground">{S(R(item).passing_criteria)}</p> : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">إجمالي النقاط: {N(rubric.total_points)} · درجة النجاح: {N(rubric.pass_points)}</p>
        </div>
      ) : null}

      {/* Review result */}
      {latestReview.id ? (
        <div className={`rounded-xl border p-5 ${Boolean(latestReview.passed) ? "border-emerald-500/30 bg-emerald-500/5" : "border-orange-500/30 bg-orange-500/5"}`}>
          <div className="mb-2 flex items-center gap-2">
            {Boolean(latestReview.passed) ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <XCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
            <h2 className="text-sm font-semibold">نتيجة المراجعة: {N(latestReview.score)} نقطة</h2>
          </div>
          {S(latestReview.feedback) ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><MessageSquare className="mt-0.5 h-4 w-4 shrink-0" /> {S(latestReview.feedback)}</p>
          ) : null}
          {reviewItems.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {reviewItems.map((item, index) => (
                <div key={index} className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    {Boolean(R(item).passed) ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                    {S(R(item).feedback) || "معيار"}
                  </span>
                  <span className="font-semibold">{N(R(item).score)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Submission workspace */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-primary" /> تسليم المشروع</h2>
          {submission.id ? <StatusPill status={status === "accepted" ? "completed" : status === "needs_revision" || status === "rejected" ? "needs_revision" : status === "submitted" || status === "late" ? "submitted" : "in_review"} /> : null}
        </div>

        {canSubmit ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">إجابتك</label>
              <textarea
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
                placeholder="اكتب حل المشروع أو ملخص عملك..."
                className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Link2 className="h-3.5 w-3.5" /> رابط العمل (اختياري)</label>
              <input
                value={answerUrl}
                onChange={(event) => setAnswerUrl(event.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <Button onClick={submit} disabled={submitting || (!answerText.trim() && !answerUrl.trim())} className="gap-1.5">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submission.id ? "إعادة التسليم" : "تسليم للمراجعة"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {S(submission.submission_text) ? (
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">إجابتك المُرسلة</p>
                <p className="whitespace-pre-wrap text-sm">{S(submission.submission_text)}</p>
              </div>
            ) : null}
            {S(submission.submission_url) ? (
              <a href={S(submission.submission_url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4" /> {S(submission.submission_url)}
              </a>
            ) : null}
            <p className="text-xs text-muted-foreground">تم التسليم في {formatDate(submission.submitted_at)}. سيتم إشعارك عند اكتمال المراجعة.</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button asChild variant="ghost" size="sm"><Link href={`/learn/${enrollmentId}/syllabus`}>العودة للمنهج</Link></Button>
      </div>
    </div>
  );
}
