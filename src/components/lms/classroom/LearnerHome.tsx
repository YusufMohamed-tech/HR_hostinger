"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BookOpen,
  CalendarClock,
  GraduationCap,
  Home,
  Megaphone,
  PlayCircle,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLearnerHome } from "@/hooks/use-data";
import { EmptyState, L, N, ProgressBar, R, S, Spinner, formatDate, pct } from "./shared";

const difficultyLabels: Record<string, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
};

export function LearnerHome() {
  const { data, loading, error } = useLearnerHome();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">قاعة التعلم</p>
            <p className="text-[11px] text-muted-foreground">رحلتك التعليمية في مكان واحد</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <Link href="/">
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">الرئيسية</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        {loading && !data ? (
          <Spinner label="جار تحميل رحلتك التعليمية..." />
        ) : error ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{error}</p>
        ) : data ? (
          <div className="space-y-8">
            <StatsStrip stats={R(data.stats)} />
            <ContinueLearning enrollment={data.continueLearning} />
            <ActiveLearning enrollments={L(data.active)} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Deadlines deadlines={L(data.deadlines)} />
              <Announcements announcements={L(data.announcements)} />
            </div>
            <Certificates certificates={L(data.certificates)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatsStrip({ stats }: { stats: Record<string, unknown> }) {
  const items = [
    { label: "دورات مسندة", value: N(stats.assigned), icon: BookOpen },
    { label: "قيد التعلم", value: N(stats.inProgress), icon: TrendingUp },
    { label: "مكتملة", value: N(stats.completed), icon: Target },
    { label: "شهادات", value: N(stats.certificates), icon: Award },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold">{item.value}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <item.icon className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function ContinueLearning({ enrollment }: { enrollment: unknown }) {
  const row = R(enrollment);
  if (!S(row.id)) {
    return (
      <EmptyState icon={Sparkles} title="لا توجد دورة نشطة الآن" hint="عند إسناد دورة تدريبية إليك ستظهر هنا لتبدأ رحلتك." />
    );
  }
  const course = R(row.course);
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <PlayCircle className="h-4 w-4" /> متابعة التعلم
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-l from-primary/10 via-card to-card">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {S(R(course.category).name) ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{S(R(course.category).name)}</span>
              ) : null}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {difficultyLabels[S(course.difficulty)] || "دورة"}
              </span>
            </div>
            <h3 className="text-lg font-bold md:text-xl">{S(course.title)}</h3>
            {S(course.subtitle) ? <p className="mt-1 text-sm text-muted-foreground">{S(course.subtitle)}</p> : null}
            <div className="mt-4 max-w-md">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">التقدم</span>
                <span className="font-semibold">{pct(row.progress_percent)}%</span>
              </div>
              <ProgressBar value={N(row.progress_percent)} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild size="lg" className="gap-2">
              <Link href={`/learn/${S(row.id)}`}>
                <PlayCircle className="h-5 w-5" /> ادخل القاعة
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActiveLearning({ enrollments }: { enrollments: Record<string, unknown>[] }) {
  if (enrollments.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <BookOpen className="h-4 w-4" /> دوراتي النشطة
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enrollments.map((row) => {
          const course = R(row.course);
          return (
            <Link
              key={S(row.id)}
              href={`/learn/${S(row.id)}`}
              className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {S(course.experience_type) === "program" ? "برنامج" : "دورة"}
                </span>
              </div>
              <h3 className="line-clamp-2 flex-1 text-sm font-semibold group-hover:text-primary">{S(course.title)}</h3>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{pct(row.progress_percent)}% مكتمل</span>
                  {S(row.due_date) ? <span>ينتهي {formatDate(row.due_date)}</span> : null}
                </div>
                <ProgressBar value={N(row.progress_percent)} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Deadlines({ deadlines }: { deadlines: Record<string, unknown>[] }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <CalendarClock className="h-4 w-4" /> المواعيد القادمة
      </h2>
      <div className="rounded-xl border border-border bg-card p-2">
        {deadlines.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">لا توجد مواعيد قريبة.</p>
        ) : (
          <ul className="divide-y divide-border">
            {deadlines.slice(0, 6).map((deadline, index) => (
              <li key={index} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{S(deadline.label)}</p>
                  <p className="text-[11px] text-muted-foreground">{S(R(deadline.course).title)}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    S(deadline.status) === "overdue" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                  )}
                >
                  {formatDate(deadline.due_at) || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Announcements({ announcements }: { announcements: Record<string, unknown>[] }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Megaphone className="h-4 w-4" /> إعلانات المدربين
      </h2>
      <div className="rounded-xl border border-border bg-card p-2">
        {announcements.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">لا توجد إعلانات حالياً.</p>
        ) : (
          <ul className="divide-y divide-border">
            {announcements.slice(0, 6).map((item, index) => (
              <li key={index} className="px-3 py-2.5">
                <p className="truncate text-sm font-medium">{S(item.title)}</p>
                <p className="line-clamp-2 text-[11px] text-muted-foreground">{S(item.body)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{S(R(item.course).title)} · {formatDate(item.published_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Certificates({ certificates }: { certificates: Record<string, unknown>[] }) {
  if (certificates.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Award className="h-4 w-4" /> شهاداتي
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {certificates.map((certificate, index) => (
          <div key={index} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Award className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{S(R(certificate.course).title)}</p>
              <p className="text-[11px] text-muted-foreground">{S(certificate.certificate_number)} · {formatDate(certificate.issued_at)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-center">
        <Button asChild variant="outline" size="sm" className="gap-1">
          <Link href="/lms/certificates">
            عرض كل الشهادات <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
