"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, GraduationCap, ListChecks, PlayCircle, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LmsSyllabusItem, LmsSyllabusPart } from "@/types/lms";
import { L, R, S, StatusPill, itemHref, pct, useClassroomContext } from "./shared";

function partProgress(part: LmsSyllabusPart) {
  const items: LmsSyllabusItem[] = [...part.items];
  for (const mod of part.modules) items.push(...mod.items);
  const total = items.length;
  const done = items.filter((item) => item.status === "completed" || item.status === "passed").length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function ClassroomOverview() {
  const { enrollmentId, data } = useClassroomContext();
  if (!data) return null;
  const course = R(data.course);
  const enrollment = R(data.enrollment);
  const parts = (data.parts || []) as LmsSyllabusPart[];
  const nextAction = data.nextAction as LmsSyllabusItem | null;
  const outcomes = L<string>(course.learning_outcomes);
  const skills = L<string>(course.skills_gained);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-l from-primary/10 via-card to-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {S(course.experience_type) === "program" ? "برنامج تدريبي" : "دورة تدريبية"}
          </span>
        </div>
        <h1 className="text-xl font-bold md:text-2xl">{S(course.title)}</h1>
        {S(course.subtitle) ? <p className="mt-1 text-sm text-muted-foreground">{S(course.subtitle)}</p> : null}
        {S(course.description) ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{S(course.description)}</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {nextAction ? (
            <Button asChild size="lg" className="gap-2">
              <Link href={itemHref(enrollmentId, nextAction)}>
                <PlayCircle className="h-5 w-5" /> {pct(enrollment.progress_percent) > 0 ? "متابعة التعلم" : "ابدأ التعلم"}
              </Link>
            </Button>
          ) : (
            <Button asChild size="lg" variant="outline" className="gap-2">
              <Link href={`/learn/${enrollmentId}/certificate`}>
                <Target className="h-5 w-5" /> عرض الشهادة
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="lg" className="gap-2">
            <Link href={`/learn/${enrollmentId}/syllabus`}>
              <ListChecks className="h-5 w-5" /> عرض المنهج الكامل
            </Link>
          </Button>
        </div>
      </section>

      {/* Outcomes + skills */}
      {(outcomes.length > 0 || skills.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {outcomes.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Target className="h-4 w-4 text-primary" /> ماذا ستتعلم
              </h2>
              <ul className="space-y-2">
                {outcomes.map((outcome, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {outcome}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {skills.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> المهارات المكتسبة
              </h2>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill, index) => (
                  <span key={index} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Syllabus glance */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <BookOpen className="h-4 w-4" /> محتوى الدورة
        </h2>
        <div className="space-y-3">
          {parts.map((part) => {
            const progress = partProgress(part);
            const preview = part.items[0] || part.modules[0]?.items[0] || null;
            return (
              <div key={part.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{part.title}</p>
                    <p className="text-[11px] text-muted-foreground">{progress.done}/{progress.total} عنصر مكتمل</p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">{progress.percent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
                {preview ? (
                  <Link
                    href={itemHref(enrollmentId, preview)}
                    className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:border-primary/40"
                  >
                    <span className="truncate">{preview.title}</span>
                    <StatusPill status={preview.status} />
                  </Link>
                ) : null}
              </div>
            );
          })}
          {parts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
              لم تتم إضافة محتوى لهذه الدورة بعد.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function SyllabusView() {
  const { enrollmentId, data } = useClassroomContext();
  if (!data) return null;
  const parts = (data.parts || []) as LmsSyllabusPart[];

  const kindLabel = (kind: string) => (kind === "lesson" ? "درس" : kind === "quiz" ? "اختبار" : "مشروع");

  const renderItems = (items: LmsSyllabusItem[]) => (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <Link
            href={itemHref(enrollmentId, item)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{kindLabel(item.kind)}</span>
              <span className="truncate text-sm font-medium">{item.title}</span>
              {item.is_required ? null : <span className="text-[10px] text-muted-foreground">(اختياري)</span>}
            </div>
            <StatusPill status={item.status} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">المنهج الدراسي</h1>
        <p className="text-sm text-muted-foreground">مسار التعلم المنظّم لهذه الدورة</p>
      </div>
      {parts.map((part, partIndex) => (
        <section key={part.id} className="rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{partIndex + 1}</span>
            <div>
              <h2 className="text-sm font-semibold">{part.title}</h2>
              {part.description ? <p className="text-[11px] text-muted-foreground">{part.description}</p> : null}
            </div>
            {part.is_milestone ? (
              <span className="mr-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">مرحلة رئيسية</span>
            ) : null}
          </div>
          {part.items.length > 0 ? <div className="mb-3">{renderItems(part.items)}</div> : null}
          {part.modules.map((mod) => (
            <div key={mod.id} className="mb-3 last:mb-0">
              <p className="mb-1.5 flex items-center gap-1.5 pr-1 text-xs font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" /> {mod.title}
              </p>
              {mod.items.length > 0 ? renderItems(mod.items) : <p className="px-3 text-[11px] text-muted-foreground">لا يوجد محتوى بعد.</p>}
            </div>
          ))}
        </section>
      ))}
      {parts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          لم تتم إضافة محتوى لهذه الدورة بعد.
        </p>
      ) : null}
    </div>
  );
}
