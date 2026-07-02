"use client";

import React from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  RotateCcw,
  Trophy,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClassroomQuiz, submitClassroomQuiz, updateWorkspaceState } from "@/lib/services/learn";
import { L, N, R, S, Spinner, formatDate, useClassroomContext } from "./shared";

type AnswerMap = Record<string, string | string[]>;

export function QuizExperience({ enrollmentId, quizId }: { enrollmentId: string; quizId: string }) {
  const classroom = useClassroomContext();
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"intro" | "taking" | "result">("intro");
  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const response = await getClassroomQuiz(enrollmentId, quizId);
    if (response.error) {
      setError(response.error.message);
      setData(null);
    } else {
      setData(response.data);
      setError(null);
    }
    setLoading(false);
  }, [enrollmentId, quizId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    updateWorkspaceState(enrollmentId, { last_quiz_id: quizId, last_route: `/learn/${enrollmentId}/quiz/${quizId}`, current_tab: "quiz" }).catch(() => null);
  }, [enrollmentId, quizId]);

  if (loading && !data) return <Spinner label="جار تحميل الاختبار..." />;
  if (error) return <p className="py-10 text-center text-sm text-muted-foreground">{error}</p>;
  if (!data) return null;

  const quiz = R(data.quiz);
  const questions = L(data.questions);
  const attempts = L(data.attempts);
  const canRetake = Boolean(data.canRetake);
  const passed = Boolean(data.passed);

  const setAnswer = (questionId: string, value: string | string[]) => setAnswers((prev) => ({ ...prev, [questionId]: value }));

  const toggleMulti = (questionId: string, option: string) => {
    const current = Array.isArray(answers[questionId]) ? (answers[questionId] as string[]) : [];
    setAnswer(questionId, current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
  };

  const submit = async () => {
    setSubmitting(true);
    const response = await submitClassroomQuiz(enrollmentId, quizId, answers);
    setSubmitting(false);
    if (!response.error) {
      setResult(R(response.data).attempt as Record<string, unknown>);
      setMode("result");
      await load();
      classroom.refetch();
    } else {
      setError(response.error.message);
    }
  };

  const options = (question: Record<string, unknown>): string[] => {
    const raw = L<string>(question.options_json);
    if (raw.length > 0) return raw.map((option) => S(option));
    if (S(question.question_type) === "true_false") return ["صحيح", "خطأ"];
    return [];
  };

  if (mode === "result" && result) {
    const score = N(result.score);
    const didPass = Boolean(result.passed);
    return (
      <div className="mx-auto max-w-lg space-y-5 py-6 text-center">
        <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${didPass ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
          {didPass ? <Trophy className="h-9 w-9" /> : <XCircle className="h-9 w-9" />}
        </div>
        <div>
          <h1 className="text-xl font-bold">{didPass ? "أحسنت! لقد نجحت" : "لم تجتز الاختبار"}</h1>
          <p className="text-sm text-muted-foreground">نتيجتك: {score}% · درجة النجاح {N(quiz.passing_score)}%</p>
        </div>
        <div className="flex justify-center gap-2">
          {!didPass && canRetake ? (
            <Button onClick={() => { setMode("taking"); setAnswers({}); setResult(null); }} className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> إعادة المحاولة
            </Button>
          ) : null}
          <Button asChild variant="outline"><Link href={`/learn/${enrollmentId}/syllabus`}>العودة للمنهج</Link></Button>
        </div>
      </div>
    );
  }

  if (mode === "taking") {
    const allAnswered = questions.every((question) => {
      const value = answers[S(R(question).id)];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{S(quiz.title)}</h1>
          <span className="text-xs text-muted-foreground">{questions.length} سؤال</span>
        </div>
        <div className="space-y-4">
          {questions.map((question, index) => {
            const questionId = S(R(question).id);
            const type = S(R(question).question_type);
            const opts = options(R(question));
            return (
              <div key={questionId} className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 text-sm font-semibold">{index + 1}. {S(R(question).question_text)}</p>
                {type === "short_answer" ? (
                  <input
                    value={(answers[questionId] as string) || ""}
                    onChange={(event) => setAnswer(questionId, event.target.value)}
                    placeholder="اكتب إجابتك..."
                    className="w-full rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
                  />
                ) : (
                  <div className="space-y-2">
                    {opts.map((option) => {
                      const multi = type === "multiple_choice";
                      const selected = multi
                        ? Array.isArray(answers[questionId]) && (answers[questionId] as string[]).includes(option)
                        : answers[questionId] === option;
                      return (
                        <label
                          key={option}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <input
                            type={multi ? "checkbox" : "radio"}
                            name={questionId}
                            checked={selected}
                            onChange={() => (multi ? toggleMulti(questionId, option) : setAnswer(questionId, option))}
                            className="accent-primary"
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setMode("intro")}>إلغاء</Button>
          <Button onClick={submit} disabled={submitting || !allAnswered} className="gap-1.5">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            تسليم الاختبار
          </Button>
        </div>
      </div>
    );
  }

  // intro
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardCheck className="h-5 w-5" /></span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">اختبار</span>
          {passed ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> اجتزت</span>
          ) : null}
        </div>
        <h1 className="text-xl font-bold">{S(quiz.title)}</h1>
        {S(quiz.description) ? <p className="mt-1 text-sm text-muted-foreground">{S(quiz.description)}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="الأسئلة" value={`${N(quiz.question_count)}`} />
          <Stat label="درجة النجاح" value={`${N(quiz.passing_score)}%`} />
          <Stat label="المحاولات" value={`${N(data.attemptsUsed)}/${N(quiz.max_attempts)}`} />
          <Stat label="الوقت" value={quiz.time_limit_minutes ? `${N(quiz.time_limit_minutes)} د` : "غير محدد"} icon={quiz.time_limit_minutes ? Clock : undefined} />
        </div>
        <div className="mt-5">
          {canRetake ? (
            <Button onClick={() => { setMode("taking"); setAnswers({}); }} size="lg" className="gap-1.5">
              <ClipboardCheck className="h-5 w-5" /> {N(data.attemptsUsed) > 0 ? "محاولة جديدة" : "بدء الاختبار"}
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" /> استنفدت كل المحاولات المتاحة.
            </div>
          )}
        </div>
      </div>

      {attempts.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">سجل المحاولات</p>
          <ul className="space-y-2">
            {attempts.map((attempt, index) => (
              <li key={index} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span>المحاولة {N(R(attempt).attempt_number)}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{N(R(attempt).score)}%</span>
                  {Boolean(R(attempt).passed) ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-[11px] text-muted-foreground">{formatDate(R(attempt).submitted_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-sm font-bold">{Icon ? <Icon className="h-3.5 w-3.5" /> : null}{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
