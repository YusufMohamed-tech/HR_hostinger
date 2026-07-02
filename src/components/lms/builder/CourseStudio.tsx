"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  ArrowDown,
  ArrowUp,
  Award,
  Bell,
  BookOpen,
  Bold,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  GraduationCap,
  GripVertical,
  Heading1,
  Heading2,
  HelpCircle,
  Italic,
  Layers,
  Library,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Rocket,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  Underline,
  Undo2,
  UploadCloud,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  deleteCourseResource,
  getCourseBuilderState,
  getLearnerPreview,
  getProjectRubric,
  updateCourseBuilderOverview,
  upsertCourseResource,
  upsertProjectRubric,
  upsertWorkspaceConfig,
} from "@/lib/services/learn";
import {
  addLmsQuizQuestion,
  archiveLmsCourse,
  assignLmsCourse,
  createLmsAnnouncement,
  createLmsInstructor,
  createLmsLesson,
  createLmsPost,
  createLmsQuiz,
  createLmsSection,
  createLmsTask,
  deleteLmsLesson,
  deleteLmsQuiz,
  deleteLmsQuizQuestion,
  deleteLmsTask,
  getLmsCourse,
  getLmsInstructors,
  getLmsOrgDepartments,
  getLmsOrgEmployees,
  getLmsOrgLocations,
  publishLmsCourse,
  removeLmsInstructor,
  updateLmsLesson,
  updateLmsQuiz,
  updateLmsTask,
  uploadLmsContent,
} from "@/lib/services/lms";

type Row = Record<string, unknown>;
type Status = { type: "success" | "error"; message: string } | null;
type SaveState = "saved" | "dirty" | "saving" | "error";
type StudioTab = "build" | "settings" | "instructors" | "resources" | "rubrics" | "community" | "assignments" | "preview" | "publish";
type SelectionType = "course" | "section" | "lesson" | "quiz" | "task" | "resource" | "announcement" | "community";
type Selection = { type: SelectionType; id?: string };
type LessonKind = "text" | "video" | "document" | "file" | "link";

const S = (v: unknown, fallback = "") => (typeof v === "string" ? v : v == null ? fallback : String(v));
const N = (v: unknown, fallback = 0) => {
  const value = typeof v === "number" ? v : Number(v);
  return Number.isFinite(value) ? value : fallback;
};
const B = (v: unknown, fallback = false) => (typeof v === "boolean" ? v : v == null ? fallback : Boolean(v));
const R = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const L = <T = Row,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const lines = (v: unknown) => (Array.isArray(v) ? v.map(String).join("\n") : S(v));
const splitLines = (value: string) => value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);

const tabs: { key: StudioTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "build", label: "البناء", icon: Layers },
  { key: "settings", label: "الإعدادات", icon: Settings2 },
  { key: "instructors", label: "المدربون", icon: Users },
  { key: "resources", label: "المصادر", icon: FolderOpen },
  { key: "rubrics", label: "معايير التقييم", icon: ClipboardList },
  { key: "community", label: "المجتمع", icon: MessageSquare },
  { key: "assignments", label: "التكليفات", icon: ClipboardCheck },
  { key: "preview", label: "معاينة المتعلم", icon: Eye },
  { key: "publish", label: "قائمة النشر", icon: Rocket },
];

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  published: "منشورة",
  archived: "مؤرشفة",
};

const lessonLabels: Record<string, string> = {
  text: "صفحة نصية",
  video: "فيديو",
  document: "مستند",
  file: "ملف",
  link: "رابط خارجي",
};

const taskTypeLabels: Record<string, string> = {
  text_response: "رد نصي",
  file_upload: "رفع ملف",
  link_submission: "رابط",
  mixed: "مختلط",
};

const richTextSurfaceClassName =
  "leading-7 text-slate-700 [&_a]:text-brand [&_a]:underline [&_blockquote]:border-r-4 [&_blockquote]:border-brand/40 [&_blockquote]:bg-slate-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-slate-600 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-950 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-950 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pr-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pr-6";

function badgeTone(status: string) {
  if (status === "published") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

function sectionRows(course: Row | null) {
  return L<Row>(R(course).sections).sort((a, b) => N(a.sort_order) - N(b.sort_order));
}

function lessonRows(course: Row | null) {
  return sectionRows(course)
    .flatMap((section): Row[] => L<Row>(section.lessons).map((lesson): Row => ({ ...lesson, sectionTitle: S(section.title) })))
    .sort((a: Row, b: Row) => N(a.sort_order) - N(b.sort_order));
}

function quizRows(course: Row | null) {
  return L<Row>(R(course).quizzes).sort((a, b) => N(a.sort_order) - N(b.sort_order));
}

function taskRows(course: Row | null) {
  return L<Row>(R(course).tasks).sort((a, b) => N(a.sort_order) - N(b.sort_order));
}

function announcementRows(course: Row | null) {
  return L<Row>(R(course).announcements).sort((a, b) => S(b.created_at).localeCompare(S(a.created_at)));
}

function lessonPayload(lesson: Row, patch: Row = {}) {
  return {
    section_id: S(patch.section_id ?? lesson.section_id) || undefined,
    title: S(patch.title ?? lesson.title),
    description: S(patch.description ?? lesson.description) || undefined,
    lesson_type: S(patch.lesson_type ?? lesson.lesson_type, "text"),
    content: S(patch.content ?? lesson.content) || undefined,
    content_url: S(patch.content_url ?? lesson.content_url) || undefined,
    storage_path: S(patch.storage_path ?? lesson.storage_path) || undefined,
    duration_minutes: N(patch.duration_minutes ?? lesson.duration_minutes),
    sort_order: N(patch.sort_order ?? lesson.sort_order),
    is_required: B(patch.is_required ?? lesson.is_required, true),
    is_preview: B(patch.is_preview ?? lesson.is_preview, false),
    is_active: B(patch.is_active ?? lesson.is_active, true),
  };
}

function quizPayload(quiz: Row, patch: Row = {}) {
  return {
    lesson_id: S(patch.lesson_id ?? quiz.lesson_id) || undefined,
    title: S(patch.title ?? quiz.title),
    description: S(patch.description ?? quiz.description) || undefined,
    passing_score: N(patch.passing_score ?? quiz.passing_score, 70),
    max_attempts: Math.max(1, N(patch.max_attempts ?? quiz.max_attempts, 3)),
    time_limit_minutes: N(patch.time_limit_minutes ?? quiz.time_limit_minutes) || undefined,
    is_required: B(patch.is_required ?? quiz.is_required, true),
    is_active: B(patch.is_active ?? quiz.is_active, true),
  };
}

function taskPayload(task: Row, patch: Row = {}) {
  return {
    lesson_id: S(patch.lesson_id ?? task.lesson_id) || undefined,
    title: S(patch.title ?? task.title),
    description: S(patch.description ?? task.description) || undefined,
    task_type: S(patch.task_type ?? task.task_type, "text_response"),
    instructions: S(patch.instructions ?? task.instructions) || undefined,
    due_date: S(patch.due_date ?? task.due_date) || undefined,
    max_score: N(patch.max_score ?? task.max_score, 100),
    pass_score: N(patch.pass_score ?? task.pass_score, 70),
    is_required: B(patch.is_required ?? task.is_required, true),
    allow_resubmission: B(patch.allow_resubmission ?? task.allow_resubmission, true),
    late_submission_allowed: B(patch.late_submission_allowed ?? task.late_submission_allowed, true),
    status: S(patch.status ?? task.status, "draft"),
  };
}

function sanitizeRichTextHtml(html: string) {
  if (typeof document === "undefined") return html;
  const allowedTags = new Set(["A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "FONT", "H1", "H2", "H3", "I", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);
  const allowedStyles = new Set(["color", "font-size", "font-style", "font-weight", "text-align", "text-decoration"]);
  const template = document.createElement("template");
  template.innerHTML = html;
  const walk = (node: Node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(...Array.from(element.childNodes));
          return;
        }
        Array.from(element.attributes).forEach((attribute) => {
          if (attribute.name === "href" && element.tagName === "A") return;
          if (attribute.name === "style") {
            const clean = element
              .getAttribute("style")
              ?.split(";")
              .map((rule) => rule.trim())
              .filter((rule) => allowedStyles.has(rule.split(":")[0]?.trim()))
              .join("; ");
            if (clean) element.setAttribute("style", clean);
            else element.removeAttribute("style");
            return;
          }
          element.removeAttribute(attribute.name);
        });
      }
      walk(child);
    });
  };
  walk(template.content);
  return template.innerHTML;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Textarea({ value, onChange, className, placeholder }: { value: string; onChange: (value: string) => void; className?: string; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn("min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary", className)}
    />
  );
}

function RichTextToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </Button>
  );
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const plainText = value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value || "";
  }, [value]);

  const syncValue = useCallback(() => {
    if (!editorRef.current) return;
    onChange(sanitizeRichTextHtml(editorRef.current.innerHTML));
  }, [onChange]);

  const applyCommand = useCallback((command: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncValue();
  }, [syncValue]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/80 p-2">
        <select
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
          defaultValue="P"
          title="نمط النص"
          onChange={(event) => {
            applyCommand("formatBlock", event.target.value);
            event.currentTarget.value = "P";
          }}
        >
          <option value="P">فقرة</option>
          <option value="H1">عنوان كبير</option>
          <option value="H2">عنوان متوسط</option>
          <option value="H3">عنوان صغير</option>
        </select>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RichTextToolButton label="عريض" onClick={() => applyCommand("bold")}><Bold className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="مائل" onClick={() => applyCommand("italic")}><Italic className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="تحته خط" onClick={() => applyCommand("underline")}><Underline className="h-4 w-4" /></RichTextToolButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RichTextToolButton label="نص كبير" onClick={() => applyCommand("fontSize", "5")}><Heading1 className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="نص متوسط" onClick={() => applyCommand("fontSize", "3")}><Type className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="نص صغير" onClick={() => applyCommand("fontSize", "2")}><Heading2 className="h-4 w-4" /></RichTextToolButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RichTextToolButton label="قائمة نقطية" onClick={() => applyCommand("insertUnorderedList")}><List className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="قائمة مرقمة" onClick={() => applyCommand("insertOrderedList")}><ListOrdered className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="اقتباس" onClick={() => applyCommand("formatBlock", "BLOCKQUOTE")}><Quote className="h-4 w-4" /></RichTextToolButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RichTextToolButton label="محاذاة يمين" onClick={() => applyCommand("justifyRight")}><AlignRight className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="محاذاة وسط" onClick={() => applyCommand("justifyCenter")}><AlignCenter className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="محاذاة يسار" onClick={() => applyCommand("justifyLeft")}><AlignLeft className="h-4 w-4" /></RichTextToolButton>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RichTextToolButton label="تراجع" onClick={() => applyCommand("undo")}><Undo2 className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="إعادة" onClick={() => applyCommand("redo")}><Redo2 className="h-4 w-4" /></RichTextToolButton>
        <RichTextToolButton label="إزالة التنسيق" onClick={() => applyCommand("removeFormat")}><Eraser className="h-4 w-4" /></RichTextToolButton>
      </div>
      <div className="relative">
        {!plainText ? <span className="pointer-events-none absolute right-4 top-4 text-sm text-slate-400">اكتب محتوى الدرس هنا مثل مستند عمل منسق...</span> : null}
        <div
          ref={editorRef}
          contentEditable
          dir="rtl"
          suppressContentEditableWarning
          className={cn("min-h-[320px] w-full bg-white px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-brand/20", richTextSurfaceClassName)}
          onInput={syncValue}
          onBlur={syncValue}
          onPaste={(event) => {
            event.preventDefault();
            const html = event.clipboardData.getData("text/html");
            const text = event.clipboardData.getData("text/plain");
            const pasted = html ? sanitizeRichTextHtml(html) : text.replace(/\n/g, "<br />");
            document.execCommand("insertHTML", false, pasted);
            syncValue();
          }}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    saved: { label: "محفوظ", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    dirty: { label: "تغييرات غير محفوظة", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: Pencil },
    saving: { label: "جار الحفظ", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300", icon: Loader2 },
    error: { label: "تعذر الحفظ", className: "bg-destructive/10 text-destructive", icon: XCircle },
  }[state];
  const Icon = map.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", map.className)}>
      <Icon className={cn("h-3.5 w-3.5", state === "saving" && "animate-spin")} />
      {map.label}
    </span>
  );
}

export function CourseStudio({ courseId }: { courseId: string }) {
  const [builder, setBuilder] = useState<Row | null>(null);
  const [course, setCourse] = useState<Row | null>(null);
  const [tab, setTab] = useState<StudioTab>("build");
  const [selected, setSelected] = useState<Selection>({ type: "course" });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [publishing, setPublishing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [builderResult, courseResult] = await Promise.all([getCourseBuilderState(courseId), getLmsCourse(courseId)]);
    if (builderResult.error) setStatus({ type: "error", message: builderResult.error.message });
    if (courseResult.error) setStatus({ type: "error", message: courseResult.error.message });
    setBuilder(builderResult.data);
    setCourse(R(courseResult.data));
    setLoading(false);
    setSaveState((current) => (current === "saving" ? "saved" : current));
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => sectionRows(course), [course]);
  const lessons = useMemo(() => lessonRows(course), [course]);
  const quizzes = useMemo(() => quizRows(course), [course]);
  const tasks = useMemo(() => taskRows(course), [course]);
  const announcements = useMemo(() => announcementRows(course), [course]);
  const resources = useMemo(() => L<Row>(R(builder).resources), [builder]);
  const checklist = R(R(builder).checklist);
  const courseData = R(R(builder).course).id ? R(R(builder).course) : R(course);
  const selectedItem = useMemo(() => {
    if (selected.type === "section") return sections.find((item) => S(item.id) === selected.id);
    if (selected.type === "lesson") return lessons.find((item) => S(item.id) === selected.id);
    if (selected.type === "quiz") return quizzes.find((item) => S(item.id) === selected.id);
    if (selected.type === "task") return tasks.find((item) => S(item.id) === selected.id);
    if (selected.type === "resource") return resources.find((item) => S(item.id) === selected.id);
    if (selected.type === "announcement") return announcements.find((item) => S(item.id) === selected.id);
    return courseData;
  }, [announcements, courseData, lessons, quizzes, resources, sections, selected, tasks]);

  const selectedSectionId = selected.type === "section"
    ? selected.id
    : selected.type === "lesson"
      ? S(R(selectedItem).section_id)
      : S(sections[0]?.id);

  const mutate = useCallback(async (work: () => Promise<{ data: unknown; error: { message: string } | null }>, successMessage: string, nextSelection?: Selection) => {
    setSaveState("saving");
    const result = await work();
    if (result.error) {
      setSaveState("error");
      setStatus({ type: "error", message: result.error.message });
      return null;
    }
    setSaveState("saved");
    setStatus({ type: "success", message: successMessage });
    if (nextSelection) setSelected(nextSelection);
    await load();
    return result.data;
  }, [load]);

  const publish = async () => {
    setPublishing(true);
    const result = await publishLmsCourse(courseId);
    setPublishing(false);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setStatus({ type: "success", message: "تم نشر الدورة بنجاح." });
    await load();
  };

  const archive = async () => {
    const result = await archiveLmsCourse(courseId);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else {
      setStatus({ type: "success", message: "تمت أرشفة الدورة." });
      await load();
    }
  };

  const createDefaultActivity = async (kind: string) => {
    const sectionId = selectedSectionId;
    const lessonId = selected.type === "lesson" ? selected.id : S(lessons.find((lesson) => S(lesson.section_id) === sectionId)?.id);
    const nextOrder = (rows: Row[]) => rows.length + 1;
    setActivityModalOpen(false);

    if (kind === "section" || kind === "locked_section" || kind === "milestone") {
      const title = kind === "locked_section" ? "قسم مقفل جديد" : kind === "milestone" ? "مرحلة تدريبية جديدة" : "قسم جديد";
      const saved = await mutate(
        () => createLmsSection(courseId, { title, description: "", sort_order: sections.length + 1 }),
        "تمت إضافة القسم.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "section", id });
      setTab("build");
      return;
    }

    if (["text", "video", "document", "file", "link", "embed"].includes(kind)) {
      if (!sectionId) {
        setStatus({ type: "error", message: "أضف قسما أولا قبل إضافة الدروس." });
        return;
      }
      const lessonType: LessonKind = kind === "embed" ? "link" : (kind as LessonKind);
      const title = lessonType === "text" ? "درس نصي جديد" : lessonType === "video" ? "درس فيديو جديد" : lessonType === "document" ? "مستند تدريبي جديد" : lessonType === "file" ? "ملف تدريبي جديد" : "رابط تدريبي جديد";
      const saved = await mutate(
        () => createLmsLesson(courseId, {
          section_id: sectionId,
          title,
          lesson_type: lessonType,
          content: lessonType === "text" ? "<p></p>" : undefined,
          content_url: lessonType === "link" ? "https://example.com" : undefined,
          duration_minutes: 10,
          sort_order: nextOrder(lessons),
          is_required: true,
          is_active: true,
        }),
        "تمت إضافة الدرس.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "lesson", id });
      setTab("build");
      return;
    }

    if (kind === "resource") {
      const saved = await mutate(
        () => upsertCourseResource(courseId, { title: "مصدر جديد", resource_type: "document", sort_order: resources.length + 1 }),
        "تمت إضافة المصدر.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "resource", id });
      setTab("resources");
      return;
    }

    if (kind === "quiz") {
      const saved = await mutate(
        () => createLmsQuiz(courseId, { lesson_id: lessonId || undefined, title: "اختبار جديد", passing_score: 70, max_attempts: 3, is_required: true, is_active: true }),
        "تمت إضافة الاختبار.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "quiz", id });
      setTab("build");
      return;
    }

    if (["project", "reflection", "survey", "checklist"].includes(kind)) {
      const title = kind === "reflection" ? "سؤال تأملي جديد" : kind === "survey" ? "استبيان قصير جديد" : kind === "checklist" ? "قائمة تحقق جديدة" : "مشروع جديد";
      const saved = await mutate(
        () => createLmsTask(courseId, {
          lesson_id: lessonId || undefined,
          title,
          task_type: kind === "project" ? "mixed" : "text_response",
          instructions: "اكتب تعليمات النشاط هنا.",
          max_score: 100,
          pass_score: 70,
          status: "draft",
          is_required: true,
          sort_order: nextOrder(tasks),
        }),
        "تمت إضافة النشاط.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "task", id });
      setTab("build");
      return;
    }

    if (kind === "announcement") {
      const saved = await mutate(
        () => createLmsAnnouncement(courseId, { title: "إعلان جديد", body: "اكتب تفاصيل الإعلان.", pinned: false }),
        "تم إنشاء الإعلان.",
      );
      const id = S(R(saved).id);
      if (id) setSelected({ type: "announcement", id });
      setTab("community");
      return;
    }

    if (kind === "workspace") {
      await mutate(
        () => upsertWorkspaceConfig(courseId, { workspace_type: "external_link", external_url: "https://example.com", instructions: "ضع رابط مساحة العمل وتعليماتها." }),
        "تم تجهيز مساحة العمل الخارجية.",
      );
      setTab("resources");
      return;
    }

    if (kind === "certificate") {
      await mutate(
        () => updateCourseBuilderOverview(courseId, { certificate_enabled: true, certificate_title: S(courseData.title) || "شهادة إتمام" }),
        "تم تفعيل الشهادة لهذه الدورة.",
      );
      setTab("settings");
      return;
    }

    setTab("community");
    setStatus({ type: "success", message: "انتقل إلى تبويب المجتمع لإضافة هذا النوع من التفاعل." });
  };

  const duplicateSelected = async () => {
    const item = R(selectedItem);
    if (!item.id) return;
    if (selected.type === "lesson") {
      const saved = await mutate(() => createLmsLesson(courseId, { ...lessonPayload(item), title: `${S(item.title)} - نسخة`, sort_order: lessons.length + 1 }), "تم نسخ الدرس.");
      const id = S(R(saved).id);
      if (id) setSelected({ type: "lesson", id });
    }
    if (selected.type === "quiz") {
      const questions = L<Row>(item.questions).map((question, index) => ({ ...question, id: undefined, sort_order: index }));
      const saved = await mutate(() => createLmsQuiz(courseId, { ...quizPayload(item), title: `${S(item.title)} - نسخة`, questions }), "تم نسخ الاختبار.");
      const id = S(R(saved).id);
      if (id) setSelected({ type: "quiz", id });
    }
    if (selected.type === "task") {
      const saved = await mutate(() => createLmsTask(courseId, { ...taskPayload(item), title: `${S(item.title)} - نسخة`, status: "draft", sort_order: tasks.length + 1 }), "تم نسخ المهمة.");
      const id = S(R(saved).id);
      if (id) setSelected({ type: "task", id });
    }
    if (selected.type === "resource") {
      const saved = await mutate(() => upsertCourseResource(courseId, { ...item, id: undefined, title: `${S(item.title)} - نسخة`, sort_order: resources.length + 1 }), "تم نسخ المصدر.");
      const id = S(R(saved).id);
      if (id) setSelected({ type: "resource", id });
    }
  };

  const hideSelected = async () => {
    const id = S(R(selectedItem).id);
    if (!id) return;
    if (selected.type === "lesson") await mutate(() => deleteLmsLesson(id), "تم إخفاء الدرس.", { type: "course" });
    if (selected.type === "quiz") await mutate(() => deleteLmsQuiz(id), "تم إخفاء الاختبار.", { type: "course" });
    if (selected.type === "task") await mutate(() => deleteLmsTask(id), "تمت أرشفة المهمة.", { type: "course" });
    if (selected.type === "resource") await mutate(() => deleteCourseResource(id), "تم إخفاء المصدر.", { type: "course" });
  };

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!builder || !course) {
    return <p className="py-12 text-center text-sm text-muted-foreground">تعذر تحميل الاستوديو.</p>;
  }

  const courseStatus = S(courseData.status, "draft");

  return (
    <div className="min-h-[calc(100vh-5rem)] space-y-4" dir="rtl">
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold">{S(courseData.title) || "دورة بدون عنوان"}</h1>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", badgeTone(courseStatus))}>{statusLabels[courseStatus] || courseStatus}</span>
              {courseStatus === "published" ? <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">التعديل يؤثر على دورة منشورة</span> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">استوديو احترافي لبناء الدورة، إدارة المحتوى، المدربين، الموارد، المجتمع والنشر.</p>
          </div>
          <SaveIndicator state={saveState} />
          <Button asChild variant="outline" size="sm">
            <Link href="/lms/courses">الدورات</Link>
          </Button>
          <Button onClick={() => setActivityModalOpen(true)} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> إضافة نشاط
          </Button>
          <Button onClick={publish} disabled={publishing || !B(checklist.canPublish)} size="sm" className="gap-1">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} نشر
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>
      </div>

      {status ? (
        <div className={cn("rounded-lg border px-4 py-2.5 text-sm", status.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive")}>
          {status.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <CourseMap
          course={courseData}
          sections={sections}
          lessons={lessons}
          quizzes={quizzes}
          tasks={tasks}
          resources={resources}
          announcements={announcements}
          selected={selected}
          onSelect={(next) => {
            setSelected(next);
            if (["lesson", "quiz", "task", "section", "course"].includes(next.type)) setTab("build");
            if (next.type === "resource") setTab("resources");
            if (next.type === "announcement") setTab("community");
          }}
          onAdd={() => setActivityModalOpen(true)}
        />

        <main className="min-w-0">
          {tab === "build" ? (
            <BuildCanvas
              courseId={courseId}
              course={courseData}
              selected={selected}
              selectedItem={R(selectedItem)}
              sections={sections}
              lessons={lessons}
              quizzes={quizzes}
              tasks={tasks}
              onDirty={() => setSaveState("dirty")}
              onMutate={mutate}
              onAdd={() => setActivityModalOpen(true)}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsCanvas courseId={courseId} course={courseData} onDirty={() => setSaveState("dirty")} onMutate={mutate} />
          ) : null}
          {tab === "instructors" ? (
            <InstructorsCanvas courseId={courseId} onStatus={setStatus} />
          ) : null}
          {tab === "resources" ? (
            <ResourcesCanvas courseId={courseId} resources={resources} selected={selected} onSelect={(id) => setSelected({ type: "resource", id })} onMutate={mutate} onDirty={() => setSaveState("dirty")} />
          ) : null}
          {tab === "rubrics" ? (
            <RubricsCanvas tasks={tasks} onStatus={setStatus} />
          ) : null}
          {tab === "community" ? (
            <CommunityCanvas courseId={courseId} announcements={announcements} onMutate={mutate} onDirty={() => setSaveState("dirty")} />
          ) : null}
          {tab === "assignments" ? (
            <AssignmentsCanvas courseId={courseId} onStatus={setStatus} />
          ) : null}
          {tab === "preview" ? <PreviewCanvas courseId={courseId} /> : null}
          {tab === "publish" ? <PublishCanvas checklist={checklist} status={courseStatus} onPublish={publish} onArchive={archive} publishing={publishing} /> : null}
        </main>

        <Inspector
          courseId={courseId}
          selected={selected}
          item={R(selectedItem)}
          checklist={checklist}
          onMutate={mutate}
          onDuplicate={duplicateSelected}
          onHide={hideSelected}
        />
      </div>

      {activityModalOpen ? (
        <ActivityModal onClose={() => setActivityModalOpen(false)} onCreate={createDefaultActivity} />
      ) : null}
    </div>
  );
}

function CourseMap({
  course,
  sections,
  lessons,
  quizzes,
  tasks,
  resources,
  announcements,
  selected,
  onSelect,
  onAdd,
}: {
  course: Row;
  sections: Row[];
  lessons: Row[];
  quizzes: Row[];
  tasks: Row[];
  resources: Row[];
  announcements: Row[];
  selected: Selection;
  onSelect: (selection: Selection) => void;
  onAdd: () => void;
}) {
  const selectedClass = (type: SelectionType, id?: string) =>
    selected.type === type && selected.id === id ? "border-primary bg-primary/10 text-primary" : "border-transparent hover:bg-muted";
  const nodeClass = "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-right text-xs transition-colors";

  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold">خريطة الدورة</p>
            <p className="text-[11px] text-muted-foreground">اسحب ذهنيا من هنا إلى canvas العمل.</p>
          </div>
          <Button onClick={onAdd} size="icon-sm" title="إضافة نشاط"><Plus className="h-4 w-4" /></Button>
        </div>
        <button className={cn(nodeClass, selectedClass("course"))} onClick={() => onSelect({ type: "course" })}>
          <GraduationCap className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">{S(course.title) || "الدورة"}</span>
          <Badge variant="outline">{S(course.status, "draft")}</Badge>
        </button>

        <div className="mt-3 space-y-2">
          {sections.map((section, index) => {
            const sectionLessons = lessons.filter((lesson) => S(lesson.section_id) === S(section.id));
            const sectionLessonIds = new Set(sectionLessons.map((lesson) => S(lesson.id)));
            const sectionQuizzes = quizzes.filter((quiz) => sectionLessonIds.has(S(quiz.lesson_id)));
            const sectionTasks = tasks.filter((task) => !S(task.lesson_id) || sectionLessonIds.has(S(task.lesson_id)));
            return (
              <div key={S(section.id) || index} className="rounded-lg border border-border bg-background/70 p-2">
                <button className={cn(nodeClass, "font-semibold", selectedClass("section", S(section.id)))} onClick={() => onSelect({ type: "section", id: S(section.id) })}>
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{index + 1}. {S(section.title)}</span>
                  <Badge variant="secondary">{sectionLessons.length}</Badge>
                </button>
                <div className="mt-2 space-y-1 pr-4">
                  {sectionLessons.map((lesson) => (
                    <button key={S(lesson.id)} className={cn(nodeClass, selectedClass("lesson", S(lesson.id)))} onClick={() => onSelect({ type: "lesson", id: S(lesson.id) })}>
                      {S(lesson.lesson_type) === "video" ? <MonitorPlay className="h-4 w-4" /> : S(lesson.lesson_type) === "link" ? <Link2 className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                      <span className="min-w-0 flex-1 truncate">{S(lesson.title)}</span>
                      {!B(lesson.is_active, true) ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    </button>
                  ))}
                  {sectionQuizzes.map((quiz) => (
                    <button key={S(quiz.id)} className={cn(nodeClass, selectedClass("quiz", S(quiz.id)))} onClick={() => onSelect({ type: "quiz", id: S(quiz.id) })}>
                      <HelpCircle className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{S(quiz.title)}</span>
                    </button>
                  ))}
                  {sectionTasks.map((task) => (
                    <button key={S(task.id)} className={cn(nodeClass, selectedClass("task", S(task.id)))} onClick={() => onSelect({ type: "task", id: S(task.id) })}>
                      <ClipboardCheck className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{S(task.title)}</span>
                      <Badge variant={S(task.status) === "published" ? "default" : "outline"}>{S(task.status, "draft")}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {sections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              لا توجد أقسام بعد. أضف قسما ثم ابدأ بإضافة الدروس والأنشطة.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">عناصر إضافية</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button onClick={() => resources[0] ? onSelect({ type: "resource", id: S(resources[0].id) }) : onAdd()} className="rounded-lg border border-border p-2 text-right hover:bg-muted">
            <FolderOpen className="mb-1 h-4 w-4" /> المصادر {resources.length}
          </button>
          <button onClick={() => announcements[0] ? onSelect({ type: "announcement", id: S(announcements[0].id) }) : onAdd()} className="rounded-lg border border-border p-2 text-right hover:bg-muted">
            <Megaphone className="mb-1 h-4 w-4" /> الإعلانات {announcements.length}
          </button>
        </div>
      </div>
    </aside>
  );
}

function ActivityModal({ onClose, onCreate }: { onClose: () => void; onCreate: (kind: string) => void }) {
  const groups = [
    {
      title: "الموارد",
      items: [
        ["text", "صفحة نصية", BookOpen],
        ["video", "فيديو", MonitorPlay],
        ["document", "مستند / PDF", FileText],
        ["file", "ملف للتحميل", FolderOpen],
        ["link", "رابط خارجي", Link2],
        ["embed", "محتوى مضمّن", Library],
        ["resource", "مصدر الدورة", FolderOpen],
      ],
    },
    {
      title: "الأنشطة",
      items: [
        ["quiz", "اختبار", HelpCircle],
        ["project", "مشروع / واجب", ClipboardCheck],
        ["discussion", "نقاش", MessageSquare],
        ["reflection", "سؤال تأملي", Sparkles],
        ["survey", "استبيان", ClipboardList],
        ["checklist", "قائمة تحقق", ListChecks],
      ],
    },
    {
      title: "التواصل",
      items: [
        ["announcement", "إعلان", Megaphone],
        ["qa", "سؤال وجواب", MessageSquare],
        ["note", "ملاحظة مدرب", Bell],
      ],
    },
    {
      title: "متقدم",
      items: [
        ["locked_section", "قسم مقفل", ShieldCheck],
        ["milestone", "مرحلة", Award],
        ["certificate", "محفز شهادة", Award],
        ["workspace", "رابط مساحة عمل", Link2],
      ],
    },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">إضافة نشاط أو مصدر</h2>
            <p className="text-xs text-muted-foreground">اختر نوع العنصر وسيتم إنشاؤه داخل الاستوديو.</p>
          </div>
          <Button onClick={onClose} variant="ghost" size="sm">إغلاق</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} className="rounded-xl border border-border p-3">
              <p className="mb-2 text-sm font-semibold">{group.title}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items.map(([key, label, Icon]) => (
                  <button key={key} onClick={() => onCreate(key)} className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-right text-sm hover:border-primary hover:bg-primary/5">
                    <Icon className="h-4 w-4 text-primary" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function BuildCanvas({
  courseId,
  course,
  selected,
  selectedItem,
  sections,
  lessons,
  quizzes,
  tasks,
  onDirty,
  onMutate,
  onAdd,
}: {
  courseId: string;
  course: Row;
  selected: Selection;
  selectedItem: Row;
  sections: Row[];
  lessons: Row[];
  quizzes: Row[];
  tasks: Row[];
  onDirty: () => void;
  onMutate: (work: () => Promise<{ data: unknown; error: { message: string } | null }>, successMessage: string, nextSelection?: Selection) => Promise<unknown>;
  onAdd: () => void;
}) {
  if (selected.type === "section") return <SectionCanvas courseId={courseId} section={selectedItem} sections={sections} lessons={lessons} onMutate={onMutate} onAdd={onAdd} />;
  if (selected.type === "lesson") return <LessonCanvas courseId={courseId} lesson={selectedItem} sections={sections} onDirty={onDirty} onMutate={onMutate} />;
  if (selected.type === "quiz") return <QuizCanvas courseId={courseId} quiz={selectedItem} lessons={lessons} onDirty={onDirty} onMutate={onMutate} />;
  if (selected.type === "task") return <TaskCanvas courseId={courseId} task={selectedItem} lessons={lessons} onDirty={onDirty} onMutate={onMutate} />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">لوحة بناء الدورة</h2>
            <p className="text-sm text-muted-foreground">ابدأ من خريطة الدورة أو أضف نشاطا جديدا. كل عنصر له محرر وخصائص خاصة.</p>
          </div>
          <Button onClick={onAdd} className="gap-1"><Plus className="h-4 w-4" /> إضافة نشاط أو مصدر</Button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <StudioStat label="الأقسام" value={sections.length} icon={Layers} />
          <StudioStat label="الدروس" value={lessons.length} icon={BookOpen} />
          <StudioStat label="الاختبارات" value={quizzes.length} icon={HelpCircle} />
          <StudioStat label="المهام" value={tasks.length} icon={ClipboardCheck} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">هيكل التعلم</h3>
          {sections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا يوجد محتوى بعد.</div>
          ) : (
            <div className="space-y-3">
              {sections.map((section, index) => (
                <div key={S(section.id)} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">{index + 1}. {S(section.title)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{L(R(section).lessons).length} درس داخل القسم</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">تعليمات الاستوديو</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>حدد أي درس أو اختبار أو مهمة من خريطة الدورة لتحريره مباشرة هنا.</p>
            <p>محتوى الدرس النصي يدعم تنسيق المستندات: عناوين، حجم النص، عريض، مائل، قوائم، اقتباس ومحاذاة.</p>
            <p>استخدم قائمة النشر للتحقق من جاهزية الدورة قبل إظهارها للمتعلمين.</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">ملخص الدورة</h3>
        <p className="mt-2 text-sm text-muted-foreground">{S(course.description) || "لا يوجد وصف للدورة بعد."}</p>
      </div>
    </div>
  );
}

function StudioStat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <Icon className="mb-3 h-5 w-5 text-primary" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionCanvas({ courseId, section, sections, lessons, onMutate, onAdd }: { courseId: string; section: Row; sections: Row[]; lessons: Row[]; onMutate: CourseMutate; onAdd: () => void }) {
  const sectionLessons = lessons.filter((lesson) => S(lesson.section_id) === S(section.id));
  const [title, setTitle] = useState("");

  useEffect(() => {
    setTitle("");
  }, [section.id]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">قسم</p>
            <h2 className="text-xl font-bold">{S(section.title)}</h2>
            <p className="text-sm text-muted-foreground">{S(section.description) || "لا يوجد وصف."}</p>
          </div>
          <Button onClick={onAdd} className="gap-1"><Plus className="h-4 w-4" /> إضافة نشاط</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">إضافة قسم سريع</h3>
        <div className="flex gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="عنوان القسم الجديد" />
          <Button
            disabled={!title.trim()}
            onClick={() => onMutate(() => createLmsSection(courseId, { title, sort_order: sections.length + 1 }), "تمت إضافة القسم.").then(() => setTitle(""))}
          >
            إضافة
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">دروس هذا القسم</h3>
        {sectionLessons.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">لا توجد دروس في هذا القسم بعد.</p> : null}
        <div className="space-y-2">
          {sectionLessons.map((lesson) => (
            <div key={S(lesson.id)} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{S(lesson.title)}</p>
                <p className="text-[11px] text-muted-foreground">{lessonLabels[S(lesson.lesson_type)] || S(lesson.lesson_type)}</p>
              </div>
              <Badge variant={B(lesson.is_active, true) ? "default" : "outline"}>{B(lesson.is_active, true) ? "ظاهر" : "مخفي"}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type CourseMutate = (work: () => Promise<{ data: unknown; error: { message: string } | null }>, successMessage: string, nextSelection?: Selection) => Promise<unknown>;

function LessonCanvas({ courseId, lesson, sections, onDirty, onMutate }: { courseId: string; lesson: Row; sections: Row[]; onDirty: () => void; onMutate: CourseMutate }) {
  const [form, setForm] = useState(() => lessonPayload(lesson));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm(lessonPayload(lesson));
    setFile(null);
  }, [lesson]);

  const set = (key: keyof typeof form, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    onDirty();
  };

  const save = () => onMutate(() => updateLmsLesson(S(lesson.id), form), "تم حفظ الدرس.");

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    const data = new FormData();
    data.set("file", file);
    data.set("course_id", courseId);
    data.set("lesson_id", S(lesson.id));
    data.set("kind", "lessons");
    const result = await uploadLmsContent(data);
    setUploading(false);
    if (result.error) return;
    set("storage_path", S(R(result.data).path));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">محتوى الدرس</p>
            <h2 className="text-xl font-bold">{S(lesson.title)}</h2>
          </div>
          <Button onClick={save} className="gap-1"><Save className="h-4 w-4" /> حفظ الدرس</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="عنوان الدرس"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
          <Field label="القسم">
            <select value={S(form.section_id)} onChange={(event) => set("section_id", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="">بدون قسم</option>
              {sections.map((section) => <option key={S(section.id)} value={S(section.id)}>{S(section.title)}</option>)}
            </select>
          </Field>
          <Field label="نوع الدرس">
            <select value={S(form.lesson_type, "text")} onChange={(event) => set("lesson_type", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="text">نصي</option>
              <option value="video">فيديو</option>
              <option value="document">مستند</option>
              <option value="file">ملف</option>
              <option value="link">رابط</option>
            </select>
          </Field>
          <Field label="المدة بالدقائق"><Input type="number" value={N(form.duration_minutes)} onChange={(event) => set("duration_minutes", Number(event.target.value))} /></Field>
          <div className="md:col-span-2">
            <Field label="وصف مختصر"><Textarea value={S(form.description)} onChange={(value) => set("description", value)} className="min-h-16" /></Field>
          </div>
        </div>
      </div>

      {S(form.lesson_type) === "text" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">محرر مستند الدرس</h3>
            <Badge variant="outline">يدعم التنسيق الكامل</Badge>
          </div>
          <RichTextEditor value={S(form.content)} onChange={(value) => set("content", value)} />
        </div>
      ) : null}

      {S(form.lesson_type) !== "text" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">مصدر المحتوى</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="رابط المحتوى"><Input value={S(form.content_url)} onChange={(event) => set("content_url", event.target.value)} placeholder="https://..." /></Field>
            <Field label="مسار التخزين الخاص"><Input value={S(form.storage_path)} onChange={(event) => set("storage_path", event.target.value)} /></Field>
            <Field label="رفع ملف خاص" hint="سيتم الحفظ في lms-content وتظهر الملفات للمتعلمين عبر signed URL فقط.">
              <div className="flex gap-2">
                <Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <Button onClick={upload} disabled={!file || uploading} variant="outline" className="gap-1">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} رفع
                </Button>
              </div>
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuizCanvas({ quiz, lessons, onDirty, onMutate }: { courseId: string; quiz: Row; lessons: Row[]; onDirty: () => void; onMutate: CourseMutate }) {
  const [form, setForm] = useState(() => quizPayload(quiz));
  const [question, setQuestion] = useState({ question_text: "", question_type: "single_choice", options: "", answer: "", points: 1 });

  useEffect(() => {
    setForm(quizPayload(quiz));
    setQuestion({ question_text: "", question_type: "single_choice", options: "", answer: "", points: 1 });
  }, [quiz]);

  const set = (key: keyof typeof form, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    onDirty();
  };

  const addQuestion = async () => {
    const options = splitLines(question.options);
    const correct = question.question_type === "multiple_choice" ? splitLines(question.answer) : question.answer.trim();
    await onMutate(
      () => addLmsQuizQuestion(S(quiz.id), {
        question_text: question.question_text,
        question_type: question.question_type,
        options_json: options,
        correct_answer_json: correct,
        points: question.points,
        sort_order: L(quiz.questions).length + 1,
      }),
      "تمت إضافة السؤال."
    );
    setQuestion({ question_text: "", question_type: "single_choice", options: "", answer: "", points: 1 });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">اختبار</p>
            <h2 className="text-xl font-bold">{S(quiz.title)}</h2>
          </div>
          <Button onClick={() => onMutate(() => updateLmsQuiz(S(quiz.id), form), "تم حفظ الاختبار.")} className="gap-1"><Save className="h-4 w-4" /> حفظ الاختبار</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="عنوان الاختبار"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
          <Field label="مرتبط بالدرس">
            <select value={S(form.lesson_id)} onChange={(event) => set("lesson_id", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="">غير مرتبط</option>
              {lessons.map((lesson) => <option key={S(lesson.id)} value={S(lesson.id)}>{S(lesson.title)}</option>)}
            </select>
          </Field>
          <Field label="درجة النجاح"><Input type="number" value={N(form.passing_score)} onChange={(event) => set("passing_score", Number(event.target.value))} /></Field>
          <Field label="عدد المحاولات"><Input type="number" value={N(form.max_attempts)} onChange={(event) => set("max_attempts", Number(event.target.value))} /></Field>
          <Field label="الوقت بالدقائق"><Input type="number" value={N(form.time_limit_minutes)} onChange={(event) => set("time_limit_minutes", Number(event.target.value))} /></Field>
          <div className="md:col-span-2">
            <Field label="الوصف"><Textarea value={S(form.description)} onChange={(value) => set("description", value)} /></Field>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">أسئلة الاختبار</h3>
        <div className="space-y-2">
          {L<Row>(quiz.questions).map((item, index) => (
            <div key={S(item.id) || index} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{S(item.question_text)}</p>
                <p className="text-[11px] text-muted-foreground">{S(item.question_type)} · {N(item.points, 1)} نقطة</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => onMutate(() => deleteLmsQuizQuestion(S(item.id)), "تم حذف السؤال.")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-dashed border-border p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="نص السؤال"><Input value={question.question_text} onChange={(event) => setQuestion((current) => ({ ...current, question_text: event.target.value }))} /></Field>
            <Field label="نوع السؤال">
              <select value={question.question_type} onChange={(event) => setQuestion((current) => ({ ...current, question_type: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
                <option value="single_choice">اختيار واحد</option>
                <option value="multiple_choice">اختيار متعدد</option>
                <option value="true_false">صح / خطأ</option>
                <option value="short_answer">إجابة قصيرة</option>
              </select>
            </Field>
            <Field label="الخيارات" hint="سطر لكل خيار"><Textarea value={question.options} onChange={(value) => setQuestion((current) => ({ ...current, options: value }))} /></Field>
            <Field label="الإجابة الصحيحة" hint="لا تظهر للمتعلمين قبل التسليم"><Textarea value={question.answer} onChange={(value) => setQuestion((current) => ({ ...current, answer: value }))} /></Field>
            <Field label="النقاط"><Input type="number" value={question.points} onChange={(event) => setQuestion((current) => ({ ...current, points: Number(event.target.value) }))} /></Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={addQuestion} disabled={!question.question_text.trim()} className="gap-1"><Plus className="h-4 w-4" /> إضافة سؤال</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCanvas({ task, lessons, onDirty, onMutate }: { courseId: string; task: Row; lessons: Row[]; onDirty: () => void; onMutate: CourseMutate }) {
  const [form, setForm] = useState(() => taskPayload(task));

  useEffect(() => {
    setForm(taskPayload(task));
  }, [task]);

  const set = (key: keyof typeof form, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    onDirty();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">مهمة / مشروع</p>
            <h2 className="text-xl font-bold">{S(task.title)}</h2>
          </div>
          <Button onClick={() => onMutate(() => updateLmsTask(S(task.id), form), "تم حفظ المهمة.")} className="gap-1"><Save className="h-4 w-4" /> حفظ المهمة</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="عنوان المهمة"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
          <Field label="مرتبطة بالدرس">
            <select value={S(form.lesson_id)} onChange={(event) => set("lesson_id", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="">مستوى الدورة</option>
              {lessons.map((lesson) => <option key={S(lesson.id)} value={S(lesson.id)}>{S(lesson.title)}</option>)}
            </select>
          </Field>
          <Field label="نوع التسليم">
            <select value={S(form.task_type)} onChange={(event) => set("task_type", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="text_response">رد نصي</option>
              <option value="file_upload">رفع ملف</option>
              <option value="link_submission">رابط</option>
              <option value="mixed">مختلط</option>
            </select>
          </Field>
          <Field label="حالة النشر">
            <select value={S(form.status)} onChange={(event) => set("status", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="draft">مسودة</option>
              <option value="published">منشورة</option>
              <option value="archived">مؤرشفة</option>
            </select>
          </Field>
          <Field label="تاريخ الاستحقاق"><Input type="date" value={S(form.due_date)} onChange={(event) => set("due_date", event.target.value)} /></Field>
          <Field label="الدرجة القصوى"><Input type="number" value={N(form.max_score)} onChange={(event) => set("max_score", Number(event.target.value))} /></Field>
          <Field label="درجة النجاح"><Input type="number" value={N(form.pass_score)} onChange={(event) => set("pass_score", Number(event.target.value))} /></Field>
          <div className="md:col-span-2">
            <Field label="الوصف"><Textarea value={S(form.description)} onChange={(value) => set("description", value)} className="min-h-16" /></Field>
          </div>
          <div className="md:col-span-2">
            <Field label="تعليمات المتعلم"><RichTextEditor value={S(form.instructions)} onChange={(value) => set("instructions", value)} /></Field>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsCanvas({ courseId, course, onDirty, onMutate }: { courseId: string; course: Row; onDirty: () => void; onMutate: CourseMutate }) {
  const [form, setForm] = useState({
    title: S(course.title),
    subtitle: S(course.subtitle),
    description: S(course.description),
    experience_type: S(course.experience_type, "course"),
    difficulty: S(course.difficulty, "beginner"),
    estimated_minutes: N(course.estimated_minutes),
    visibility: S(course.visibility, "assigned_only"),
    language: S(course.language, "ar"),
    target_audience: S(course.target_audience),
    prerequisites: S(course.prerequisites),
    learning_outcomes: lines(course.learning_outcomes),
    skills_gained: lines(course.skills_gained),
    tags: Array.isArray(course.tags) ? (course.tags as string[]).join(", ") : S(course.tags),
    passing_score: N(course.passing_score, 70),
    requires_quiz_pass: B(course.requires_quiz_pass),
    requires_task_pass: B(course.requires_task_pass),
    certificate_enabled: course.certificate_enabled !== false,
    certificate_title: S(course.certificate_title),
    certificate_description: S(course.certificate_description),
    certificate_signatory: S(course.certificate_signatory),
  });

  useEffect(() => {
    setForm({
      title: S(course.title),
      subtitle: S(course.subtitle),
      description: S(course.description),
      experience_type: S(course.experience_type, "course"),
      difficulty: S(course.difficulty, "beginner"),
      estimated_minutes: N(course.estimated_minutes),
      visibility: S(course.visibility, "assigned_only"),
      language: S(course.language, "ar"),
      target_audience: S(course.target_audience),
      prerequisites: S(course.prerequisites),
      learning_outcomes: lines(course.learning_outcomes),
      skills_gained: lines(course.skills_gained),
      tags: Array.isArray(course.tags) ? (course.tags as string[]).join(", ") : S(course.tags),
      passing_score: N(course.passing_score, 70),
      requires_quiz_pass: B(course.requires_quiz_pass),
      requires_task_pass: B(course.requires_task_pass),
      certificate_enabled: course.certificate_enabled !== false,
      certificate_title: S(course.certificate_title),
      certificate_description: S(course.certificate_description),
      certificate_signatory: S(course.certificate_signatory),
    });
  }, [course]);

  const set = (key: keyof typeof form, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    onDirty();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">إعدادات الدورة</h2>
            <p className="text-sm text-muted-foreground">بيانات الدورة، شروط الإكمال، الشهادة ومخرجات التعلم.</p>
          </div>
          <Button
            onClick={() => onMutate(() => updateCourseBuilderOverview(courseId, {
              ...form,
              learning_outcomes: form.learning_outcomes,
              skills_gained: form.skills_gained,
              tags: form.tags,
            }), "تم حفظ إعدادات الدورة.")}
            className="gap-1"
          >
            <Save className="h-4 w-4" /> حفظ الإعدادات
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="العنوان"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
          <Field label="العنوان الفرعي"><Input value={form.subtitle} onChange={(event) => set("subtitle", event.target.value)} /></Field>
          <Field label="نوع التجربة">
            <select value={form.experience_type} onChange={(event) => set("experience_type", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="course">دورة</option>
              <option value="program">برنامج</option>
            </select>
          </Field>
          <Field label="المستوى">
            <select value={form.difficulty} onChange={(event) => set("difficulty", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="beginner">مبتدئ</option>
              <option value="intermediate">متوسط</option>
              <option value="advanced">متقدم</option>
            </select>
          </Field>
          <Field label="المدة المقدرة بالدقائق"><Input type="number" value={form.estimated_minutes} onChange={(event) => set("estimated_minutes", Number(event.target.value))} /></Field>
          <Field label="الظهور">
            <select value={form.visibility} onChange={(event) => set("visibility", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="assigned_only">المكلفون فقط</option>
              <option value="catalog">كتالوج الدورات</option>
            </select>
          </Field>
          <div className="md:col-span-2"><Field label="الوصف"><Textarea value={form.description} onChange={(value) => set("description", value)} /></Field></div>
          <Field label="مخرجات التعلم" hint="سطر لكل مخرج"><Textarea value={form.learning_outcomes} onChange={(value) => set("learning_outcomes", value)} /></Field>
          <Field label="المهارات المكتسبة" hint="سطر لكل مهارة"><Textarea value={form.skills_gained} onChange={(value) => set("skills_gained", value)} /></Field>
          <Field label="الجمهور المستهدف"><Textarea value={form.target_audience} onChange={(value) => set("target_audience", value)} /></Field>
          <Field label="المتطلبات السابقة"><Textarea value={form.prerequisites} onChange={(value) => set("prerequisites", value)} /></Field>
          <Field label="الوسوم"><Input value={form.tags} onChange={(event) => set("tags", event.target.value)} /></Field>
          <Field label="لغة المحتوى"><Input value={form.language} onChange={(event) => set("language", event.target.value)} /></Field>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">الإكمال والشهادة</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="درجة النجاح العامة"><Input type="number" value={form.passing_score} onChange={(event) => set("passing_score", Number(event.target.value))} /></Field>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_quiz_pass} onChange={(event) => set("requires_quiz_pass", event.target.checked)} /> يتطلب اجتياز الاختبارات</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_task_pass} onChange={(event) => set("requires_task_pass", event.target.checked)} /> يتطلب قبول المهام</label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.certificate_enabled} onChange={(event) => set("certificate_enabled", event.target.checked)} /> تفعيل الشهادة</label>
          <Field label="عنوان الشهادة"><Input value={form.certificate_title} onChange={(event) => set("certificate_title", event.target.value)} /></Field>
          <Field label="اسم الموقّع"><Input value={form.certificate_signatory} onChange={(event) => set("certificate_signatory", event.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="وصف الشهادة"><Textarea value={form.certificate_description} onChange={(value) => set("certificate_description", value)} className="min-h-16" /></Field></div>
        </div>
      </div>
    </div>
  );
}

function InstructorsCanvas({ courseId, onStatus }: { courseId: string; onStatus: (status: Status) => void }) {
  const [instructors, setInstructors] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ employee_id: "", instructor_type: "primary_instructor", can_edit_content: true, can_review_tasks: true, can_moderate_community: true });

  const load = useCallback(async () => {
    setLoading(true);
    const [instructorsResult, employeesResult] = await Promise.all([getLmsInstructors(courseId), getLmsOrgEmployees()]);
    setInstructors(L(instructorsResult.data));
    setEmployees(L(employeesResult.data));
    setLoading(false);
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const result = await createLmsInstructor(courseId, form);
    if (result.error) onStatus({ type: "error", message: result.error.message });
    else {
      onStatus({ type: "success", message: "تم تعيين المدرب." });
      setForm((current) => ({ ...current, employee_id: "" }));
      await load();
    }
  };

  const remove = async (id: string) => {
    const result = await removeLmsInstructor(courseId, id);
    if (result.error) onStatus({ type: "error", message: result.error.message });
    else {
      onStatus({ type: "success", message: "تم حذف المدرب." });
      await load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">مدربو الدورة</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="الموظف">
            <select value={form.employee_id} onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="">اختر موظفا</option>
              {employees.map((employee) => <option key={S(employee.id)} value={S(employee.id)}>{S(employee.full_name)}</option>)}
            </select>
          </Field>
          <Field label="نوع المدرب">
            <select value={form.instructor_type} onChange={(event) => setForm((current) => ({ ...current, instructor_type: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="primary_instructor">مدرب رئيسي</option>
              <option value="assistant_instructor">مدرب مساعد</option>
              <option value="reviewer">مراجع</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_edit_content} onChange={(event) => setForm((current) => ({ ...current, can_edit_content: event.target.checked }))} /> تحرير المحتوى</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_review_tasks} onChange={(event) => setForm((current) => ({ ...current, can_review_tasks: event.target.checked }))} /> مراجعة المهام</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_moderate_community} onChange={(event) => setForm((current) => ({ ...current, can_moderate_community: event.target.checked }))} /> إدارة المجتمع</label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={add} disabled={!form.employee_id} className="gap-1"><Plus className="h-4 w-4" /> إضافة مدرب</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}
        <div className="space-y-2">
          {instructors.map((instructor) => {
            const employee = R(instructor.employee);
            return (
              <div key={S(instructor.id)} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <Users className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{S(employee.full_name) || S(instructor.employee_id)}</p>
                  <p className="text-[11px] text-muted-foreground">{S(instructor.instructor_type)}</p>
                </div>
                <Button onClick={() => remove(S(instructor.id))} variant="ghost" size="icon-sm"><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {!loading && instructors.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">لا يوجد مدربون بعد.</p> : null}
        </div>
      </div>
    </div>
  );
}

function ResourcesCanvas({ courseId, resources, selected, onSelect, onMutate, onDirty }: { courseId: string; resources: Row[]; selected: Selection; onSelect: (id: string) => void; onMutate: CourseMutate; onDirty: () => void }) {
  const selectedResource = selected.type === "resource" ? resources.find((item) => S(item.id) === selected.id) : resources[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">مصادر الدورة</h2>
          <Button
            onClick={() => onMutate(() => upsertCourseResource(courseId, { title: "مصدر جديد", resource_type: "document", sort_order: resources.length + 1 }), "تمت إضافة المصدر.")}
            className="gap-1"
          >
            <Plus className="h-4 w-4" /> مصدر جديد
          </Button>
        </div>
        <div className="space-y-2">
          {resources.map((resource) => (
            <button key={S(resource.id)} onClick={() => onSelect(S(resource.id))} className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-right", selected.id === S(resource.id) ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
              <FolderOpen className="h-4 w-4 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{S(resource.title)}</span>
              <Badge variant="outline">{S(resource.resource_type)}</Badge>
            </button>
          ))}
          {resources.length === 0 ? <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد مصادر بعد.</p> : null}
        </div>
      </div>
      {selectedResource ? <ResourceEditor courseId={courseId} resource={selectedResource} onMutate={onMutate} onDirty={onDirty} /> : null}
    </div>
  );
}

function ResourceEditor({ courseId, resource, onMutate, onDirty }: { courseId: string; resource: Row; onMutate: CourseMutate; onDirty: () => void }) {
  const [form, setForm] = useState({ title: S(resource.title), resource_type: S(resource.resource_type, "document"), description: S(resource.description), external_url: S(resource.external_url), storage_path: S(resource.storage_path), is_active: B(resource.is_active, true) });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm({ title: S(resource.title), resource_type: S(resource.resource_type, "document"), description: S(resource.description), external_url: S(resource.external_url), storage_path: S(resource.storage_path), is_active: B(resource.is_active, true) });
    setFile(null);
  }, [resource]);

  const set = (key: keyof typeof form, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value as never }));
    onDirty();
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    const data = new FormData();
    data.set("file", file);
    data.set("course_id", courseId);
    data.set("kind", "resources");
    const result = await uploadLmsContent(data);
    setUploading(false);
    if (!result.error) set("storage_path", S(R(result.data).path));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold">محرر المصدر</h3>
      <div className="space-y-3">
        <Field label="العنوان"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
        <Field label="النوع">
          <select value={form.resource_type} onChange={(event) => set("resource_type", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
            <option value="document">مستند</option>
            <option value="video">فيديو</option>
            <option value="image">صورة</option>
            <option value="spreadsheet">جدول</option>
            <option value="template">قالب</option>
            <option value="external_link">رابط خارجي</option>
            <option value="file">ملف</option>
          </select>
        </Field>
        <Field label="الرابط الخارجي"><Input value={form.external_url} onChange={(event) => set("external_url", event.target.value)} placeholder="https://..." /></Field>
        <Field label="مسار التخزين"><Input value={form.storage_path} onChange={(event) => set("storage_path", event.target.value)} /></Field>
        <Field label="الوصف"><Textarea value={form.description} onChange={(value) => set("description", value)} className="min-h-16" /></Field>
        <Field label="رفع ملف">
          <div className="flex gap-2">
            <Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Button onClick={upload} disabled={!file || uploading} variant="outline">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            </Button>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => set("is_active", event.target.checked)} /> نشط</label>
        <div className="flex justify-end">
          <Button onClick={() => onMutate(() => upsertCourseResource(courseId, form, S(resource.id)), "تم حفظ المصدر.")} className="gap-1"><Save className="h-4 w-4" /> حفظ</Button>
        </div>
      </div>
    </div>
  );
}

function RubricsCanvas({ tasks, onStatus }: { tasks: Row[]; onStatus: (status: Status) => void }) {
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("معايير تقييم المشروع");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<{ id?: string; title: string; description?: string; passing_criteria: string; points: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectTask = async (taskId: string) => {
    setSelected(taskId);
    if (!taskId) return;
    setLoading(true);
    const result = await getProjectRubric(taskId);
    setLoading(false);
    if (result.error) {
      onStatus({ type: "error", message: result.error.message });
      return;
    }
    const rubric = R(R(result.data).rubric);
    setTitle(S(rubric.title) || "معايير تقييم المشروع");
    setDescription(S(rubric.description));
    setItems(L<Row>(rubric.items).map((item) => ({ id: S(item.id), title: S(item.title), description: S(item.description), passing_criteria: S(item.passing_criteria), points: N(item.points, 10) })));
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await upsertProjectRubric(selected, { title, description, items });
    setSaving(false);
    if (result.error) onStatus({ type: "error", message: result.error.message });
    else onStatus({ type: "success", message: "تم حفظ معايير التقييم." });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">معايير تقييم المشاريع</h2>
        <Field label="اختر مهمة أو مشروع">
          <select value={selected} onChange={(event) => void selectTask(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
            <option value="">اختر مشروعا</option>
            {tasks.map((task) => <option key={S(task.id)} value={S(task.id)}>{S(task.title)}</option>)}
          </select>
        </Field>
      </div>
      {selected ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="عنوان المعايير"><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                <Field label="وصف"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
              </div>
              <div className="mt-4 space-y-3">
                {items.map((item, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_90px_auto]">
                      <Input value={item.title} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))} placeholder="عنوان المعيار" />
                      <Input type="number" value={item.points} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, points: Number(event.target.value) } : row))} />
                      <Button variant="ghost" size="icon-sm" onClick={() => setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Textarea value={item.passing_criteria} onChange={(value) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, passing_criteria: value } : row))} className="mt-2 min-h-16" placeholder="معيار النجاح..." />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Button variant="outline" onClick={() => setItems((current) => [...current, { title: "", passing_criteria: "", points: 10 }])} className="gap-1"><Plus className="h-4 w-4" /> إضافة معيار</Button>
                <Button onClick={save} disabled={saving} className="gap-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ</Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CommunityCanvas({ courseId, announcements, onMutate, onDirty }: { courseId: string; announcements: Row[]; onMutate: CourseMutate; onDirty: () => void }) {
  const [announcement, setAnnouncement] = useState({ title: "", body: "", pinned: false });
  const [post, setPost] = useState({ title: "", body: "", post_type: "discussion" });

  const setAnnouncementField = (key: keyof typeof announcement, value: unknown) => {
    setAnnouncement((current) => ({ ...current, [key]: value as never }));
    onDirty();
  };
  const setPostField = (key: keyof typeof post, value: string) => {
    setPost((current) => ({ ...current, [key]: value }));
    onDirty();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">إعلان المدرب</h2>
        <div className="space-y-3">
          <Field label="العنوان"><Input value={announcement.title} onChange={(event) => setAnnouncementField("title", event.target.value)} /></Field>
          <Field label="المحتوى"><Textarea value={announcement.body} onChange={(value) => setAnnouncementField("body", value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={announcement.pinned} onChange={(event) => setAnnouncementField("pinned", event.target.checked)} /> تثبيت الإعلان</label>
          <div className="flex justify-end">
            <Button
              disabled={!announcement.title.trim() || !announcement.body.trim()}
              onClick={() => onMutate(() => createLmsAnnouncement(courseId, announcement), "تم نشر الإعلان.").then(() => setAnnouncement({ title: "", body: "", pinned: false }))}
              className="gap-1"
            >
              <Megaphone className="h-4 w-4" /> نشر إعلان
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">نقاش الدورة</h2>
        <div className="space-y-3">
          <Field label="النوع">
            <select value={post.post_type} onChange={(event) => setPostField("post_type", event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="discussion">نقاش</option>
              <option value="question">سؤال</option>
              <option value="announcement">إعلان مجتمع</option>
            </select>
          </Field>
          <Field label="العنوان"><Input value={post.title} onChange={(event) => setPostField("title", event.target.value)} /></Field>
          <Field label="المحتوى"><Textarea value={post.body} onChange={(value) => setPostField("body", value)} /></Field>
          <div className="flex justify-end">
            <Button
              disabled={!post.body.trim()}
              onClick={() => onMutate(() => createLmsPost(courseId, post), "تمت إضافة المشاركة.").then(() => setPost({ title: "", body: "", post_type: "discussion" }))}
              className="gap-1"
            >
              <MessageSquare className="h-4 w-4" /> نشر مشاركة
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold">آخر الإعلانات</h3>
        <div className="space-y-2">
          {announcements.map((item) => (
            <div key={S(item.id)} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" />
                <p className="font-medium">{S(item.title)}</p>
                {B(item.pinned) ? <Badge variant="secondary">مثبت</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{S(item.body)}</p>
            </div>
          ))}
          {announcements.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">لا توجد إعلانات بعد.</p> : null}
        </div>
      </div>
    </div>
  );
}

function AssignmentsCanvas({ courseId, onStatus }: { courseId: string; onStatus: (status: Status) => void }) {
  const [employees, setEmployees] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [form, setForm] = useState({ assignment_type: "all", target_id: "", due_date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [employeesResult, departmentsResult, locationsResult] = await Promise.all([getLmsOrgEmployees(), getLmsOrgDepartments(), getLmsOrgLocations()]);
      setEmployees(L(employeesResult.data));
      setDepartments(L(departmentsResult.data));
      setLocations(L(locationsResult.data));
    }
    void load();
  }, []);

  const targets = form.assignment_type === "employee" ? employees : form.assignment_type === "department" ? departments : form.assignment_type === "location" || form.assignment_type === "team" ? locations : [];

  const assign = async () => {
    setSaving(true);
    const result = await assignLmsCourse({ course_id: courseId, assignment_type: form.assignment_type, target_id: form.assignment_type === "all" ? undefined : form.target_id, due_date: form.due_date || undefined });
    setSaving(false);
    if (result.error) onStatus({ type: "error", message: result.error.message });
    else onStatus({ type: "success", message: "تم إنشاء التكليف وإرسال الإشعارات." });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">تكليف التعلم</h2>
      <p className="mt-1 text-sm text-muted-foreground">اسند الدورة إلى جميع الموظفين أو موظف/قسم/موقع ضمن صلاحياتك.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="نوع التكليف">
          <select value={form.assignment_type} onChange={(event) => setForm({ assignment_type: event.target.value, target_id: "", due_date: form.due_date })} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
            <option value="all">جميع الموظفين</option>
            <option value="employee">موظف</option>
            <option value="department">قسم</option>
            <option value="location">موقع</option>
            <option value="team">فريق/موقع</option>
          </select>
        </Field>
        {form.assignment_type !== "all" ? (
          <Field label="الهدف">
            <select value={form.target_id} onChange={(event) => setForm((current) => ({ ...current, target_id: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="">اختر الهدف</option>
              {targets.map((target) => <option key={S(target.id)} value={S(target.id)}>{S(target.full_name) || S(target.name)}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="الهدف"><Input value="سيتم تكليف جميع الموظفين النشطين" disabled /></Field>
        )}
        <Field label="تاريخ الاستحقاق"><Input type="date" value={form.due_date} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} /></Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={assign} disabled={saving || (form.assignment_type !== "all" && !form.target_id)} className="gap-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} إنشاء التكليف</Button>
      </div>
    </div>
  );
}

function PreviewCanvas({ courseId }: { courseId: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLearnerPreview(courseId).then((result) => {
      setData(result.data);
      setLoading(false);
    });
  }, [courseId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  const structure = L<Row>(data.structure);
  const counts = R(data.counts);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-bold">معاينة المتعلم</h2>
        <p className="mt-1 text-sm text-muted-foreground">هذه المعاينة لا تعرض بيانات الإدارة أو الإجابات الصحيحة.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <StudioStat label="أقسام" value={N(counts.sections)} icon={Layers} />
          <StudioStat label="دروس" value={N(counts.lessons)} icon={BookOpen} />
          <StudioStat label="اختبارات" value={N(counts.quizzes)} icon={HelpCircle} />
          <StudioStat label="مشاريع" value={N(counts.projects)} icon={ClipboardCheck} />
        </div>
      </div>
      <div className="space-y-3">
        {structure.map((section, index) => (
          <div key={S(section.id) || index} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="mb-3 font-semibold">{index + 1}. {S(section.title)}</p>
            <div className="space-y-2">
              {L<Row>(section.lessons).map((lesson) => <PreviewRow key={S(lesson.id)} icon={BookOpen} label="درس" title={S(lesson.title)} />)}
              {L<Row>(section.quizzes).map((quiz) => <PreviewRow key={S(quiz.id)} icon={HelpCircle} label="اختبار" title={S(quiz.title)} />)}
              {L<Row>(section.projects).map((project) => <PreviewRow key={S(project.id)} icon={ClipboardCheck} label="مشروع" title={S(project.title)} />)}
            </div>
          </div>
        ))}
        {structure.length === 0 ? <p className="rounded-xl border border-dashed border-border bg-card/50 py-10 text-center text-sm text-muted-foreground">لا يوجد محتوى بعد.</p> : null}
      </div>
    </div>
  );
}

function PreviewRow({ icon: Icon, label, title }: { icon: React.ComponentType<{ className?: string }>; label: string; title: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      <Icon className="h-4 w-4 text-primary" />
      <Badge variant="outline">{label}</Badge>
      <span>{title}</span>
    </div>
  );
}

function PublishCanvas({ checklist, onArchive, onPublish, publishing, status }: { checklist: Row; onArchive: () => void; onPublish: () => void; publishing: boolean; status: string }) {
  const checks = L<Row>(checklist.checks);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">قائمة التحقق قبل النشر</h2>
        <div className="space-y-2">
          {checks.map((check, index) => (
            <div key={S(check.key) || index} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              {B(check.ok) ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : S(check.severity) === "critical" ? <XCircle className="h-4 w-4 text-destructive" /> : <XCircle className="h-4 w-4 text-amber-500" />}
              <span className="flex-1 text-sm">{S(check.label)}</span>
              {!B(check.ok) ? <Badge variant={S(check.severity) === "critical" ? "destructive" : "outline"}>{S(check.severity) === "critical" ? "حرج" : "تنبيه"}</Badge> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <p className="font-semibold">{B(checklist.canPublish) ? "الدورة جاهزة للنشر" : "أكمل الفحوصات الحرجة أولا"}</p>
          <p className="text-xs text-muted-foreground">{N(checklist.passed)}/{N(checklist.total)} فحوصات مكتملة</p>
        </div>
        <div className="flex gap-2">
          {status !== "archived" ? <Button onClick={onArchive} variant="outline" className="gap-1"><Archive className="h-4 w-4" /> أرشفة</Button> : null}
          <Button onClick={onPublish} disabled={publishing || !B(checklist.canPublish)} className="gap-1">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} نشر الدورة
          </Button>
        </div>
      </div>
    </div>
  );
}

function Inspector({ courseId, selected, item, checklist, onMutate, onDuplicate, onHide }: { courseId: string; selected: Selection; item: Row; checklist: Row; onMutate: CourseMutate; onDuplicate: () => void; onHide: () => void }) {
  const progress = N(checklist.total) ? (N(checklist.passed) / N(checklist.total)) * 100 : 0;
  const patchSelected = async (patch: Row) => {
    if (selected.type === "lesson") await onMutate(() => updateLmsLesson(S(item.id), lessonPayload(item, patch)), "تم تحديث خصائص الدرس.");
    if (selected.type === "quiz") await onMutate(() => updateLmsQuiz(S(item.id), quizPayload(item, patch)), "تم تحديث خصائص الاختبار.");
    if (selected.type === "task") await onMutate(() => updateLmsTask(S(item.id), taskPayload(item, patch)), "تم تحديث خصائص المهمة.");
    if (selected.type === "resource") await onMutate(() => upsertCourseResource(courseId, { ...item, ...patch }, S(item.id)), "تم تحديث خصائص المصدر.");
  };

  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">جاهزية النشر</p>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl font-bold">{N(checklist.passed)}/{N(checklist.total)}</span>
          <span className="text-xs text-muted-foreground">فحوصات مكتملة</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
        <p className={cn("mt-3 flex items-center gap-1 text-xs", B(checklist.canPublish) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
          {B(checklist.canPublish) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {B(checklist.canPublish) ? "جاهزة للنشر" : `${N(checklist.criticalFailures)} فحوصات حرجة متبقية`}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">المحدد حاليا</p>
        <h3 className="mt-1 text-base font-bold">{S(item.title) || (selected.type === "course" ? "الدورة" : selected.type)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{selected.type === "lesson" ? lessonLabels[S(item.lesson_type)] : selected.type === "task" ? taskTypeLabels[S(item.task_type)] : selected.type}</p>
      </div>

      {["lesson", "quiz", "task", "resource"].includes(selected.type) ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">خصائص سريعة</p>
          {selected.type !== "resource" ? (
            <>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                مطلوب للإكمال
                <input type="checkbox" checked={B(item.is_required, true)} onChange={(event) => void patchSelected({ is_required: event.target.checked })} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => void patchSelected({ sort_order: Math.max(0, N(item.sort_order) - 1) })} className="gap-1"><ArrowUp className="h-4 w-4" /> أعلى</Button>
                <Button variant="outline" onClick={() => void patchSelected({ sort_order: N(item.sort_order) + 1 })} className="gap-1"><ArrowDown className="h-4 w-4" /> أسفل</Button>
              </div>
            </>
          ) : null}
          {selected.type === "lesson" || selected.type === "quiz" || selected.type === "resource" ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              ظاهر للمتعلمين
              <input type="checkbox" checked={B(item.is_active, true)} onChange={(event) => void patchSelected({ is_active: event.target.checked })} />
            </label>
          ) : null}
          {selected.type === "lesson" ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              معاينة قبل التكليف
              <input type="checkbox" checked={B(item.is_preview)} onChange={(event) => void patchSelected({ is_preview: event.target.checked })} />
            </label>
          ) : null}
          {selected.type === "task" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant={S(item.status) === "published" ? "default" : "outline"} onClick={() => void patchSelected({ status: "published" })}>نشر المهمة</Button>
              <Button variant={S(item.status) === "draft" ? "default" : "outline"} onClick={() => void patchSelected({ status: "draft" })}>مسودة</Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={onDuplicate} className="gap-1"><Copy className="h-4 w-4" /> نسخ</Button>
            <Button variant="destructive" onClick={onHide} className="gap-1"><Trash2 className="h-4 w-4" /> إخفاء</Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground shadow-sm">
        <p className="mb-1 font-semibold text-foreground">قاعدة العمل</p>
        الدورة المنشورة تحتاج حذرا عند تعديل المحتوى. استخدم المعاينة وقائمة النشر قبل اعتماد التغييرات للمتعلمين.
      </div>
    </aside>
  );
}
