"use client";

import React from "react";
import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  GraduationCap,
  MessageSquare,
  Megaphone,
  RefreshCw,
  Send,
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
import { PageSkeleton } from "@/components/Skeletons";
import {
  createLmsAnnouncement,
  createLmsComment,
  createLmsPost,
  getLmsInstructorDashboard,
  reviewLmsSubmission,
} from "@/lib/services/lms";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
type StatusMessage = { type: "success" | "error"; message: string } | null;

const statusLabels: Record<string, string> = {
  assigned: "مكلف",
  in_progress: "قيد التعلم",
  completed: "مكتمل",
  overdue: "متأخر",
  submitted: "قيد المراجعة",
  late: "متأخر",
  accepted: "مقبول",
  rejected: "مرفوض",
  needs_revision: "يحتاج تعديل",
  reviewed: "تمت المراجعة",
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
};

const postTypeLabels: Record<string, string> = {
  discussion: "نقاش",
  question: "سؤال",
  announcement: "إعلان",
};

const pendingSubmissionStatuses = new Set(["submitted", "late", "needs_revision"]);

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

function formatDate(value: unknown) {
  if (!value || typeof value !== "string") return "-";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
}

function statusClass(status: string) {
  if (["completed", "published", "accepted"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["in_progress", "submitted", "reviewed"].includes(status)) return "border-sky-200 bg-sky-50 text-sky-700";
  if (["overdue", "rejected", "needs_revision", "late"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-700";
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
    <div className="flex min-w-[130px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 text-xs text-slate-500">{percent}%</span>
    </div>
  );
}

function Message({ status }: { status: StatusMessage }) {
  if (!status) return null;
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2 text-sm",
      status.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
    )}>
      {status.message}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
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
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function LmsInstructorDashboardScreen() {
  const [data, setData] = React.useState<Row | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedCourseId, setSelectedCourseId] = React.useState("");
  const [status, setStatus] = React.useState<StatusMessage>(null);
  const [postForm, setPostForm] = React.useState({ post_type: "discussion", title: "", body: "" });
  const [announcementForm, setAnnouncementForm] = React.useState({ title: "", body: "", pinned: false });
  const [commentByPost, setCommentByPost] = React.useState<Record<string, string>>({});
  const [reviews, setReviews] = React.useState<Record<string, { score: string; review_status: string; feedback: string }>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await getLmsInstructorDashboard();
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      setData(null);
      setLoading(false);
      return;
    }
    const next = asRow(result.data);
    const courses = rows(next.courses);
    setData(next);
    setSelectedCourseId((current) => {
      if (current && courses.some((course) => str(course, "id") === current)) return current;
      return str(courses[0] || {}, "id");
    });
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const courses = rows(data?.courses);
  const summary = asRow(data?.summary);
  const selectedCourse = courses.find((course) => str(course, "id") === selectedCourseId) || courses[0] || {};
  const selectedCourseIdValue = str(selectedCourse, "id");
  const metrics = asRow(selectedCourse.metrics);
  const permissions = asRow(selectedCourse.instructor_permissions);
  const learners = rows(selectedCourse.learners);
  const submissions = rows(selectedCourse.submissions);
  const pendingSubmissions = submissions.filter((submission) => pendingSubmissionStatuses.has(str(submission, "status")));
  const posts = rows(selectedCourse.posts);
  const announcements = rows(selectedCourse.announcements);

  function reviewState(submissionId: string) {
    return reviews[submissionId] || { score: "100", review_status: "accepted", feedback: "" };
  }

  function setReview(submissionId: string, patch: Partial<{ score: string; review_status: string; feedback: string }>) {
    setReviews((current) => ({ ...current, [submissionId]: { ...reviewState(submissionId), ...patch } }));
  }

  async function submitReview(submissionId: string) {
    const review = reviewState(submissionId);
    const result = await reviewLmsSubmission(submissionId, {
      score: Number(review.score || 0),
      review_status: review.review_status,
      feedback: review.feedback,
    });
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setStatus({ type: "success", message: "تم حفظ مراجعة التسليم" });
    await load();
  }

  async function submitAnnouncement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourseIdValue) return;
    const result = await createLmsAnnouncement(selectedCourseIdValue, announcementForm);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setAnnouncementForm({ title: "", body: "", pinned: false });
    setStatus({ type: "success", message: "تم نشر الإعلان للمتعلمين" });
    await load();
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourseIdValue) return;
    const result = await createLmsPost(selectedCourseIdValue, postForm);
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setPostForm({ post_type: "discussion", title: "", body: "" });
    setStatus({ type: "success", message: "تم نشر المشاركة في مجتمع الدورة" });
    await load();
  }

  async function submitComment(postId: string) {
    const body = commentByPost[postId]?.trim();
    if (!body) return;
    const result = await createLmsComment(postId, { body });
    if (result.error) {
      setStatus({ type: "error", message: result.error.message });
      return;
    }
    setCommentByPost((current) => ({ ...current, [postId]: "" }));
    setStatus({ type: "success", message: "تم إضافة رد المدرب" });
    await load();
  }

  if (loading) return <PageSkeleton />;

  if (courses.length === 0) {
    return (
      <div className="space-y-6" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">لوحة المدرب</h1>
          <p className="mt-1 text-sm text-slate-500">لا توجد دورات مخصصة لك كمدرب حتى الآن.</p>
        </div>
        <Message status={status} />
        <Card>
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
            <BookOpen className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">اطلب من مسؤول التدريب إضافتك كمدرب داخل صفحة مدربي الدورة.</p>
            <Button asChild variant="outline"><Link href="/learn">العودة إلى قاعة التعلم</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">لوحة المدرب</h1>
          <p className="mt-1 text-sm text-slate-500">متابعة المتعلمين، مراجعة المشاريع، نشر الإعلانات، والرد على أسئلة المجتمع من مكان واحد.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
          {selectedCourseIdValue ? (
            <>
              <Button asChild variant="outline"><Link href={`/lms/courses/${selectedCourseIdValue}/studio`}>استوديو الدورة</Link></Button>
              <Button asChild><Link href={`/lms/courses/${selectedCourseIdValue}/submissions`}>التسليمات</Link></Button>
            </>
          ) : null}
        </div>
      </div>

      <Message status={status} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="الدورات" value={num(summary, "courses")} icon={BookOpen} tone="blue" />
        <MetricCard label="المتعلمون" value={num(summary, "learners")} icon={Users} />
        <MetricCard label="مكتمل" value={num(summary, "completed")} icon={CheckCircle2} tone="green" />
        <MetricCard label="بانتظار المراجعة" value={num(summary, "pendingSubmissions")} icon={ClipboardCheck} tone="amber" />
        <MetricCard label="متوسط التقدم" value={`${num(summary, "averageProgress")}%`} icon={GraduationCap} tone="green" />
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <Label>الدورة النشطة</Label>
            <select
              value={selectedCourseIdValue}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {courses.map((course) => (
                <option key={str(course, "id")} value={str(course, "id")}>{str(course, "title")}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
            <div className="rounded-lg bg-slate-50 p-2">
              <p>المتعلمون</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{num(metrics, "learners")}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p>التقدم</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{num(metrics, "averageProgress")}%</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p>الأسئلة</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{num(metrics, "questions")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle>متابعة المتعلمين</CardTitle>
            <CardDescription>تقدم كل موظف داخل الدورة المحددة.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المتعلم</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التقدم</TableHead>
                  <TableHead>الاستحقاق</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {learners.map((enrollment) => {
                  const employee = asRow(enrollment.employee);
                  return (
                    <TableRow key={str(enrollment, "id")}>
                      <TableCell>
                        <div className="font-medium">{str(employee, "full_name") || str(enrollment, "employee_id")}</div>
                        <div className="text-xs text-slate-500">{str(employee, "employee_code") || str(employee, "email")}</div>
                      </TableCell>
                      <TableCell><StatusBadge value={enrollment.status} /></TableCell>
                      <TableCell><ProgressBar value={num(enrollment, "progress_percent")} /></TableCell>
                      <TableCell>{formatDate(enrollment.due_date)}</TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/lms/player/${str(enrollment, "id")}`}>فتح</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {learners.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">لا يوجد متعلمون مكلفون بهذه الدورة.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>صلاحياتك في الدورة</CardTitle>
            <CardDescription>تتبع صلاحياتك من سجل مدربي الدورة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <PermissionLine label="إدارة المحتوى" enabled={bool(permissions, "can_edit_content")} />
            <PermissionLine label="مراجعة التسليمات" enabled={bool(permissions, "can_review_tasks")} />
            <PermissionLine label="إدارة المجتمع والإعلانات" enabled={bool(permissions, "can_moderate_community")} />
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              إذا ظهرت صلاحية غير مفعلة، يستطيع المسؤول تعديلها من صفحة المدربين.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>تسليمات تحتاج متابعة</CardTitle>
            <CardDescription>اقبل أو ارفض أو اطلب تعديل المشروع مباشرة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingSubmissions.map((submission) => {
              const submissionId = str(submission, "id");
              const employee = asRow(submission.employee);
              const task = asRow(submission.task);
              const review = reviewState(submissionId);
              return (
                <div key={submissionId} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-950">{str(task, "title") || "تسليم مهمة"}</h3>
                      <p className="mt-1 text-xs text-slate-500">{str(employee, "full_name") || str(submission, "employee_id")} · {formatDate(submission.submitted_at)}</p>
                    </div>
                    <StatusBadge value={submission.status} />
                  </div>
                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {str(submission, "submission_text") || str(submission, "submission_url") || "لا يوجد نص مرفق."}
                  </p>
                  {bool(permissions, "can_review_tasks") ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-[90px_140px_1fr_auto]">
                      <Input type="number" value={review.score} onChange={(event) => setReview(submissionId, { score: event.target.value })} />
                      <select
                        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                        value={review.review_status}
                        onChange={(event) => setReview(submissionId, { review_status: event.target.value })}
                      >
                        <option value="accepted">قبول</option>
                        <option value="needs_revision">تعديل</option>
                        <option value="rejected">رفض</option>
                      </select>
                      <Input value={review.feedback} onChange={(event) => setReview(submissionId, { feedback: event.target.value })} placeholder="ملاحظات للمتعلم" />
                      <Button onClick={() => void submitReview(submissionId)}>حفظ</Button>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">ليست لديك صلاحية مراجعة التسليمات في هذه الدورة.</p>
                  )}
                </div>
              );
            })}
            {pendingSubmissions.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
                <ClipboardCheck className="h-9 w-9 text-slate-300" />
                لا توجد تسليمات بانتظار المراجعة.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إعلانات المدرب</CardTitle>
            <CardDescription>انشر رسالة تظهر للمتعلمين داخل الدورة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {bool(permissions, "can_moderate_community") ? (
              <form className="grid gap-3" onSubmit={submitAnnouncement}>
                <Input value={announcementForm.title} onChange={(event) => setAnnouncementForm({ ...announcementForm, title: event.target.value })} placeholder="عنوان الإعلان" required />
                <textarea
                  className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={announcementForm.body}
                  onChange={(event) => setAnnouncementForm({ ...announcementForm, body: event.target.value })}
                  placeholder="نص الإعلان"
                  required
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={announcementForm.pinned} onChange={(event) => setAnnouncementForm({ ...announcementForm, pinned: event.target.checked })} />
                    إعلان مثبت
                  </label>
                  <Button type="submit" className="gap-1.5"><Megaphone className="h-4 w-4" /> نشر</Button>
                </div>
              </form>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">ليست لديك صلاحية نشر الإعلانات في هذه الدورة.</p>
            )}
            <div className="space-y-2">
              {announcements.slice(0, 4).map((announcement) => (
                <div key={str(announcement, "id")} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-950">{str(announcement, "title")}</p>
                    {bool(announcement, "pinned") ? <Badge className="border border-amber-200 bg-amber-50 text-amber-700">مثبت</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{str(announcement, "body")}</p>
                </div>
              ))}
              {announcements.length === 0 ? <p className="text-sm text-slate-500">لا توجد إعلانات بعد.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>مجتمع الدورة</CardTitle>
          <CardDescription>انشر سؤالا أو نقاشا، ورد على المتعلمين برد يظهر كمدرب.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form className="grid content-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={submitPost}>
            <select
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              value={postForm.post_type}
              onChange={(event) => setPostForm({ ...postForm, post_type: event.target.value })}
            >
              <option value="discussion">نقاش</option>
              <option value="question">سؤال</option>
              <option value="announcement">إعلان مجتمع</option>
            </select>
            <Input value={postForm.title} onChange={(event) => setPostForm({ ...postForm, title: event.target.value })} placeholder="العنوان" required />
            <textarea
              className="min-h-28 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={postForm.body}
              onChange={(event) => setPostForm({ ...postForm, body: event.target.value })}
              placeholder="اكتب رسالتك للمتعلمين"
              required
            />
            <Button type="submit" className="gap-1.5"><Send className="h-4 w-4" /> نشر في المجتمع</Button>
          </form>

          <div className="space-y-3">
            {posts.slice(0, 6).map((post) => {
              const postId = str(post, "id");
              const comments = rows(post.comments);
              const employee = asRow(post.employee);
              return (
                <div key={postId} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-950">{str(post, "title") || "مشاركة"}</h3>
                    <Badge className="border border-slate-200 bg-slate-50 text-slate-700">{postTypeLabels[str(post, "post_type")] || "مشاركة"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{str(employee, "full_name") || "متعلم"} · {formatDate(post.created_at)}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{str(post, "body")}</p>
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    {comments.slice(0, 3).map((comment) => {
                      const commentEmployee = asRow(comment.employee);
                      return (
                        <div key={str(comment, "id")} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-medium">{str(commentEmployee, "full_name") || "مشارك"}</span>
                            {bool(comment, "is_instructor_reply") ? <Badge className="border border-sky-200 bg-sky-50 text-sky-700">مدرب</Badge> : null}
                          </div>
                          <p className="text-slate-600">{str(comment, "body")}</p>
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <Input value={commentByPost[postId] || ""} onChange={(event) => setCommentByPost({ ...commentByPost, [postId]: event.target.value })} placeholder="رد المدرب" />
                      <Button size="icon" variant="outline" onClick={() => void submitComment(postId)} aria-label="إرسال رد">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {posts.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-500">
                <MessageSquare className="h-9 w-9 text-slate-300" />
                لا توجد مشاركات في مجتمع هذه الدورة بعد.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionLine({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
      <span>{label}</span>
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      )}>
        {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        {enabled ? "مفعلة" : "غير مفعلة"}
      </span>
    </div>
  );
}
