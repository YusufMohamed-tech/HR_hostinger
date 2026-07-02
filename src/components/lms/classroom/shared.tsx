"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClassroom } from "@/hooks/use-data";
import type { LmsClassroomDashboard, LmsRecord, LmsSyllabusItem } from "@/types/lms";

// ---------------------------------------------------------------------------
// Safe readers for Record<string, unknown> payloads
// ---------------------------------------------------------------------------
export const S = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
export const N = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
export const L = <T = LmsRecord,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const R = (v: unknown): LmsRecord => (v && typeof v === "object" ? (v as LmsRecord) : {});

export function pct(value: unknown) {
  return Math.max(0, Math.min(100, Math.round(N(value))));
}

export function formatDate(value: unknown) {
  const raw = S(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
}

export function itemHref(enrollmentId: string, item: Pick<LmsSyllabusItem, "kind" | "id">) {
  if (item.kind === "lesson") return `/learn/${enrollmentId}/lesson/${item.id}`;
  if (item.kind === "quiz") return `/learn/${enrollmentId}/quiz/${item.id}`;
  return `/learn/${enrollmentId}/project/${item.id}`;
}

const statusStyles: Record<string, { label: string; className: string }> = {
  completed: { label: "مكتمل", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  passed: { label: "ناجح", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  submitted: { label: "قيد المراجعة", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  in_review: { label: "تمت المراجعة", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  needs_revision: { label: "يحتاج مراجعة", className: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  locked: { label: "مقفل", className: "bg-muted text-muted-foreground" },
  available: { label: "متاح", className: "bg-primary/10 text-primary" },
};

export function StatusPill({ status }: { status: string }) {
  const meta = statusStyles[status] || statusStyles.available;
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium", meta.className)}>{meta.label}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct(value)}%` }} />
    </div>
  );
}

export function Ring({ value, size = 60, stroke = 6 }: { value: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct(value) / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeLinecap="round" className="fill-none stroke-primary transition-all" style={{ strokeDasharray: circumference, strokeDashoffset: offset }} />
      </svg>
      <span className="absolute text-xs font-semibold">{pct(value)}%</span>
    </div>
  );
}

export function Spinner({ label = "جار التحميل..." }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ClassroomError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link href="/learn" className="text-sm font-medium text-primary hover:underline">
        العودة إلى قاعة التعلم
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classroom data context (fetched once by the shell, shared with pages)
// ---------------------------------------------------------------------------
type ClassroomContextValue = {
  enrollmentId: string;
  data: LmsClassroomDashboard | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const ClassroomContext = React.createContext<ClassroomContextValue | null>(null);

export function useClassroomContext() {
  const ctx = React.useContext(ClassroomContext);
  if (!ctx) throw new Error("useClassroomContext must be used inside the classroom shell.");
  return ctx;
}

export function ClassroomProvider({ enrollmentId, children }: { enrollmentId: string; children: React.ReactNode }) {
  const { data, loading, error, refetch } = useClassroom(enrollmentId);
  const value = React.useMemo(() => ({ enrollmentId, data, loading, error, refetch }), [enrollmentId, data, loading, error, refetch]);
  return <ClassroomContext.Provider value={value}>{children}</ClassroomContext.Provider>;
}

export function usePathnameActive() {
  return usePathname();
}
