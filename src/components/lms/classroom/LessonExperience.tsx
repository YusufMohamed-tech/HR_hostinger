"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeExternalUrl, sanitizeRichTextHtml } from "@/lib/rich-text";
import {
  completeClassroomLesson,
  createLearnerBookmark,
  createLearnerNote,
  deleteLearnerNote,
  getClassroomLesson,
  updateWorkspaceState,
} from "@/lib/services/learn";
import { L, N, R, S, Spinner, formatDate } from "./shared";
import { useClassroomContext } from "./shared";

function embedUrl(url: string) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

const lessonTypeLabels: Record<string, string> = {
  text: "درس نصي",
  video: "درس مرئي",
  document: "مستند",
  file: "ملف",
  link: "رابط خارجي",
};

export function LessonExperience({ enrollmentId, lessonId }: { enrollmentId: string; lessonId: string }) {
  const router = useRouter();
  const classroom = useClassroomContext();
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [noteBody, setNoteBody] = React.useState("");
  const [bookmarked, setBookmarked] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await getClassroomLesson(enrollmentId, lessonId);
    if (result.error) {
      setError(result.error.message);
      setData(null);
    } else {
      setData(result.data);
      setBookmarked(Boolean(R(result.data).bookmarked));
      setError(null);
    }
    setLoading(false);
  }, [enrollmentId, lessonId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    updateWorkspaceState(enrollmentId, { last_lesson_id: lessonId, last_route: `/learn/${enrollmentId}/lesson/${lessonId}`, current_tab: "lesson" }).catch(() => null);
  }, [enrollmentId, lessonId]);

  if (loading && !data) return <Spinner label="جار تحميل الدرس..." />;
  if (error) return <p className="py-10 text-center text-sm text-muted-foreground">{error}</p>;
  if (!data) return null;

  const lesson = R(data.lesson);
  const navigation = R(data.navigation);
  const completed = Boolean(data.completed);
  const notes = L(data.notes);
  const attachments = L(lesson.attachments);
  const previous = R(navigation.previous);
  const next = R(navigation.next);
  const lessonType = S(lesson.lesson_type);
  const contentUrl = safeExternalUrl(S(lesson.content_url));
  const signedUrl = S(lesson.signed_url);
  const embed = contentUrl ? embedUrl(contentUrl) : null;
  const safeContent = sanitizeRichTextHtml(S(lesson.content));

  const markComplete = async () => {
    setBusy(true);
    const result = await completeClassroomLesson(enrollmentId, lessonId);
    setBusy(false);
    if (!result.error) {
      await load();
      classroom.refetch();
      if (S(next.id)) router.push(`/learn/${enrollmentId}/lesson/${S(next.id)}`);
    }
  };

  const addNote = async () => {
    if (!noteBody.trim()) return;
    setBusy(true);
    const result = await createLearnerNote(enrollmentId, { body: noteBody.trim(), lesson_id: lessonId });
    setBusy(false);
    if (!result.error) {
      setNoteBody("");
      await load();
    }
  };

  const removeNote = async (noteId: string) => {
    await deleteLearnerNote(enrollmentId, noteId);
    await load();
  };

  const toggleBookmark = async () => {
    if (bookmarked) return;
    const result = await createLearnerBookmark(enrollmentId, { lesson_id: lessonId, bookmark_type: "lesson", label: S(lesson.title) });
    if (!result.error) setBookmarked(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{lessonTypeLabels[lessonType] || "درس"}</span>
        {N(lesson.duration_minutes) > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" /> {N(lesson.duration_minutes)} دقيقة
          </span>
        ) : null}
        {completed ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> مكتمل
          </span>
        ) : null}
        <span className="mr-auto text-[11px] text-muted-foreground">{N(navigation.index)} / {N(navigation.total)}</span>
      </div>

      <h1 className="text-xl font-bold">{S(lesson.title)}</h1>
      {S(lesson.description) ? <p className="text-sm text-muted-foreground">{S(lesson.description)}</p> : null}

      {/* Media */}
      {lessonType === "video" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-black">
          {signedUrl ? (
            <video controls className="aspect-video w-full" src={signedUrl} />
          ) : embed ? (
            <iframe className="aspect-video w-full" src={embed} allowFullScreen title={S(lesson.title)} />
          ) : contentUrl ? (
            <video controls className="aspect-video w-full" src={contentUrl} />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-white/70">لا يوجد فيديو</div>
          )}
        </div>
      ) : null}

      {/* Rich text content */}
      {safeContent ? (
        <div
          className="prose prose-sm max-w-none rounded-xl border border-border bg-card p-5 leading-relaxed dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: safeContent }}
        />
      ) : null}

      {/* Document / file / link */}
      {(lessonType === "document" || lessonType === "file") && (signedUrl || contentUrl) ? (
        <a href={signedUrl || contentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">فتح المستند</p>
            <p className="text-[11px] text-muted-foreground">اضغط للعرض أو التنزيل</p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </a>
      ) : null}

      {lessonType === "link" && contentUrl ? (
        <a href={contentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><ExternalLink className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">فتح الرابط الخارجي</p>
            <p className="truncate text-[11px] text-muted-foreground">{contentUrl}</p>
          </div>
        </a>
      ) : null}

      {/* Attachments */}
      {attachments.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Paperclip className="h-3.5 w-3.5" /> مرفقات</p>
          <ul className="space-y-1.5">
            {attachments.map((attachment, index) => (
              <li key={index}>
                <a href={S(R(attachment).signed_url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/40">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{S(R(attachment).file_name) || "ملف"}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
        <Button onClick={markComplete} disabled={busy || completed} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {completed ? "تم الإكمال" : "إكمال الدرس"}
        </Button>
        <Button onClick={toggleBookmark} variant="outline" size="sm" className="gap-1.5">
          {bookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          {bookmarked ? "محفوظ" : "حفظ"}
        </Button>
        <div className="mr-auto flex items-center gap-2">
          {S(previous.id) ? (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href={`/learn/${enrollmentId}/lesson/${S(previous.id)}`}><ArrowRight className="h-4 w-4" /> السابق</Link>
            </Button>
          ) : null}
          {S(next.id) ? (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href={`/learn/${enrollmentId}/lesson/${S(next.id)}`}>التالي <ArrowLeft className="h-4 w-4" /></Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Inline notes */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><StickyNote className="h-4 w-4 text-primary" /> ملاحظاتي على هذا الدرس</p>
        <div className="flex gap-2">
          <textarea
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="اكتب ملاحظة خاصة بك..."
            className="min-h-[64px] flex-1 resize-y rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary"
          />
          <Button onClick={addNote} disabled={busy || !noteBody.trim()} size="sm" className="h-auto gap-1">
            <Plus className="h-4 w-4" /> إضافة
          </Button>
        </div>
        {notes.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {notes.map((note, index) => (
              <li key={index} className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 p-3">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm">{S(R(note).body)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatDate(R(note).created_at)}</p>
                </div>
                <button onClick={() => removeNote(S(R(note).id))} className="shrink-0 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
