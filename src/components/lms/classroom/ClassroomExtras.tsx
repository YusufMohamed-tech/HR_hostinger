"use client";

import React from "react";
import Link from "next/link";
import {
  Award,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  FolderOpen,
  Heart,
  Loader2,
  MessageSquare,
  Plus,
  Printer,
  Send,
  StickyNote,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createLearnerNote,
  deleteLearnerNote,
  getClassroomCertificate,
  getClassroomCommunity,
  getClassroomResources,
  getClassroomWorkspace,
  getLearnerNotes,
} from "@/lib/services/learn";
import { createLmsComment, createLmsPost, reactToLmsPost } from "@/lib/services/lms";
import { EmptyState, L, R, S, Spinner, StatusPill, formatDate } from "./shared";
import { useClassroomContext } from "./shared";

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export function WorkspaceView({ enrollmentId }: { enrollmentId: string }) {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getClassroomWorkspace(enrollmentId).then((response) => {
      setData(response.data);
      setLoading(false);
    });
  }, [enrollmentId]);

  if (loading) return <Spinner label="جار تحميل مساحة العمل..." />;
  if (!data) return null;
  const projects = L(data.projects);
  const resources = L(data.resources);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">مساحة العمل</h1>
        <p className="text-sm text-muted-foreground">مشاريعك ومصادرك في مكان واحد</p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><FolderKanban className="h-4 w-4" /> المشاريع</h2>
        {projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="لا توجد مشاريع" hint="ستظهر مشاريع الدورة هنا عند إضافتها." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const submission = R(R(project).submission);
              const config = R(R(project).workspaceConfig);
              const status = S(submission.status);
              return (
                <div key={S(R(project).id)} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{S(R(project).title)}</p>
                    {submission.id ? (
                      <StatusPill status={status === "accepted" ? "completed" : status === "needs_revision" || status === "rejected" ? "needs_revision" : status === "reviewed" ? "in_review" : "submitted"} />
                    ) : (
                      <StatusPill status="available" />
                    )}
                  </div>
                  {S(config.instructions) ? <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{S(config.instructions)}</p> : null}
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline"><Link href={`/learn/${enrollmentId}/project/${S(R(project).id)}`}>فتح المشروع</Link></Button>
                    {S(config.external_url) ? (
                      <Button asChild size="sm" variant="ghost" className="gap-1">
                        <a href={S(config.external_url)} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> بيئة العمل</a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {resources.length > 0 ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><FolderOpen className="h-4 w-4" /> مصادر سريعة</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {resources.slice(0, 6).map((resource, index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{S(R(resource).title)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Community
// ---------------------------------------------------------------------------
export function CommunityView({ enrollmentId }: { enrollmentId: string }) {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [courseId, setCourseId] = React.useState("");
  const [body, setBody] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [commentDrafts, setCommentDrafts] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    const response = await getClassroomCommunity(enrollmentId);
    setData(response.data);
    setCourseId(S(R(response.data).courseId));
    setLoading(false);
  }, [enrollmentId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="جار تحميل المجتمع..." />;
  if (!data) return null;
  const posts = L(data.posts);

  const submitPost = async () => {
    if (!body.trim() || !courseId) return;
    setBusy(true);
    const result = await createLmsPost(courseId, { body: body.trim(), title: title.trim() || undefined, post_type: "question" });
    setBusy(false);
    if (!result.error) {
      setBody("");
      setTitle("");
      await load();
    }
  };

  const submitComment = async (postId: string) => {
    const draft = commentDrafts[postId];
    if (!draft?.trim()) return;
    const result = await createLmsComment(postId, { body: draft.trim() });
    if (!result.error) {
      setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
      await load();
    }
  };

  const react = async (postId: string) => {
    await reactToLmsPost(postId, "like");
    await load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">مجتمع الدورة</h1>
        <p className="text-sm text-muted-foreground">اطرح أسئلتك وشارك زملاءك</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="عنوان (اختياري)"
          className="mb-2 w-full rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="اكتب سؤالاً أو مشاركة..."
            className="min-h-[60px] flex-1 resize-y rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
          />
          <Button onClick={submitPost} disabled={busy || !body.trim()} size="sm" className="h-auto gap-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} نشر
          </Button>
        </div>
      </div>

      {posts.length === 0 ? (
        <EmptyState icon={MessageSquare} title="لا توجد منشورات بعد" hint="كن أول من يبدأ نقاشاً في هذه الدورة." />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const postId = S(R(post).id);
            const comments = L(R(post).comments);
            const reactions = L(R(post).reactions);
            return (
              <div key={postId} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold">{S(R(R(post).employee).full_name) || "متعلم"}</span>
                  {S(R(post).post_type) === "question" ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">سؤال</span> : null}
                  <span className="mr-auto text-[10px] text-muted-foreground">{formatDate(R(post).created_at)}</span>
                </div>
                {S(R(post).title) ? <p className="text-sm font-medium">{S(R(post).title)}</p> : null}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{S(R(post).body)}</p>
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={() => react(postId)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                    <Heart className="h-3.5 w-3.5" /> {reactions.length || ""} إعجاب
                  </button>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> {comments.length} رد</span>
                </div>
                {comments.length > 0 ? (
                  <ul className="mt-3 space-y-2 border-t border-border pt-3">
                    {comments.map((comment, index) => (
                      <li key={index} className="rounded-lg bg-muted/40 p-2.5">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="text-xs font-medium">{S(R(R(comment).employee).full_name) || "متعلم"}</span>
                          {Boolean(R(comment).is_instructor_reply) ? <span className="rounded bg-emerald-500/15 px-1.5 text-[9px] text-emerald-600 dark:text-emerald-400">مدرب</span> : null}
                        </div>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{S(R(comment).body)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <input
                    value={commentDrafts[postId] || ""}
                    onChange={(event) => setCommentDrafts((prev) => ({ ...prev, [postId]: event.target.value }))}
                    placeholder="أضف رداً..."
                    className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  <Button onClick={() => submitComment(postId)} size="xs" variant="outline">رد</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export function NotesView({ enrollmentId }: { enrollmentId: string }) {
  const [notes, setNotes] = React.useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const response = await getLearnerNotes(enrollmentId);
    setNotes(L(response.data));
    setLoading(false);
  }, [enrollmentId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    const result = await createLearnerNote(enrollmentId, { body: body.trim(), title: title.trim() || undefined });
    setBusy(false);
    if (!result.error) {
      setBody("");
      setTitle("");
      await load();
    }
  };

  const remove = async (noteId: string) => {
    await deleteLearnerNote(enrollmentId, noteId);
    await load();
  };

  if (loading) return <Spinner label="جار تحميل الملاحظات..." />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">ملاحظاتي</h1>
        <p className="text-sm text-muted-foreground">ملاحظات خاصة بك لهذه الدورة</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="عنوان الملاحظة (اختياري)"
          className="mb-2 w-full rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="اكتب ملاحظتك..."
            className="min-h-[70px] flex-1 resize-y rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
          />
          <Button onClick={add} disabled={busy || !body.trim()} size="sm" className="h-auto gap-1"><Plus className="h-4 w-4" /> إضافة</Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="لا توجد ملاحظات" hint="أضف ملاحظاتك أثناء التعلم لتعود إليها لاحقاً." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <div key={S(note.id)} className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                {S(note.title) ? <p className="mb-1 text-sm font-semibold">{S(note.title)}</p> : null}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{S(note.body)}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{formatDate(note.created_at)}</p>
              </div>
              <button onClick={() => remove(S(note.id))} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
export function ResourcesView({ enrollmentId }: { enrollmentId: string }) {
  const [resources, setResources] = React.useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getClassroomResources(enrollmentId).then((response) => {
      setResources(L(R(response.data).resources));
      setLoading(false);
    });
  }, [enrollmentId]);

  if (loading) return <Spinner label="جار تحميل المصادر..." />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">المصادر</h1>
        <p className="text-sm text-muted-foreground">ملفات ومراجع الدورة</p>
      </div>
      {resources.length === 0 ? (
        <EmptyState icon={FolderOpen} title="لا توجد مصادر" hint="ستظهر مصادر الدورة هنا عند إضافتها." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {resources.map((resource) => {
            const url = S(resource.signed_url) || S(resource.external_url);
            return (
              <div key={S(resource.id)} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{S(resource.title)}</p>
                  {S(resource.description) ? <p className="truncate text-[11px] text-muted-foreground">{S(resource.description)}</p> : null}
                </div>
                {url ? (
                  <Button asChild size="sm" variant="ghost" className="gap-1">
                    <a href={url} target="_blank" rel="noreferrer">{S(resource.external_url) ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}</a>
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------
export function CertificateView({ enrollmentId }: { enrollmentId: string }) {
  const { data: classroom } = useClassroomContext();
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getClassroomCertificate(enrollmentId).then((response) => {
      setData(response.data);
      setLoading(false);
    });
  }, [enrollmentId]);

  if (loading) return <Spinner label="جار تحميل الشهادة..." />;
  if (!data) return null;

  const certificate = R(data.certificate);
  const course = R(data.course);
  const eligible = Boolean(data.eligible);
  const employee = R(certificate.employee);
  const organization = R(certificate.organization);
  const orgName = S(organization.name) || S(R(classroom?.course).title);

  if (!certificate.id) {
    return (
      <div className="mx-auto max-w-lg py-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground"><Award className="h-8 w-8" /></div>
        <h1 className="text-lg font-bold">{eligible ? "شهادتك قيد الإصدار" : "الشهادة غير متاحة بعد"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {eligible ? "أكملت الدورة، وسيتم إصدار شهادتك قريباً." : "أكمل جميع متطلبات الدورة للحصول على الشهادة."}
        </p>
        <Button asChild variant="outline" className="mt-4"><Link href={`/learn/${enrollmentId}/syllabus`}>متابعة التعلم</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">شهادة الإتمام</h1>
        <Button onClick={() => window.print()} variant="outline" size="sm" className="gap-1.5"><Printer className="h-4 w-4" /> طباعة</Button>
      </div>
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border-4 border-double border-primary/30 bg-card p-8 text-center shadow-sm print:border-primary print:shadow-none">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Award className="h-7 w-7" /></div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">شهادة إتمام</p>
        <h2 className="mt-4 text-2xl font-bold">{S(employee.full_name)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">أتمّ بنجاح دورة</p>
        <p className="mt-1 text-lg font-semibold text-primary">{S(certificate.certificate_title) || S(course.title)}</p>
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
          <span>{orgName}</span>
          <span>رقم الشهادة: {S(certificate.certificate_number)}</span>
          <span>{formatDate(certificate.issued_at)}</span>
        </div>
        {S(certificate.certificate_signatory) ? <p className="mt-3 text-xs text-muted-foreground">التوقيع: {S(certificate.certificate_signatory)}</p> : null}
      </div>
    </div>
  );
}
