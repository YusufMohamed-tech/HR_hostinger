"use client";

import React, { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Award,
  BookOpen,
  Bold,
  CheckCircle2,
  ClipboardCheck,
  Eraser,
  FileText,
  GraduationCap,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Send,
  Type,
  Underline,
  Undo2,
  UploadCloud,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSkeleton } from "@/components/Skeletons";
import {
  archiveLmsCategory,
  archiveLmsCourse,
  assignLmsCourse,
  completeLmsLesson,
  createLmsAnnouncement,
  createLmsCategory,
  createLmsComment,
  createLmsCourse,
  createLmsInstructor,
  createLmsLesson,
  createLmsPost,
  createLmsQuiz,
  createLmsSection,
  createLmsTask,
  getLmsCategories,
  getLmsCertificates,
  getLmsCommunity,
  getLmsCourse,
  getLmsCourses,
  getLmsDashboard,
  getLmsEnrollment,
  getLmsInstructors,
  getLmsOrgDepartments,
  getLmsOrgEmployees,
  getLmsOrgLocations,
  getLmsTaskSubmissions,
  getSignedLmsUrl,
  publishLmsCourse,
  reactToLmsPost,
  removeLmsInstructor,
  reviewLmsSubmission,
  submitLmsFeedback,
  submitLmsQuiz,
  submitLmsTask,
  updateLmsCategory,
  updateLmsCourse,
  uploadLmsContent,
  addLmsQuizQuestion,
  deleteLmsQuizQuestion,
  deleteLmsLesson,
  deleteLmsQuiz,
  deleteLmsTask,
} from "@/lib/services/lms";
import { useLmsCatalog, useLmsCourses, useLmsDashboard, useLmsReports, useLmsAssignments } from "@/hooks/use-data";
import type { LmsLearnerDashboard } from "@/types/lms";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
type StatusMessage = { type: "success" | "error"; message: string } | null;

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
  assigned: "مكلف",
  in_progress: "قيد التعلم",
  completed: "مكتمل",
  overdue: "متأخر",
  cancelled: "ملغي",
  submitted: "تم التسليم",
  accepted: "مقبول",
  rejected: "مرفوض",
  needs_revision: "يحتاج تعديل",
  reviewed: "تمت المراجعة",
  not_submitted: "لم يسلم",
};

const difficultyLabels: Record<string, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
};

const lessonTypeLabels: Record<string, string> = {
  text: "نص",
  video: "فيديو",
  file: "ملف",
  document: "مستند",
  link: "رابط",
};

const postTypeLabels: Record<string, string> = {
  discussion: "نقاش",
  question: "سؤال",
  announcement: "إعلان",
};

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

function str(row: Row, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function num(row: Row, key: string, fallback = 0) {
  const value = row[key];
  return typeof value === "number" ? value : fallback;
}

function bool(row: Row, key: string, fallback = false) {
  const value = row[key];
  return typeof value === "boolean" ? value : fallback;
}

function dateText(value: unknown) {
  if (!value || typeof value !== "string") return "-";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
}

function statusClass(status: string) {
  if (["completed", "published", "accepted"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["in_progress", "submitted", "reviewed"].includes(status)) return "border-sky-200 bg-sky-50 text-sky-700";
  if (["overdue", "rejected", "needs_revision"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function StatusBadge({ value }: { value: unknown }) {
  const status = typeof value === "string" ? value : "";
  return <Badge className={cn("border", statusClass(status))}>{statusLabels[status] || status || "-"}</Badge>;
}

function ProgressBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 text-xs text-slate-500">{percent}%</span>
    </div>
  );
}

function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "blue" | "green" | "amber";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700",
    blue: "bg-sky-50 text-sky-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-white px-4 text-center">
      <BookOpen className="h-8 w-8 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {action}
    </div>
  );
}

function Message({ status }: { status: StatusMessage }) {
  if (!status) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        status.type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700"
      )}
    >
      {status.message}
    </div>
  );
}

function getCourseFromEnrollment(enrollment: Row) {
  return asRow(enrollment.course);
}

function VideoLessonPlayer({ lesson }: { lesson: Row }) {
  const [url, setUrl] = useState<string | null>(null);
  const storagePath = str(lesson, "storage_path");
  const contentUrl = str(lesson, "content_url");
  const lessonType = str(lesson, "lesson_type");

  useEffect(() => {
    if (!storagePath) return;
    void getSignedLmsUrl(storagePath).then((result) => {
      if (result.data?.signedUrl) setUrl(result.data.signedUrl);
    });
  }, [storagePath]);

  const effectiveUrl = url || (contentUrl || null);
  if (!effectiveUrl) return <p className="text-sm text-slate-500 whitespace-pre-wrap">{str(lesson, "content")}</p>;

  if (lessonType === "video") {
    return (
      <video
        controls
        className="mt-2 w-full max-h-96 rounded-lg bg-black"
        src={effectiveUrl}
        preload="metadata"
      >
        <track kind="captions" />
        متصفحك لا يدعم تشغيل الفيديو.
      </video>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <a
        href={effectiveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
      >
        <FileText className="h-4 w-4" />
        فتح / تحميل الملف
      </a>
    </div>
  );
}

function CourseCard({
  course,
  enrollmentId,
  manager,
}: {
  course: Row;
  enrollmentId?: string;
  manager?: boolean;
}) {
  const courseId = str(course, "id") || str(course, "course_id");
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-950">{str(course, "title", "دورة تدريبية")}</h3>
              <StatusBadge value={course.status} />
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-slate-500">{str(course, "description", "مسار تدريبي داخلي")}</p>
          </div>
          <Badge className="border border-slate-200 bg-slate-50 text-slate-600">
            {difficultyLabels[str(course, "difficulty")] || "مستوى عام"}
          </Badge>
        </div>
        {"progress_percent" in course ? <ProgressBar value={num(course, "progress_percent")} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{num(course, "estimated_minutes")} دقيقة</span>
          <span>{str(course, "visibility") === "catalog" ? "كتالوج" : "مخصص"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {enrollmentId ? (
            <Button asChild>
              <Link href={`/lms/player/${enrollmentId}`}>
                <BookOpen className="h-4 w-4" />
                متابعة
              </Link>
            </Button>
          ) : null}
          {manager && courseId ? (
            <>
              <Button asChild variant="outline">
                <Link href={`/lms/courses/${courseId}/studio`}>الاستوديو</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/lms/courses/${courseId}/tasks`}>المهام</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/lms/courses/${courseId}/community`}>المجتمع</Link>
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardStats({ dashboard }: { dashboard: LmsLearnerDashboard }) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard title="الدورات المكلف بها" value={dashboard.stats.assigned} icon={BookOpen} tone="blue" />
      <StatCard title="قيد التعلم" value={dashboard.stats.inProgress} icon={GraduationCap} tone="amber" />
      <StatCard title="مكتملة" value={dashboard.stats.completed} icon={CheckCircle2} tone="green" />
      <StatCard title="متأخرة" value={dashboard.stats.overdue} icon={ClipboardCheck} />
    </div>
  );
}

export function LmsHomeScreen() {
  const { data: dashboard, loading } = useLmsDashboard();
  const assigned = dashboard?.assigned || [];
  const catalog = dashboard?.catalog || [];

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="التعلم"
        description="مساحة التدريب الداخلي للموظفين والمسارات والشهادات."
        action={
          <>
            <Button asChild variant="outline">
              <Link href="/lms/catalog">كتالوج الدورات</Link>
            </Button>
            <Button asChild>
              <Link href="/lms/my">تعلمي</Link>
            </Button>
          </>
        }
      />
      {dashboard ? <DashboardStats dashboard={dashboard} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الدورات النشطة</CardTitle>
            <CardDescription>الدورات التي تحتاج متابعة أو إكمال.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assigned.slice(0, 4).map((enrollment) => {
              const row = asRow(enrollment);
              const course = getCourseFromEnrollment(row);
              return (
                <CourseCard
                  key={str(row, "id")}
                  course={{ ...course, progress_percent: num(row, "progress_percent"), status: str(row, "status") }}
                  enrollmentId={str(row, "id")}
                />
              );
            })}
            {assigned.length === 0 ? <EmptyState title="لا توجد دورات مكلف بها حاليا" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>من الكتالوج</CardTitle>
            <CardDescription>دورات منشورة ومتاحة للتعلم المؤسسي.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {catalog.slice(0, 4).map((course) => (
              <CourseCard key={str(asRow(course), "id")} course={asRow(course)} />
            ))}
            {catalog.length === 0 ? <EmptyState title="لا توجد دورات كتالوج منشورة" /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LmsMyLearningScreen() {
  const { data: dashboard, loading } = useLmsDashboard();
  const assigned = dashboard?.assigned || [];

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader title="تعلمي" description="الدورات والمسارات المخصصة لك داخل المؤسسة." />
      {dashboard ? <DashboardStats dashboard={dashboard} /> : null}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الدورة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التقدم</TableHead>
                <TableHead>تاريخ الاستحقاق</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assigned.map((item) => {
                const enrollment = asRow(item);
                const course = getCourseFromEnrollment(enrollment);
                return (
                  <TableRow key={str(enrollment, "id")}>
                    <TableCell className="font-medium">{str(course, "title", "دورة تدريبية")}</TableCell>
                    <TableCell><StatusBadge value={enrollment.status} /></TableCell>
                    <TableCell><ProgressBar value={num(enrollment, "progress_percent")} /></TableCell>
                    <TableCell>{dateText(enrollment.due_date)}</TableCell>
                    <TableCell>
                      <Button asChild size="sm">
                        <Link href={`/lms/player/${str(enrollment, "id")}`}>متابعة</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {assigned.length === 0 ? <EmptyState title="لا توجد دورات في خطتك حاليا" /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function LmsCatalogScreen() {
  const { data, loading } = useLmsCatalog();
  const courses = data || [];

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader title="كتالوج الدورات" description="الدورات المنشورة والمتاحة داخل المؤسسة." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((course) => (
          <CourseCard key={str(asRow(course), "id")} course={asRow(course)} />
        ))}
      </div>
      {courses.length === 0 ? <EmptyState title="لا توجد دورات منشورة في الكتالوج" /> : null}
    </div>
  );
}

export function LmsCoursesScreen() {
  const { data, loading, refetch } = useLmsCourses();
  const [categories, setCategories] = useState<Row[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [status, setStatus] = useState<StatusMessage>(null);
  const [search, setSearch] = useState("");
  const courses = (data || []).filter((course) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return str(asRow(course), "title").toLowerCase().includes(q) || str(asRow(course), "description").toLowerCase().includes(q);
  });

  useEffect(() => {
    void getLmsCategories().then((result) => setCategories(rows(result.data)));
  }, []);

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim()) return;
    const result = await createLmsCategory({ name: categoryName.trim(), is_active: true });
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setCategoryName("");
    setStatus({ type: "success", message: "تم إنشاء التصنيف" });
    const refreshed = await getLmsCategories();
    setCategories(rows(refreshed.data));
  }

  async function publish(courseId: string) {
    const result = await publishLmsCourse(courseId);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم نشر الدورة" });
    if (!result.error) refetch();
  }

  async function archive(courseId: string) {
    const result = await archiveLmsCourse(courseId);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم أرشفة الدورة" });
    if (!result.error) refetch();
  }

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة الدورات"
        description="إنشاء المحتوى وإدارة النشر والمهام والمدربين."
        action={
          <Button asChild>
            <Link href="/lms/courses/new">
              <Plus className="h-4 w-4" />
              إنشاء دورة
            </Link>
          </Button>
        }
      />
      <Message status={status} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent>
            <div className="mb-4">
              <Input
                placeholder="بحث في الدورات..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="space-y-3">
              {courses.map((course) => {
                const row = asRow(course);
                const id = str(row, "id");
                return (
                  <div key={id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-base font-semibold text-slate-950">{str(row, "title", "دورة تدريبية")}</h3>
                          <StatusBadge value={row.status} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="rounded-full bg-slate-50 px-2 py-1">{difficultyLabels[str(row, "difficulty")]}</span>
                          <span className="rounded-full bg-slate-50 px-2 py-1">{str(row, "visibility") === "catalog" ? "كتالوج" : "مخصصة"}</span>
                          <span className="rounded-full bg-slate-50 px-2 py-1">{num(row, "estimated_minutes")} دقيقة</span>
                        </div>
                        {str(row, "description") ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{str(row, "description")}</p> : null}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end xl:max-w-[360px]">
                        <Button asChild size="sm" className="min-w-24">
                          <Link href={`/lms/courses/${id}/studio`}>الاستوديو</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="min-w-24">
                          <Link href={`/lms/courses/${id}/instructors`}>المدربون</Link>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void publish(id)} className="min-w-24">نشر</Button>
                        <Button size="sm" variant="destructive" onClick={() => void archive(id)} className="min-w-24">أرشفة</Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {courses.length === 0 ? <EmptyState title="لا توجد دورات بعد" action={<Button asChild><Link href="/lms/courses/new">إنشاء دورة</Link></Button>} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>التصنيفات</CardTitle>
            <CardDescription>تصنيف الدورات حسب مجال التدريب.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex gap-2" onSubmit={createCategory}>
              <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="اسم التصنيف" />
              <Button type="submit" size="icon" aria-label="إضافة تصنيف"><Plus className="h-4 w-4" /></Button>
            </form>
            <div className="space-y-2">
              {categories.map((category) => (
                <div key={str(category, "id")} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span>{str(category, "name")}</span>
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void updateLmsCategory(str(category, "id"), { is_active: !bool(category, "is_active", true) }).then(() => getLmsCategories().then((result) => setCategories(rows(result.data))))}
                    >
                      {bool(category, "is_active", true) ? "تعطيل" : "تفعيل"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void archiveLmsCategory(str(category, "id")).then(() => getLmsCategories().then((result) => setCategories(rows(result.data))))}
                    >
                      أرشفة
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type CourseFormState = {
  title: string;
  description: string;
  category_id: string;
  visibility: string;
  difficulty: string;
  estimated_minutes: string;
  passing_score: string;
  requires_quiz_pass: boolean;
  requires_task_pass: boolean;
};

const blankCourseForm: CourseFormState = {
  title: "",
  description: "",
  category_id: "",
  visibility: "assigned_only",
  difficulty: "beginner",
  estimated_minutes: "60",
  passing_score: "70",
  requires_quiz_pass: false,
  requires_task_pass: false,
};

function QuizQuestionBuilder({ quiz, onDelete, onQuestionAdded }: { quiz: Row; onDelete: () => void; onQuestionAdded: () => Promise<void> }) {
  const quizId = str(quiz, "id");
  const questions = rows(quiz.questions);
  const [open, setOpen] = useState(false);
  const [qForm, setQForm] = useState({ question_text: "", question_type: "single_choice", option_a: "", option_b: "", option_c: "", option_d: "", correct: "a", points: "1" });
  const [status, setStatus] = useState<StatusMessage>(null);

  async function submitQuestion(event: React.FormEvent) {
    event.preventDefault();
    const isChoice = ["single_choice", "multiple_choice", "true_false"].includes(qForm.question_type);
    const options = isChoice
      ? [
          { label: qForm.option_a, value: "a" },
          { label: qForm.option_b, value: "b" },
          { label: qForm.option_c, value: "c" },
          { label: qForm.option_d, value: "d" },
        ].filter((opt) => opt.label.trim())
      : [];
    const correctAnswer = isChoice ? qForm.correct : null;
    const result = await addLmsQuizQuestion(quizId, {
      question_text: qForm.question_text,
      question_type: qForm.question_type,
      options_json: options,
      correct_answer_json: correctAnswer,
      points: Number(qForm.points) || 1,
    });
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setQForm({ question_text: "", question_type: "single_choice", option_a: "", option_b: "", option_c: "", option_d: "", correct: "a", points: "1" });
    setStatus({ type: "success", message: "تمت إضافة السؤال" });
    await onQuestionAdded();
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-sm">{str(quiz, "title")}</span>
          <span className="mr-2 text-xs text-slate-500">({questions.length} سؤال • نجاح: {num(quiz, "passing_score")}%)</span>
        </div>
        <div className="flex gap-2">
          <Button size="xs" variant="outline" onClick={() => setOpen(!open)}>
            {open ? "إغلاق" : "الأسئلة"}
          </Button>
          <Button size="xs" variant="ghost" className="text-rose-500 hover:text-rose-700" onClick={onDelete}>
            حذف
          </Button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          {status && <Message status={status} />}
          {questions.map((q, idx) => (
            <div key={str(q, "id")} className="flex items-start justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm gap-2">
              <span className="flex-1">{idx + 1}. {str(q, "question_text")}</span>
              <Button
                size="xs"
                variant="ghost"
                className="text-rose-500 hover:text-rose-700 shrink-0"
                onClick={() => void deleteLmsQuizQuestion(str(q, "id")).then(() => onQuestionAdded())}
              >
                حذف
              </Button>
            </div>
          ))}
          <form className="grid gap-2" onSubmit={submitQuestion}>
            <textarea
              className="min-h-16 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={qForm.question_text}
              onChange={(e) => setQForm({ ...qForm, question_text: e.target.value })}
              placeholder="نص السؤال"
              required
            />
            <div className="grid gap-2 md:grid-cols-2">
              <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={qForm.question_type} onChange={(e) => setQForm({ ...qForm, question_type: e.target.value })}>
                <option value="single_choice">اختيار واحد</option>
                <option value="multiple_choice">اختيار متعدد</option>
                <option value="true_false">صح / خطأ</option>
                <option value="short_answer">إجابة قصيرة</option>
              </select>
              <Input type="number" min="1" value={qForm.points} onChange={(e) => setQForm({ ...qForm, points: e.target.value })} placeholder="الدرجات" />
            </div>
            {["single_choice", "multiple_choice"].includes(qForm.question_type) && (
              <div className="grid gap-2 md:grid-cols-2">
                <Input placeholder="خيار أ" value={qForm.option_a} onChange={(e) => setQForm({ ...qForm, option_a: e.target.value })} />
                <Input placeholder="خيار ب" value={qForm.option_b} onChange={(e) => setQForm({ ...qForm, option_b: e.target.value })} />
                <Input placeholder="خيار ج" value={qForm.option_c} onChange={(e) => setQForm({ ...qForm, option_c: e.target.value })} />
                <Input placeholder="خيار د" value={qForm.option_d} onChange={(e) => setQForm({ ...qForm, option_d: e.target.value })} />
                <div className="md:col-span-2 flex items-center gap-2 text-sm">
                  <Label>الإجابة الصحيحة:</Label>
                  <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={qForm.correct} onChange={(e) => setQForm({ ...qForm, correct: e.target.value })}>
                    <option value="a">أ</option>
                    <option value="b">ب</option>
                    <option value="c">ج</option>
                    <option value="d">د</option>
                  </select>
                </div>
              </div>
            )}
            {qForm.question_type === "true_false" && (
              <div className="flex items-center gap-4 text-sm">
                <Label>الإجابة الصحيحة:</Label>
                <label className="flex items-center gap-1"><input type="radio" checked={qForm.correct === "true"} onChange={() => setQForm({ ...qForm, correct: "true" })} /> صح</label>
                <label className="flex items-center gap-1"><input type="radio" checked={qForm.correct === "false"} onChange={() => setQForm({ ...qForm, correct: "false" })} /> خطأ</label>
              </div>
            )}
            <Button type="submit" size="sm">إضافة سؤال</Button>
          </form>
        </div>
      )}
    </div>
  );
}

const allowedRichTextTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "font",
  "h1",
  "h2",
  "h3",
  "i",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "u",
  "ul",
]);

function stripUnsafeRichText(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
    .replace(/\sstyle=(["'])[^"']*(expression|javascript:|url\()[^"']*\1/gi, "");
}

function cleanRichTextStyle(value: string) {
  const allowed = new Set(["color", "font-size", "font-style", "font-weight", "text-align", "text-decoration"]);
  return value
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => {
      const [property, ...rest] = rule.split(":");
      const cssValue = rest.join(":").trim().toLowerCase();
      return allowed.has(property.trim().toLowerCase()) && !/(expression|javascript:|url\()/i.test(cssValue);
    })
    .join("; ");
}

function sanitizeRichTextHtml(html: string) {
  if (!html) return "";
  const stripped = stripUnsafeRichText(html);
  if (typeof document === "undefined" || typeof Node === "undefined") return stripped;

  const template = document.createElement("template");
  template.innerHTML = stripped;

  function walk(node: ParentNode) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (!allowedRichTextTags.has(tag)) {
        const parent = element.parentNode;
        while (element.firstChild) parent?.insertBefore(element.firstChild, element);
        parent?.removeChild(element);
        return;
      }

      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name === "style") {
          const cleaned = cleanRichTextStyle(value);
          if (cleaned) element.setAttribute("style", cleaned);
          else element.removeAttribute("style");
          return;
        }
        if (tag === "a" && name === "href" && /^(https?:|mailto:|tel:|#|\/)/i.test(value)) return;
        if (tag === "font" && name === "size" && /^[1-7]$/.test(value)) return;
        if (name === "dir" && /^(rtl|ltr|auto)$/i.test(value)) return;
        element.removeAttribute(attribute.name);
      });

      if (tag === "a") {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer");
      }

      walk(element);
    });
  }

  walk(template.content);
  return template.innerHTML;
}

const richTextSurfaceClassName =
  "leading-7 text-slate-700 [&_a]:text-brand [&_a]:underline [&_blockquote]:border-r-4 [&_blockquote]:border-brand/40 [&_blockquote]:bg-slate-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-slate-600 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-950 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-950 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pr-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pr-6";

function RichTextToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RichTextLessonEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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
          className={cn("min-h-[260px] w-full bg-white px-4 py-4 text-sm outline-none focus:ring-2 focus:ring-brand/20", richTextSurfaceClassName)}
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

function RichLessonContent({ html, fallbackUrl }: { html: string; fallbackUrl?: string }) {
  const safeHtml = sanitizeRichTextHtml(html);
  if (!safeHtml && fallbackUrl) {
    return (
      <a className="mt-3 inline-flex text-sm font-medium text-brand underline-offset-4 hover:underline" href={fallbackUrl} target="_blank" rel="noreferrer">
        فتح رابط الدرس
      </a>
    );
  }
  if (!safeHtml) return null;
  return (
    <div
      className={cn("mt-3 rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm", richTextSurfaceClassName)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

export function LmsCourseEditorScreen({ courseId }: { courseId?: string }) {
  const editing = Boolean(courseId);
  const [course, setCourse] = useState<Row | null>(null);
  const [categories, setCategories] = useState<Row[]>([]);
  const [form, setForm] = useState<CourseFormState>(blankCourseForm);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(editing);
  const [sectionTitle, setSectionTitle] = useState("");
  const [lesson, setLesson] = useState({ section_id: "", title: "", lesson_type: "text", content: "", content_url: "", duration_minutes: "10" });
  const [quiz, setQuiz] = useState({ lesson_id: "", title: "", passing_score: "70", max_attempts: "3" });
  const [task, setTask] = useState({ lesson_id: "", title: "", task_type: "text_response", instructions: "", max_score: "100", pass_score: "60", is_required: true });
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [categoriesResult, courseResult] = await Promise.all([
        getLmsCategories(),
        courseId ? getLmsCourse(courseId) : Promise.resolve({ data: null, error: null }),
      ]);
      setCategories(rows(categoriesResult.data));
      const loaded = asRow(courseResult.data);
      if (courseId && courseResult.error) setStatus({ type: "error", message: courseResult.error.message });
      if (courseId && loaded.id) {
        setCourse(loaded);
        setForm({
          title: str(loaded, "title"),
          description: str(loaded, "description"),
          category_id: str(loaded, "category_id"),
          visibility: str(loaded, "visibility", "assigned_only"),
          difficulty: str(loaded, "difficulty", "beginner"),
          estimated_minutes: String(num(loaded, "estimated_minutes", 60)),
          passing_score: String(num(loaded, "passing_score", 70)),
          requires_quiz_pass: bool(loaded, "requires_quiz_pass"),
          requires_task_pass: bool(loaded, "requires_task_pass"),
        });
      }
      setLoading(false);
    }
    void load();
  }, [courseId]);

  async function reloadCourse() {
    if (!courseId && !createdCourseId) return;
    const result = await getLmsCourse(courseId || createdCourseId || "");
    setCourse(asRow(result.data));
  }

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      ...form,
      category_id: form.category_id || null,
      estimated_minutes: Number(form.estimated_minutes || 0),
      passing_score: Number(form.passing_score || 0),
    };
    const result = editing && courseId ? await updateLmsCourse(courseId, payload) : await createLmsCourse(payload);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    const saved = asRow(result.data);
    setCourse(saved);
    setCreatedCourseId(str(saved, "id"));
    setStatus({ type: "success", message: editing ? "تم تحديث الدورة" : "تم إنشاء الدورة" });
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || createdCourseId;
    if (!id || !sectionTitle.trim()) return;
    const result = await createLmsSection(id, { title: sectionTitle.trim(), sort_order: rows(course?.sections).length + 1 });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تمت إضافة القسم" });
    if (!result.error) {
      setSectionTitle("");
      await reloadCourse();
    }
  }

  async function addLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || createdCourseId;
    if (!id || !lesson.title.trim()) return;
    const payload: Row = {
      ...lesson,
      content: sanitizeRichTextHtml(lesson.content),
      duration_minutes: Number(lesson.duration_minutes || 0),
      is_required: true,
      is_active: true,
      sort_order: rows(course?.lessons).length + 1,
    };
    if (!payload.section_id) delete payload.section_id;
    const result = await createLmsLesson(id, payload);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    const savedLesson = asRow(result.data);
    if (uploadFile) {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("course_id", id);
      formData.set("lesson_id", str(savedLesson, "id"));
      formData.set("target", "lesson");
      await uploadLmsContent(formData);
    }
    setLesson({ section_id: "", title: "", lesson_type: "text", content: "", content_url: "", duration_minutes: "10" });
    setUploadFile(null);
    setStatus({ type: "success", message: "تمت إضافة الدرس" });
    await reloadCourse();
  }

  async function addQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || createdCourseId;
    if (!id || !quiz.title.trim()) return;
    const payload: Row = {
      ...quiz,
      passing_score: Number(quiz.passing_score || 0),
      max_attempts: Number(quiz.max_attempts || 0),
      is_required: true,
      is_active: true,
      questions: [],
    };
    if (!payload.lesson_id) delete payload.lesson_id;
    const result = await createLmsQuiz(id, payload);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تمت إضافة الاختبار" });
    if (!result.error) {
      setQuiz({ lesson_id: "", title: "", passing_score: "70", max_attempts: "3" });
      await reloadCourse();
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || createdCourseId;
    if (!id || !task.title.trim()) return;
    const payload: Row = {
      ...task,
      status: "published",
      max_score: Number(task.max_score || 0),
      pass_score: Number(task.pass_score || 0),
    };
    if (!payload.lesson_id) delete payload.lesson_id;
    const result = await createLmsTask(id, payload);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تمت إضافة المهمة" });
    if (!result.error) {
      setTask({ lesson_id: "", title: "", task_type: "text_response", instructions: "", max_score: "100", pass_score: "60", is_required: true });
      await reloadCourse();
    }
  }

  async function addAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || createdCourseId;
    if (!id || !announcement.title.trim()) return;
    const result = await createLmsAnnouncement(id, { ...announcement, pinned: false });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم نشر الإعلان" });
    if (!result.error) setAnnouncement({ title: "", body: "" });
  }

  if (loading) return <PageSkeleton />;

  const usableCourseId = courseId || createdCourseId;
  const sections = rows(course?.sections);
  const lessons = rows(course?.lessons);
  const quizzes = rows(course?.quizzes);
  const tasks = rows(course?.tasks);

  return (
    <div className="space-y-6">
      <PageHeader
        title={editing ? "تحرير الدورة" : "إنشاء دورة"}
        description="إعداد دورة تدريبية داخلية من خلال تبويبات واضحة لكل جزء."
        action={usableCourseId ? <Button asChild variant="outline"><Link href={`/lms/courses/${usableCourseId}/instructors`}>المدربون</Link></Button> : null}
      />
      <Message status={status} />
      <Tabs defaultValue="course-data" className="flex-col gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start rounded-lg bg-white p-1 shadow-sm">
          <TabsTrigger value="course-data" className="h-10 gap-2 px-4 data-active:bg-brand data-active:text-white">
            <FileText className="h-4 w-4" />
            بيانات الدورة
          </TabsTrigger>
          <TabsTrigger value="content" disabled={!usableCourseId} className="h-10 gap-2 px-4 data-active:bg-brand data-active:text-white">
            <BookOpen className="h-4 w-4" />
            المحتوى
            <Badge className="border border-slate-200 bg-slate-50 text-slate-600">{lessons.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="quizzes" disabled={!usableCourseId} className="h-10 gap-2 px-4 data-active:bg-brand data-active:text-white">
            <ClipboardCheck className="h-4 w-4" />
            الاختبارات
            <Badge className="border border-slate-200 bg-slate-50 text-slate-600">{quizzes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="tasks" disabled={!usableCourseId} className="h-10 gap-2 px-4 data-active:bg-brand data-active:text-white">
            <Send className="h-4 w-4" />
            المهام والإعلانات
            <Badge className="border border-slate-200 bg-slate-50 text-slate-600">{tasks.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {!usableCourseId ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            احفظ بيانات الدورة أولاً لتفعيل تبويبات المحتوى والاختبارات والمهام.
          </div>
        ) : null}

        <TabsContent value="course-data" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <form onSubmit={saveCourse}>
              <Card>
                <CardHeader>
                  <CardTitle>بيانات الدورة</CardTitle>
                  <CardDescription>العنوان والتصنيف وشروط إكمال الدورة.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>العنوان</Label>
                    <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>الوصف</Label>
                    <textarea
                      className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>التصنيف</Label>
                    <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
                      <option value="">بدون تصنيف</option>
                      {categories.map((category) => <option key={str(category, "id")} value={str(category, "id")}>{str(category, "name")}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>الظهور</Label>
                    <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
                      <option value="assigned_only">مخصصة</option>
                      <option value="catalog">كتالوج</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>المستوى</Label>
                    <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>
                      <option value="beginner">مبتدئ</option>
                      <option value="intermediate">متوسط</option>
                      <option value="advanced">متقدم</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>المدة بالدقائق</Label>
                    <Input type="number" min="1" value={form.estimated_minutes} onChange={(event) => setForm({ ...form, estimated_minutes: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>درجة النجاح</Label>
                    <Input type="number" min="0" max="100" value={form.passing_score} onChange={(event) => setForm({ ...form, passing_score: event.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={form.requires_quiz_pass} onChange={(event) => setForm({ ...form, requires_quiz_pass: event.target.checked })} />
                    يتطلب اجتياز اختبار
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={form.requires_task_pass} onChange={(event) => setForm({ ...form, requires_task_pass: event.target.checked })} />
                    يتطلب قبول مهمة
                  </label>
                  <div className="md:col-span-2">
                    <Button type="submit">{editing ? "حفظ التغييرات" : "إنشاء الدورة"}</Button>
                  </div>
                </CardContent>
              </Card>
            </form>

            <Card>
              <CardHeader>
                <CardTitle>حالة الدورة</CardTitle>
                <CardDescription>ملخص سريع قبل النشر.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusBadge value={course?.status || "draft"} />
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">الأقسام</div>
                    <div className="mt-1 font-semibold">{sections.length}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">الدروس</div>
                    <div className="mt-1 font-semibold">{lessons.length}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">الاختبارات</div>
                    <div className="mt-1 font-semibold">{quizzes.length}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">المهام</div>
                    <div className="mt-1 font-semibold">{tasks.length}</div>
                  </div>
                </div>
                {usableCourseId ? <Button className="w-full" onClick={() => void publishLmsCourse(usableCourseId).then(() => reloadCourse())} type="button">نشر الدورة</Button> : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          {usableCourseId ? (
            <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>أقسام الدورة</CardTitle>
                  <CardDescription>قسّم المسار إلى وحدات سهلة التصفح.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="flex gap-2" onSubmit={addSection}>
                    <Input value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} placeholder="عنوان القسم" />
                    <Button type="submit" size="icon" aria-label="إضافة قسم"><Plus className="h-4 w-4" /></Button>
                  </form>
                  <div className="space-y-2">
                    {sections.map((section, index) => (
                      <div key={str(section, "id")} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-500">{index + 1}</span>
                        <span className="font-medium text-slate-800">{str(section, "title")}</span>
                      </div>
                    ))}
                    {sections.length === 0 ? <p className="text-sm text-slate-400">لا توجد أقسام بعد.</p> : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>محتوى الدرس</CardTitle>
                  <CardDescription>اكتب النص بتنسيق غني أو أضف فيديو/مستند/رابط للدرس.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <form className="grid gap-4" onSubmit={addLesson}>
                    <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
                      <Input value={lesson.title} onChange={(event) => setLesson({ ...lesson, title: event.target.value })} placeholder="عنوان الدرس" />
                      <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={lesson.section_id} onChange={(event) => setLesson({ ...lesson, section_id: event.target.value })}>
                        <option value="">بدون قسم</option>
                        {sections.map((section) => <option key={str(section, "id")} value={str(section, "id")}>{str(section, "title")}</option>)}
                      </select>
                      <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={lesson.lesson_type} onChange={(event) => setLesson({ ...lesson, lesson_type: event.target.value })}>
                        <option value="text">نص</option>
                        <option value="video">فيديو</option>
                        <option value="document">مستند</option>
                        <option value="file">ملف</option>
                        <option value="link">رابط</option>
                      </select>
                    </div>
                    <RichTextLessonEditor value={lesson.content} onChange={(content) => setLesson({ ...lesson, content })} />
                    <div className="grid gap-3 md:grid-cols-[1fr_160px_220px]">
                      <Input value={lesson.content_url} onChange={(event) => setLesson({ ...lesson, content_url: event.target.value })} placeholder="رابط خارجي اختياري" />
                      <Input type="number" value={lesson.duration_minutes} onChange={(event) => setLesson({ ...lesson, duration_minutes: event.target.value })} placeholder="المدة" />
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600">
                        <UploadCloud className="h-4 w-4" />
                        <span className="truncate">{uploadFile ? uploadFile.name : "رفع ملف خاص"}</span>
                        <input className="sr-only" type="file" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
                      </label>
                    </div>
                    <Button type="submit" className="w-fit">إضافة درس</Button>
                  </form>

                  <div className="space-y-2 border-t border-slate-100 pt-4">
                    {lessons.map((item) => (
                      <div key={str(item, "id")} className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-medium text-slate-900">{str(item, "title")}</div>
                          <div className="mt-1 text-xs text-slate-500">{num(item, "duration_minutes")} دقيقة</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="border border-slate-200 bg-white text-slate-600">{lessonTypeLabels[str(item, "lesson_type")]}</Badge>
                          <Button size="xs" variant="ghost" onClick={() => void deleteLmsLesson(str(item, "id")).then(() => reloadCourse())} className="text-rose-500 hover:text-rose-700">حذف</Button>
                        </div>
                      </div>
                    ))}
                    {lessons.length === 0 ? <p className="text-sm text-slate-400">لا توجد دروس بعد.</p> : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="quizzes" className="space-y-4">
          {usableCourseId ? (
            <Card>
              <CardHeader>
                <CardTitle>الاختبارات</CardTitle>
                <CardDescription>اختبارات مرتبطة بالدورة أو بدرس محدد.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="grid gap-3 md:grid-cols-2" onSubmit={addQuiz}>
                  <Input className="md:col-span-2" value={quiz.title} onChange={(event) => setQuiz({ ...quiz, title: event.target.value })} placeholder="عنوان الاختبار" />
                  <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={quiz.lesson_id} onChange={(event) => setQuiz({ ...quiz, lesson_id: event.target.value })}>
                    <option value="">على مستوى الدورة</option>
                    {lessons.map((item) => <option key={str(item, "id")} value={str(item, "id")}>{str(item, "title")}</option>)}
                  </select>
                  <Input type="number" placeholder="درجة النجاح %" value={quiz.passing_score} onChange={(event) => setQuiz({ ...quiz, passing_score: event.target.value })} />
                  <Input type="number" placeholder="عدد المحاولات" value={quiz.max_attempts} onChange={(event) => setQuiz({ ...quiz, max_attempts: event.target.value })} />
                  <Button type="submit" className="w-fit">إضافة اختبار</Button>
                </form>
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  {quizzes.map((item) => (
                    <QuizQuestionBuilder
                      key={str(item, "id")}
                      quiz={item}
                      onDelete={() => void deleteLmsQuiz(str(item, "id")).then(() => reloadCourse())}
                      onQuestionAdded={() => reloadCourse()}
                    />
                  ))}
                  {quizzes.length === 0 ? <p className="text-sm text-slate-400">لا توجد اختبارات بعد.</p> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          {usableCourseId ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>المهام</CardTitle>
                  <CardDescription>مشاريع أو واجبات مرتبطة بإكمال الدورة.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <form className="grid gap-3" onSubmit={addTask}>
                    <Input value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} placeholder="عنوان المهمة" />
                    <textarea className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm" value={task.instructions} onChange={(event) => setTask({ ...task, instructions: event.target.value })} placeholder="تعليمات المهمة" />
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={task.task_type} onChange={(event) => setTask({ ...task, task_type: event.target.value })}>
                        <option value="text_response">نص</option>
                        <option value="file_upload">ملف</option>
                        <option value="link_submission">رابط</option>
                        <option value="mixed">مختلط</option>
                      </select>
                      <Input type="number" value={task.max_score} onChange={(event) => setTask({ ...task, max_score: event.target.value })} placeholder="الدرجة" />
                      <Input type="number" value={task.pass_score} onChange={(event) => setTask({ ...task, pass_score: event.target.value })} placeholder="درجة النجاح" />
                    </div>
                    <Button type="submit" className="w-fit">إضافة مهمة</Button>
                  </form>
                  <div className="space-y-2 border-t border-slate-100 pt-4">
                    {tasks.map((item) => (
                      <div key={str(item, "id")} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-900">{str(item, "title")}</span>
                        <Button size="xs" variant="ghost" onClick={() => void deleteLmsTask(str(item, "id")).then(() => reloadCourse())} className="text-rose-500 hover:text-rose-700">حذف</Button>
                      </div>
                    ))}
                    {tasks.length === 0 ? <p className="text-sm text-slate-400">لا توجد مهام بعد.</p> : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>الإعلانات</CardTitle>
                  <CardDescription>رسائل تظهر للمتعلمين داخل مجتمع الدورة.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-3" onSubmit={addAnnouncement}>
                    <Input value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} placeholder="عنوان الإعلان" />
                    <textarea className="min-h-32 rounded-lg border border-input bg-background px-3 py-2 text-sm" value={announcement.body} onChange={(event) => setAnnouncement({ ...announcement, body: event.target.value })} placeholder="نص الإعلان" />
                    <Button type="submit" variant="outline" className="w-fit">نشر إعلان</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function LmsCourseInstructorsScreen({ courseId }: { courseId: string }) {
  const [instructors, setInstructors] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Row[]>([]);
  const [form, setForm] = useState({ employee_id: "", instructor_type: "primary_instructor", can_edit_content: true, can_review_tasks: true, can_moderate_community: true });
  const [status, setStatus] = useState<StatusMessage>(null);

  const load = useCallback(async () => {
    const [instrResult, empResult] = await Promise.all([getLmsInstructors(courseId), getLmsOrgEmployees()]);
    setInstructors(rows(instrResult.data));
    setEmployees(rows(empResult.data));
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await createLmsInstructor(courseId, form);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم تعيين المدرب" });
    if (!result.error) {
      setForm({ employee_id: "", instructor_type: "primary_instructor", can_edit_content: true, can_review_tasks: true, can_moderate_community: true });
      await load();
    }
  }

  async function remove(instructorId: string) {
    const result = await removeLmsInstructor(courseId, instructorId);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم إزالة المدرب" });
    if (!result.error) await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="المدربون" description="مدربو الدورة وصلاحيات المحتوى والمراجعة والمجتمع." action={<Button asChild variant="outline"><Link href={`/lms/courses/${courseId}/edit`}>الدورة</Link></Button>} />
      <Message status={status} />
      <Card>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-5" onSubmit={submit}>
            <div className="space-y-2 md:col-span-2">
              <Label>الموظف</Label>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={form.employee_id}
                onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
                required
              >
                <option value="">اختر موظفاً...</option>
                {employees.map((emp) => (
                  <option key={str(emp, "id")} value={str(emp, "id")}>
                    {str(emp, "full_name")} {str(emp, "employee_code") ? `(${str(emp, "employee_code")})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>النوع</Label>
              <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.instructor_type} onChange={(event) => setForm({ ...form, instructor_type: event.target.value })}>
                <option value="primary_instructor">مدرب رئيسي</option>
                <option value="assistant_instructor">مدرب مساعد</option>
                <option value="reviewer">مراجع</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_edit_content} onChange={(event) => setForm({ ...form, can_edit_content: event.target.checked })} /> المحتوى</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_review_tasks} onChange={(event) => setForm({ ...form, can_review_tasks: event.target.checked })} /> المراجعة</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.can_moderate_community} onChange={(event) => setForm({ ...form, can_moderate_community: event.target.checked })} /> المجتمع</label>
            <div className="md:col-span-5"><Button type="submit"><Users className="h-4 w-4" /> تعيين</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المحتوى</TableHead>
                <TableHead>المراجعة</TableHead>
                <TableHead>المجتمع</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructors.map((item) => {
                const employee = asRow(item.employee);
                return (
                  <TableRow key={str(item, "id")}>
                    <TableCell>{str(employee, "full_name") || str(item, "employee_id")}</TableCell>
                    <TableCell>{str(item, "instructor_type")}</TableCell>
                    <TableCell>{bool(item, "can_edit_content") ? "نعم" : "لا"}</TableCell>
                    <TableCell>{bool(item, "can_review_tasks") ? "نعم" : "لا"}</TableCell>
                    <TableCell>{bool(item, "can_moderate_community") ? "نعم" : "لا"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="destructive" onClick={() => void remove(str(item, "id"))}>إزالة</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {instructors.length === 0 ? <EmptyState title="لا يوجد مدربون لهذه الدورة" /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function LmsCourseTasksScreen({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Row | null>(null);
  const [form, setForm] = useState({ title: "", task_type: "text_response", instructions: "", max_score: "100", pass_score: "60", is_required: true });
  const [status, setStatus] = useState<StatusMessage>(null);

  const load = useCallback(async () => {
    const result = await getLmsCourse(courseId);
    setCourse(asRow(result.data));
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await createLmsTask(courseId, {
      ...form,
      max_score: Number(form.max_score || 0),
      pass_score: Number(form.pass_score || 0),
      status: "published",
    });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم إنشاء المهمة" });
    if (!result.error) {
      setForm({ title: "", task_type: "text_response", instructions: "", max_score: "100", pass_score: "60", is_required: true });
      await load();
    }
  }

  const tasks = rows(course?.tasks);

  return (
    <div className="space-y-6">
      <PageHeader title="المهام" description={str(course || {}, "title")} action={<Button asChild variant="outline"><Link href={`/lms/courses/${courseId}/submissions`}>التسليمات</Link></Button>} />
      <Message status={status} />
      <Card>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="عنوان المهمة" required />
            <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={form.task_type} onChange={(event) => setForm({ ...form, task_type: event.target.value })}>
              <option value="text_response">نص</option>
              <option value="file_upload">ملف</option>
              <option value="link_submission">رابط</option>
              <option value="mixed">مختلط</option>
            </select>
            <textarea className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm md:col-span-2" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="تعليمات المهمة" />
            <Input type="number" value={form.max_score} onChange={(event) => setForm({ ...form, max_score: event.target.value })} />
            <Input type="number" value={form.pass_score} onChange={(event) => setForm({ ...form, pass_score: event.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_required} onChange={(event) => setForm({ ...form, is_required: event.target.checked })} /> مهمة مطلوبة</label>
            <Button type="submit">إنشاء المهمة</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {tasks.map((item) => <CourseTaskCard key={str(item, "id")} task={item} courseId={courseId} />)}
      </div>
      {tasks.length === 0 ? <EmptyState title="لا توجد مهام لهذه الدورة" /> : null}
    </div>
  );
}

function CourseTaskCard({ task, courseId }: { task: Row; courseId: string }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-950">{str(task, "title")}</h3>
          <StatusBadge value={task.status} />
        </div>
        <p className="line-clamp-3 text-sm text-slate-500">{str(task, "instructions") || str(task, "description")}</p>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span>الدرجة: {num(task, "max_score")}</span>
          <span>النجاح: {num(task, "pass_score")}</span>
        </div>
        <Button asChild variant="outline" size="sm"><Link href={`/lms/courses/${courseId}/submissions?task=${str(task, "id")}`}>التسليمات</Link></Button>
      </CardContent>
    </Card>
  );
}

export function LmsSubmissionsScreen({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Row | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [submissions, setSubmissions] = useState<Row[]>([]);
  const [reviews, setReviews] = useState<Record<string, { score: string; review_status: string; feedback: string }>>({});
  const [status, setStatus] = useState<StatusMessage>(null);

  function getReview(submissionId: string) {
    return reviews[submissionId] ?? { score: "100", review_status: "accepted", feedback: "" };
  }

  function setReview(submissionId: string, patch: Partial<{ score: string; review_status: string; feedback: string }>) {
    setReviews((prev) => ({ ...prev, [submissionId]: { ...getReview(submissionId), ...patch } }));
  }

  useEffect(() => {
    async function loadCourse() {
      const result = await getLmsCourse(courseId);
      const loaded = asRow(result.data);
      setCourse(loaded);
      const firstTask = rows(loaded.tasks)[0];
      setSelectedTaskId(str(firstTask, "id"));
    }
    void loadCourse();
  }, [courseId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void getLmsTaskSubmissions(selectedTaskId).then((result) => setSubmissions(rows(result.data)));
  }, [selectedTaskId]);

  async function submitReview(submissionId: string) {
    const rev = getReview(submissionId);
    const result = await reviewLmsSubmission(submissionId, {
      ...rev,
      score: Number(rev.score || 0),
      passed: rev.review_status === "accepted",
    });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم حفظ المراجعة" });
    if (!result.error && selectedTaskId) {
      const refreshed = await getLmsTaskSubmissions(selectedTaskId);
      setSubmissions(rows(refreshed.data));
    }
  }

  const tasks = rows(course?.tasks);

  return (
    <div className="space-y-6">
      <PageHeader title="تسليمات المهام" description={str(course || {}, "title")} />
      <Message status={status} />
      <Card>
        <CardContent className="space-y-4">
          <select className="h-9 w-full max-w-md rounded-lg border border-input bg-background px-3 text-sm" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
            {tasks.map((task) => <option key={str(task, "id")} value={str(task, "id")}>{str(task, "title")}</option>)}
          </select>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>النص</TableHead>
                <TableHead>الدرجة</TableHead>
                <TableHead>المراجعة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((item) => {
                const submissionId = str(item, "id");
                const rev = getReview(submissionId);
                const employee = asRow(item.employee);
                return (
                  <TableRow key={submissionId}>
                    <TableCell>{str(employee, "full_name") || str(item, "employee_id")}</TableCell>
                    <TableCell><StatusBadge value={item.status} /></TableCell>
                    <TableCell className="max-w-xs truncate">{str(item, "submission_text") || str(item, "submission_url")}</TableCell>
                    <TableCell>
                      <Input className="w-20" type="number" value={rev.score} onChange={(event) => setReview(submissionId, { score: event.target.value })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <select
                          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                          value={rev.review_status}
                          onChange={(event) => setReview(submissionId, { review_status: event.target.value })}
                        >
                          <option value="accepted">قبول</option>
                          <option value="needs_revision">تعديل</option>
                          <option value="rejected">رفض</option>
                        </select>
                        <Input className="w-48" value={rev.feedback} onChange={(event) => setReview(submissionId, { feedback: event.target.value })} placeholder="التغذية الراجعة" />
                        <Button size="sm" onClick={() => void submitReview(submissionId)}>حفظ</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {submissions.length === 0 ? <EmptyState title="لا توجد تسليمات لهذه المهمة" /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function LmsPlayerScreen({ enrollmentId }: { enrollmentId: string }) {
  const [enrollment, setEnrollment] = useState<Row | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [taskForm, setTaskForm] = useState({ submission_text: "", submission_url: "" });
  const [feedback, setFeedback] = useState({ rating: "5", comment: "" });
  const [status, setStatus] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(true);
  const [quizResults, setQuizResults] = useState<Record<string, Row>>({});

  const load = useCallback(async () => {
    const result = await getLmsEnrollment(enrollmentId);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    const data = asRow(result.data);
    setEnrollment(data);
    // Map latest attempt per quiz
    const attempts = rows(data.attempts);
    const latest: Record<string, Row> = {};
    for (const attempt of attempts) {
      const qid = str(attempt, "quiz_id");
      const existing = latest[qid];
      if (!existing || num(attempt, "attempt_number") > num(existing, "attempt_number")) {
        latest[qid] = attempt;
      }
    }
    setQuizResults(latest);
    setLoading(false);
  }, [enrollmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function complete(lessonId: string) {
    const result = await completeLmsLesson(enrollmentId, lessonId);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم تحديث التقدم" });
    if (!result.error) await load();
  }

  async function submitQuiz(quizId: string) {
    const result = await submitLmsQuiz(enrollmentId, quizId, answers);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
    } else {
      const attempt = asRow(asRow(result.data).attempt);
      setQuizResults((prev) => ({ ...prev, [quizId]: attempt }));
      setStatus({ type: "success", message: `تم تسليم الاختبار — الدرجة: ${num(attempt, "score")}% ${bool(attempt, "passed") ? "✓ ناجح" : "✗ راسب"}` });
      await load();
    }
  }

  async function submitTask(taskId: string) {
    const result = await submitLmsTask(enrollmentId, taskId, taskForm);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم تسليم المهمة" });
    if (!result.error) {
      setTaskForm({ submission_text: "", submission_url: "" });
      await load();
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await submitLmsFeedback(enrollmentId, { rating: Number(feedback.rating), comment: feedback.comment });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم إرسال التقييم" });
  }

  if (loading) return <PageSkeleton />;

  const course = getCourseFromEnrollment(enrollment || {});
  const lessons = rows(course.lessons);
  const quizzes = rows(course.quizzes);
  const tasks = rows(course.tasks);
  const progress = rows(enrollment?.progress);
  const completedLessonIds = new Set(progress.filter((item) => str(item, "status") === "completed").map((item) => str(item, "lesson_id")));

  return (
    <div className="space-y-6">
      <PageHeader
        title={str(course, "title", "الدورة")}
        description={str(course, "description")}
        action={<Button asChild variant="outline"><Link href={`/lms/courses/${str(course, "id")}/community`}>المجتمع</Link></Button>}
      />
      <Message status={status} />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="التقدم" value={`${num(enrollment || {}, "progress_percent")}%`} icon={GraduationCap} tone="blue" />
        <StatCard title="الحالة" value={statusLabels[str(enrollment || {}, "status")] || "-"} icon={CheckCircle2} tone="green" />
        <StatCard title="الدروس" value={lessons.length} icon={BookOpen} />
        <StatCard title="المهام" value={tasks.length} icon={ClipboardCheck} tone="amber" />
      </div>
      <Card>
        <CardHeader><CardTitle>الدروس</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lessons.map((lessonItem) => {
            const id = str(lessonItem, "id");
            const completed = completedLessonIds.has(id);
            const lessonType = str(lessonItem, "lesson_type");
            const hasMedia = lessonType === "video" || lessonType === "file" || lessonType === "document";
            return (
              <div key={id} className="rounded-lg border border-slate-100 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{str(lessonItem, "title")}</h3>
                      <Badge className="border border-slate-200 bg-slate-50 text-slate-600">{lessonTypeLabels[lessonType]}</Badge>
                    </div>
                    {!hasMedia && <RichLessonContent html={str(lessonItem, "content")} fallbackUrl={str(lessonItem, "content_url")} />}
                    {hasMedia && <VideoLessonPlayer lesson={lessonItem} />}
                  </div>
                  <Button size="sm" variant={completed ? "outline" : "default"} onClick={() => void complete(id)}>
                    {completed ? "مكتمل" : "إكمال"}
                  </Button>
                </div>
              </div>
            );
          })}
          {lessons.length === 0 ? <EmptyState title="لا توجد دروس منشورة" /> : null}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>الاختبارات</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {quizzes.map((quizItem) => {
              const quizId = str(quizItem, "id");
              const questions = rows(quizItem.questions);
              const lastAttempt = quizResults[quizId];
              return (
                <div key={quizId} className="space-y-3 rounded-lg border border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{str(quizItem, "title")}</h3>
                    {lastAttempt && (
                      <Badge className={bool(lastAttempt, "passed") ? "border-emerald-200 bg-emerald-50 text-emerald-700 border" : "border-rose-200 bg-rose-50 text-rose-700 border"}>
                        {num(lastAttempt, "score")}% — {bool(lastAttempt, "passed") ? "ناجح" : "راسب"}
                      </Badge>
                    )}
                  </div>
                  {questions.map((question) => {
                    const questionId = str(question, "id");
                    const options = rows(question.options_json);
                    return (
                      <div key={questionId} className="space-y-2">
                        <Label>{str(question, "question_text")}</Label>
                        {options.length > 0 ? (
                          <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={String(answers[questionId] || "")} onChange={(event) => setAnswers({ ...answers, [questionId]: event.target.value })}>
                            <option value="">اختر إجابة</option>
                            {options.map((option, index) => <option key={index} value={str(option, "value") || str(option, "label")}>{str(option, "label") || str(option, "value")}</option>)}
                          </select>
                        ) : (
                          <Input value={String(answers[questionId] || "")} onChange={(event) => setAnswers({ ...answers, [questionId]: event.target.value })} />
                        )}
                      </div>
                    );
                  })}
                  {questions.length === 0 && <p className="text-sm text-slate-400">لا توجد أسئلة في هذا الاختبار بعد.</p>}
                  <Button size="sm" onClick={() => void submitQuiz(quizId)} disabled={questions.length === 0}>تسليم الاختبار</Button>
                </div>
              );
            })}
            {quizzes.length === 0 ? <EmptyState title="لا توجد اختبارات لهذه الدورة" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>المهام</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {tasks.map((taskItem) => (
              <div key={str(taskItem, "id")} className="space-y-3 rounded-lg border border-slate-100 p-4">
                <h3 className="font-semibold">{str(taskItem, "title")}</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-600">{str(taskItem, "instructions") || str(taskItem, "description")}</p>
                <textarea className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" value={taskForm.submission_text} onChange={(event) => setTaskForm({ ...taskForm, submission_text: event.target.value })} placeholder="نص التسليم" />
                <Input value={taskForm.submission_url} onChange={(event) => setTaskForm({ ...taskForm, submission_url: event.target.value })} placeholder="رابط التسليم" />
                <Button size="sm" onClick={() => void submitTask(str(taskItem, "id"))}>تسليم المهمة</Button>
              </div>
            ))}
            {tasks.length === 0 ? <EmptyState title="لا توجد مهام لهذه الدورة" /> : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>تقييم الدورة</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-[120px_1fr_auto]" onSubmit={submitFeedback}>
            <Input type="number" min="1" max="5" value={feedback.rating} onChange={(event) => setFeedback({ ...feedback, rating: event.target.value })} />
            <Input value={feedback.comment} onChange={(event) => setFeedback({ ...feedback, comment: event.target.value })} placeholder="تعليق" />
            <Button type="submit">إرسال</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function LmsCommunityScreen({ courseId }: { courseId?: string }) {
  const [dashboard, setDashboard] = useState<LmsLearnerDashboard | null>(null);
  const [posts, setPosts] = useState<Row[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState(courseId || "");
  const [form, setForm] = useState({ post_type: "discussion", title: "", body: "" });
  const [commentByPost, setCommentByPost] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusMessage>(null);

  useEffect(() => {
    if (courseId) return;
    void getLmsDashboard().then((result) => {
      if (result.data) {
        setDashboard(result.data);
        const first = rows(result.data.assigned)[0];
        const firstCourse = getCourseFromEnrollment(first);
        setSelectedCourseId(str(firstCourse, "id"));
      }
    });
  }, [courseId]);

  useEffect(() => {
    const id = courseId || selectedCourseId;
    if (!id) return;
    void getLmsCommunity(id).then((result) => setPosts(rows(result.data)));
  }, [courseId, selectedCourseId]);

  async function reload() {
    const id = courseId || selectedCourseId;
    if (!id) return;
    const result = await getLmsCommunity(id);
    setPosts(rows(result.data));
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = courseId || selectedCourseId;
    if (!id) return;
    const result = await createLmsPost(id, form);
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم نشر المشاركة" });
    if (!result.error) {
      setForm({ post_type: "discussion", title: "", body: "" });
      await reload();
    }
  }

  async function submitComment(postId: string) {
    const body = commentByPost[postId];
    if (!body?.trim()) return;
    const result = await createLmsComment(postId, { body });
    setStatus(result.error ? { type: "error", message: result.error.message } : { type: "success", message: "تم إضافة التعليق" });
    if (!result.error) {
      setCommentByPost({ ...commentByPost, [postId]: "" });
      await reload();
    }
  }

  const assignedCourses = rows(dashboard?.assigned).map((enrollment) => getCourseFromEnrollment(enrollment));

  return (
    <div className="space-y-6">
      <PageHeader title="مجتمع الدورة" description="النقاشات والأسئلة وإجابات المدربين." />
      <Message status={status} />
      {!courseId && assignedCourses.length > 0 ? (
        <select className="h-9 w-full max-w-md rounded-lg border border-input bg-background px-3 text-sm" value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)}>
          {assignedCourses.map((course) => <option key={str(course, "id")} value={str(course, "id")}>{str(course, "title")}</option>)}
        </select>
      ) : null}
      <Card>
        <CardContent>
          <form className="grid gap-3" onSubmit={submitPost}>
            <div className="grid gap-3 md:grid-cols-[180px_1fr]">
              <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={form.post_type} onChange={(event) => setForm({ ...form, post_type: event.target.value })}>
                <option value="discussion">نقاش</option>
                <option value="question">سؤال</option>
                <option value="announcement">إعلان</option>
              </select>
              <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="العنوان" required />
            </div>
            <textarea className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="النص" />
            <Button type="submit" className="w-fit"><Send className="h-4 w-4" /> نشر</Button>
          </form>
        </CardContent>
      </Card>
      <div className="space-y-4">
        {posts.map((post) => {
          const postId = str(post, "id");
          const comments = rows(post.comments);
          return (
            <Card key={postId}>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{str(post, "title")}</h3>
                      <Badge className="border border-slate-200 bg-slate-50 text-slate-600">{postTypeLabels[str(post, "post_type")]}</Badge>
                      {bool(post, "is_pinned") ? <Badge className="border border-amber-200 bg-amber-50 text-amber-700">مثبت</Badge> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{str(post, "body")}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void reactToLmsPost(postId).then(reload)}>تفاعل</Button>
                </div>
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {comments.map((comment) => (
                    <div key={str(comment, "id")} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-medium">{str(comment, "employee_id")}</span>
                        {bool(comment, "is_instructor_reply") ? <Badge className="border border-sky-200 bg-sky-50 text-sky-700">مدرب</Badge> : null}
                      </div>
                      {str(comment, "body")}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input value={commentByPost[postId] || ""} onChange={(event) => setCommentByPost({ ...commentByPost, [postId]: event.target.value })} placeholder="تعليق" />
                    <Button size="icon" variant="outline" onClick={() => void submitComment(postId)} aria-label="إرسال تعليق"><Send className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {posts.length === 0 ? <EmptyState title="لا توجد مشاركات بعد" /> : null}
    </div>
  );
}

export function LmsReportsScreen() {
  const { data, loading } = useLmsReports();
  const report = asRow(asRow(data).summary ?? data ?? {});
  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader title="تقارير التعلم" description="ملخصات الإدارة والتدريب والمدربين ضمن الصلاحيات." />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="مكلف" value={num(report, "assignedCourses")} icon={BookOpen} tone="blue" />
        <StatCard title="مكتمل" value={num(report, "completedCourses")} icon={CheckCircle2} tone="green" />
        <StatCard title="قيد التنفيذ" value={num(report, "inProgressCourses")} icon={GraduationCap} tone="amber" />
        <StatCard title="متأخر" value={num(report, "overdueCourses")} icon={ClipboardCheck} />
        <StatCard title="معدل الإكمال" value={`${num(report, "completionRate")}%`} icon={Award} tone="green" />
        <StatCard title="متوسط الاختبارات" value={`${num(report, "averageQuizScore")}%`} icon={FileText} tone="blue" />
        <StatCard title="تسليمات المهام" value={num(report, "taskSubmissions")} icon={ClipboardCheck} />
        <StatCard title="الشهادات" value={num(report, "certificates")} icon={Award} tone="amber" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>نشاط المجتمع والتقييمات</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm text-slate-500">مشاركات المجتمع</p>
            <p className="mt-2 text-2xl font-bold">{num(report, "communityPosts")}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm text-slate-500">معدل اجتياز المهام</p>
            <p className="mt-2 text-2xl font-bold">{num(report, "taskPassRate")}%</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm text-slate-500">متوسط تقييم الدورات</p>
            <p className="mt-2 text-2xl font-bold">{num(report, "feedbackAverage")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LmsCertificatesScreen() {
  const [certificates, setCertificates] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getLmsCertificates().then((result) => {
      setCertificates(rows(result.data));
      setLoading(false);
    });
  }, []);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader title="الشهادات" description="سجل شهادات إكمال الدورات." action={<Button variant="outline" onClick={() => window.print()}>طباعة</Button>} />
      <div className="grid gap-4 md:grid-cols-2">
        {certificates.map((certificate) => {
          const course = asRow(certificate.course);
          const employee = asRow(certificate.employee);
          return (
            <Card key={str(certificate, "id")} className="print:border print:shadow-none">
              <CardContent className="space-y-5 p-8 text-center">
                <Award className="mx-auto h-12 w-12 text-amber-500" />
                <div>
                  <p className="text-sm text-slate-500">شهادة إكمال</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-950">{str(course, "title", "دورة تدريبية")}</h2>
                </div>
                <div>
                  <p className="text-sm text-slate-500">ممنوحة إلى</p>
                  <p className="mt-1 text-xl font-semibold">{str(employee, "name") || str(certificate, "employee_id")}</p>
                </div>
                <div className="flex justify-center gap-6 text-sm text-slate-500">
                  <span>{dateText(certificate.issued_at)}</span>
                  <span>{str(certificate, "certificate_number")}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {certificates.length === 0 ? <EmptyState title="لا توجد شهادات بعد" /> : null}
    </div>
  );
}

export function LmsAssignmentsScreen() {
  const [courses, setCourses] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [form, setForm] = useState({ course_id: "", assignment_type: "employee", target_id: "", due_date: "" });
  const [status, setStatus] = useState<StatusMessage>(null);
  const { data: assignments, loading: assignmentsLoading, error: assignmentsError, refetch: refetchAssignments } = useLmsAssignments();

  const assignmentTypeLabels: Record<string, string> = {
    employee: "موظف", department: "قسم", location: "موقع", role: "دور", all: "الكل", team: "فريق",
  };

  // Load courses + all picker data on mount in parallel
  useEffect(() => {
    void Promise.all([
      getLmsCourses(),
      getLmsOrgEmployees(),
      getLmsOrgDepartments(),
      getLmsOrgLocations(),
    ]).then(([coursesRes, empRes, deptRes, locRes]) => {
      const loaded = rows(coursesRes.data);
      setCourses(loaded);
      setEmployees(rows(empRes.data));
      setDepartments(rows(deptRes.data));
      setLocations(rows(locRes.data));
      setForm((current) => ({ ...current, course_id: str(loaded[0] || {}, "id") }));
    });
  }, []);

  // Reset target_id when assignment type changes
  function handleTypeChange(newType: string) {
    setForm((current) => ({ ...current, assignment_type: newType, target_id: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.assignment_type !== "all" && !form.target_id) {
      setStatus({ type: "error", message: "يرجى تحديد الهدف المستهدف." });
      return;
    }
    const payload: Record<string, unknown> = { ...form };
    if (form.assignment_type === "all") delete payload.target_id;
    const result = await assignLmsCourse(payload);
    const createdCount = rows(asRow(result.data).enrollments).length;
    setStatus(result.error
      ? { type: "error", message: result.error.message }
      : {
          type: "success",
          message: createdCount > 0
            ? `تم إنشاء التكليف وتسجيل ${createdCount} موظف في الدورة.`
            : "تم إنشاء التكليف. جميع الموظفين المستهدفين لديهم التكليف مسبقاً.",
        }
    );
    if (!result.error) void refetchAssignments();
  }

  function renderTargetPicker() {
    if (form.assignment_type === "all") {
      return (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          سيتم تكليف جميع الموظفين النشطين في المؤسسة.
        </div>
      );
    }
    if (form.assignment_type === "employee") {
      return (
        <select
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={form.target_id}
          onChange={(e) => setForm({ ...form, target_id: e.target.value })}
          required
        >
          <option value="">اختر موظفاً...</option>
          {employees.map((emp) => (
            <option key={str(emp, "id")} value={str(emp, "id")}>
              {str(emp, "full_name")}
              {str(emp, "employee_code") ? ` (${str(emp, "employee_code")})` : ""}
            </option>
          ))}
        </select>
      );
    }
    if (form.assignment_type === "department") {
      return (
        <select
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={form.target_id}
          onChange={(e) => setForm({ ...form, target_id: e.target.value })}
          required
        >
          <option value="">اختر قسماً...</option>
          {departments.map((dept) => (
            <option key={str(dept, "id")} value={str(dept, "id")}>{str(dept, "name")}</option>
          ))}
        </select>
      );
    }
    if (form.assignment_type === "location" || form.assignment_type === "team") {
      return (
        <select
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={form.target_id}
          onChange={(e) => setForm({ ...form, target_id: e.target.value })}
          required
        >
          <option value="">اختر موقعاً...</option>
          {locations.map((loc) => (
            <option key={str(loc, "id")} value={str(loc, "id")}>{str(loc, "name")}</option>
          ))}
        </select>
      );
    }
    if (form.assignment_type === "role") {
      return (
        <Input
          value={form.target_id}
          onChange={(e) => setForm({ ...form, target_id: e.target.value })}
          placeholder="المسمى الوظيفي (مثال: مندوب مبيعات)"
          required
        />
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="تكليف التعلم" description="إسناد دورة للموظفين أو المجموعات ضمن الصلاحيات." />
      <Message status={status} />
      <Card>
        <CardHeader><CardTitle>إنشاء تكليف جديد</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
            <div className="space-y-2">
              <Label>الدورة</Label>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={form.course_id}
                onChange={(event) => setForm({ ...form, course_id: event.target.value })}
                required
              >
                <option value="">اختر دورة...</option>
                {courses.map((course) => (
                  <option key={str(course, "id")} value={str(course, "id")}>{str(course, "title")}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>نوع التكليف</Label>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={form.assignment_type}
                onChange={(event) => handleTypeChange(event.target.value)}
              >
                <option value="employee">موظف محدد</option>
                <option value="department">قسم كامل</option>
                <option value="location">موقع كامل</option>
                <option value="role">مسمى وظيفي</option>
                <option value="all">جميع الموظفين</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>
                {form.assignment_type === "employee" && "الموظف"}
                {form.assignment_type === "department" && "القسم"}
                {(form.assignment_type === "location" || form.assignment_type === "team") && "الموقع"}
                {form.assignment_type === "role" && "المسمى الوظيفي"}
                {form.assignment_type === "all" && "الهدف"}
              </Label>
              {renderTargetPicker()}
            </div>
            <div className="space-y-2">
              <Label>تاريخ الاستحقاق</Label>
              <Input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">إنشاء التكليف</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>التكليفات المنشأة</CardTitle></CardHeader>
        <CardContent>
          {assignmentsError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {assignmentsError}
            </div>
          )}
          {assignmentsLoading ? <PageSkeleton /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الدورة</TableHead>
                  <TableHead>نوع التكليف</TableHead>
                  <TableHead>الهدف</TableHead>
                  <TableHead>تاريخ الاستحقاق</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((item) => {
                  const course = asRow(item.course);
                  return (
                    <TableRow key={str(item, "id")}>
                      <TableCell className="font-medium">{str(course, "title") || str(item, "course_id")}</TableCell>
                      <TableCell>{assignmentTypeLabels[str(item, "assignment_type")] || str(item, "assignment_type")}</TableCell>
                      <TableCell>{str(item, "target_id") || "جميع الموظفين"}</TableCell>
                      <TableCell>{dateText(item.due_date)}</TableCell>
                      <TableCell>{dateText(item.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!assignmentsLoading && assignments.length === 0 && !assignmentsError && <EmptyState title="لا توجد تكليفات بعد" />}
        </CardContent>
      </Card>
    </div>
  );
}
