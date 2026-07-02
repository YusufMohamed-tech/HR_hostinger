"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Award,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  PlayCircle,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LmsSyllabusItem } from "@/types/lms";
import {
  ClassroomError,
  ClassroomProvider,
  L,
  N,
  R,
  Ring,
  S,
  Spinner,
  StatusPill,
  formatDate,
  itemHref,
  pct,
  useClassroomContext,
} from "./shared";

export function ClassroomShell({ enrollmentId, children }: { enrollmentId: string; children: React.ReactNode }) {
  return (
    <ClassroomProvider enrollmentId={enrollmentId}>
      <ClassroomFrame>{children}</ClassroomFrame>
    </ClassroomProvider>
  );
}

function ClassroomFrame({ children }: { children: React.ReactNode }) {
  const { enrollmentId, data, loading, error } = useClassroomContext();
  const pathname = usePathname();

  if (loading && !data) return <Spinner label="جار فتح قاعة التعلم..." />;
  if (error && !data) return <ClassroomError message={error} />;
  if (!data) return <ClassroomError message="تعذّر تحميل هذه الدورة." />;

  const course = R(data.course);
  const enrollment = R(data.enrollment);
  const progress = pct(enrollment.progress_percent);
  const nextAction = data.nextAction as LmsSyllabusItem | null;

  const navItems = [
    { key: "overview", label: "نظرة عامة", icon: LayoutDashboard, href: `/learn/${enrollmentId}`, exact: true },
    { key: "syllabus", label: "المنهج", icon: ListChecks, href: `/learn/${enrollmentId}/syllabus`, matches: ["/syllabus", "/lesson/", "/quiz/", "/project/"] },
    { key: "workspace", label: "مساحة العمل", icon: FolderKanban, href: `/learn/${enrollmentId}/workspace` },
    { key: "community", label: "المجتمع", icon: MessagesSquare, href: `/learn/${enrollmentId}/community` },
    { key: "notes", label: "ملاحظاتي", icon: StickyNote, href: `/learn/${enrollmentId}/notes` },
    { key: "resources", label: "المصادر", icon: FolderOpen, href: `/learn/${enrollmentId}/resources` },
    { key: "certificate", label: "الشهادة", icon: Award, href: `/learn/${enrollmentId}/certificate` },
  ];

  const isActive = (item: (typeof navItems)[number]) => {
    if (item.exact) return pathname === item.href;
    if (item.matches) return item.matches.some((m) => pathname.includes(m));
    return pathname.startsWith(item.href);
  };

  return (
    <div className="min-h-screen">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-3 md:px-6">
          <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <Link href="/learn">
              <LogOut className="h-4 w-4 rotate-180" />
              <span className="hidden sm:inline">خروج</span>
            </Link>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{S(course.title)}</p>
            <p className="truncate text-[11px] text-muted-foreground">{S(R(course.category).name) || S(course.subtitle) || "دورة تدريبية"}</p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-semibold text-muted-foreground">{progress}%</span>
          </div>
          {nextAction ? (
            <Button asChild size="sm" className="gap-1">
              <Link href={itemHref(enrollmentId, nextAction)}>
                <PlayCircle className="h-4 w-4" />
                متابعة
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-3 py-4 md:px-6">
        <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)_290px]">
          {/* Left nav */}
          <aside className="lg:sticky lg:top-[72px] lg:self-start">
            <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-2 lg:flex-col lg:overflow-visible">
              {navItems.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>

          {/* Main */}
          <main className="min-w-0">{children}</main>

          {/* Right contextual panel */}
          <aside className="space-y-4 lg:sticky lg:top-[72px] lg:self-start">
            <ClassroomRightPanel />
          </aside>
        </div>
      </div>
    </div>
  );
}

function ClassroomRightPanel() {
  const { enrollmentId, data } = useClassroomContext();
  if (!data) return null;
  const enrollment = R(data.enrollment);
  const nextAction = data.nextAction as LmsSyllabusItem | null;
  const checklist = R(data.checklist);
  const instructors = L(data.instructors);
  const deadlines = L(data.deadlines);

  const lessons = R(checklist.lessons);
  const quizzes = R(checklist.quizzes);
  const projects = R(checklist.projects);

  const rows = [
    { label: "الدروس", done: N(lessons.done), total: N(lessons.total) },
    { label: "الاختبارات", done: N(quizzes.passed), total: N(quizzes.total) },
    { label: "المشاريع", done: N(projects.accepted), total: N(projects.total) },
  ];

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Ring value={N(enrollment.progress_percent)} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">التقدم في الدورة</p>
            <p className="text-sm font-semibold">{S(enrollment.status) === "completed" ? "أكملت الدورة" : "استمر في التعلم"}</p>
          </div>
        </div>
        {nextAction ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">الخطوة التالية</p>
            <Link href={itemHref(enrollmentId, nextAction)} className="flex items-center justify-between gap-2 text-sm font-medium hover:text-primary">
              <span className="truncate">{nextAction.title}</span>
              <StatusPill status={nextAction.status} />
            </Link>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> أكملت كل المتطلبات
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">قائمة الإكمال</p>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{row.label}</span>
                <span className="text-muted-foreground">{row.done}/{row.total}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${row.total ? (row.done / row.total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {instructors.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">المدرب</p>
          <div className="space-y-3">
            {instructors.slice(0, 3).map((instructor, index) => {
              const employee = R(R(instructor).employee);
              return (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CircleUserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{S(employee.full_name) || "مدرب"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{S(employee.job_title) || "مدرب الدورة"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {deadlines.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> المواعيد النهائية
          </p>
          <div className="space-y-2">
            {deadlines.slice(0, 4).map((deadline, index) => (
              <div key={index} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{S(R(deadline).label)}</span>
                <span className="shrink-0 text-muted-foreground">{formatDate(R(deadline).due_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {S(enrollment.due_date) ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
          <ArrowLeftRight className="h-3.5 w-3.5" /> موعد إنهاء الدورة: {formatDate(enrollment.due_date)}
        </div>
      ) : null}
    </>
  );
}
