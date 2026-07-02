"use client";

import React from "react";
import Link from "next/link";
import {
  Award,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteCourseResource,
  getCourseBuilderState,
  getCourseResources,
  getLearnerPreview,
  getProjectRubric,
  updateCourseBuilderOverview,
  upsertCourseResource,
  upsertProjectRubric,
} from "@/lib/services/learn";
import { archiveLmsCourse, getLmsCourse, publishLmsCourse } from "@/lib/services/lms";

const S = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const N = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const L = <T = Record<string, unknown>,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const R = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown): string => (Array.isArray(v) ? v.map(String).join("\n") : S(v));

type Status = { type: "success" | "error"; message: string } | null;

const tabs = [
  { key: "overview", label: "نظرة عامة", icon: Settings2 },
  { key: "rubrics", label: "معايير التقييم", icon: ClipboardList },
  { key: "resources", label: "المصادر", icon: FolderOpen },
  { key: "publish", label: "قائمة النشر", icon: Rocket },
  { key: "preview", label: "معاينة المتعلم", icon: Layers },
];

export function CourseStudio({ courseId }: { courseId: string }) {
  const [state, setState] = React.useState<Record<string, unknown> | null>(null);
  const [course, setCourse] = React.useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = React.useState("overview");
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<Status>(null);
  const [publishing, setPublishing] = React.useState(false);

  const load = React.useCallback(async () => {
    const [builder, full] = await Promise.all([getCourseBuilderState(courseId), getLmsCourse(courseId)]);
    if (builder.error) setStatus({ type: "error", message: builder.error.message });
    setState(builder.data);
    setCourse(full.data);
    setLoading(false);
  }, [courseId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!state || !course) {
    return <p className="py-12 text-center text-sm text-muted-foreground">تعذّر تحميل الدورة.</p>;
  }

  const courseData = R(state.course);
  const checklist = R(state.checklist);
  const statusLabel: Record<string, string> = { draft: "مسودة", published: "منشورة", archived: "مؤرشفة" };
  const courseStatus = S(courseData.status);

  const publish = async () => {
    setPublishing(true);
    const result = await publishLmsCourse(courseId);
    setPublishing(false);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else {
      setStatus({ type: "success", message: "تم نشر الدورة بنجاح." });
      await load();
    }
  };

  const archive = async () => {
    const result = await archiveLmsCourse(courseId);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else {
      setStatus({ type: "success", message: "تم أرشفة الدورة." });
      await load();
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Topbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Pencil className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold">{S(courseData.title) || "دورة بدون عنوان"}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${courseStatus === "published" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : courseStatus === "archived" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
              {statusLabel[courseStatus] || courseStatus}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">استوديو بناء الدورة الاحترافي</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1">
          <Link href={`/lms/courses/${courseId}/edit`}><FileText className="h-4 w-4" /> محرر المحتوى</Link>
        </Button>
        <Button onClick={publish} disabled={publishing || !Boolean(checklist.canPublish)} size="sm" className="gap-1">
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} نشر
        </Button>
      </div>

      {status ? (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${status.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          {status.message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_240px]">
        {/* Tab nav */}
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-2 lg:flex-col">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>

        {/* Main */}
        <div className="min-w-0">
          {tab === "overview" ? <OverviewTab courseId={courseId} course={courseData} onSaved={load} setStatus={setStatus} /> : null}
          {tab === "rubrics" ? <RubricsTab tasks={L(course.tasks)} setStatus={setStatus} /> : null}
          {tab === "resources" ? <ResourcesTab courseId={courseId} setStatus={setStatus} /> : null}
          {tab === "publish" ? <PublishTab checklist={checklist} onArchive={archive} onPublish={publish} publishing={publishing} status={courseStatus} /> : null}
          {tab === "preview" ? <PreviewTab courseId={courseId} /> : null}
        </div>

        {/* Inspector */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">جاهزية النشر</p>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl font-bold">{N(checklist.passed)}/{N(checklist.total)}</span>
              <span className="text-xs text-muted-foreground">فحوصات مكتملة</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${N(checklist.total) ? (N(checklist.passed) / N(checklist.total)) * 100 : 0}%` }} />
            </div>
            {Boolean(checklist.canPublish) ? (
              <p className="mt-3 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> جاهزة للنشر</p>
            ) : (
              <p className="mt-3 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><XCircle className="h-3.5 w-3.5" /> {N(checklist.criticalFailures)} فحوصات حرجة متبقية</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">نصيحة</p>
            استخدم محرر المحتوى لإضافة الأقسام والدروس والاختبارات والمشاريع، ثم عد إلى الاستوديو لضبط المعايير والنشر.
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function OverviewTab({ courseId, course, onSaved, setStatus }: { courseId: string; course: Record<string, unknown>; onSaved: () => void; setStatus: (status: Status) => void }) {
  const [form, setForm] = React.useState({
    title: S(course.title),
    subtitle: S(course.subtitle),
    description: S(course.description),
    experience_type: S(course.experience_type) || "course",
    difficulty: S(course.difficulty) || "beginner",
    estimated_minutes: N(course.estimated_minutes),
    visibility: S(course.visibility) || "assigned_only",
    language: S(course.language) || "ar",
    target_audience: S(course.target_audience),
    prerequisites: S(course.prerequisites),
    learning_outcomes: list(course.learning_outcomes),
    skills_gained: list(course.skills_gained),
    tags: Array.isArray(course.tags) ? (course.tags as string[]).join(", ") : S(course.tags),
    passing_score: N(course.passing_score) || 70,
    requires_quiz_pass: Boolean(course.requires_quiz_pass),
    requires_task_pass: Boolean(course.requires_task_pass),
    certificate_enabled: course.certificate_enabled !== false,
    certificate_title: S(course.certificate_title),
    certificate_description: S(course.certificate_description),
    certificate_signatory: S(course.certificate_signatory),
  });
  const [saving, setSaving] = React.useState(false);
  const set = (key: keyof typeof form, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    const result = await updateCourseBuilderOverview(courseId, {
      ...form,
      learning_outcomes: form.learning_outcomes,
      skills_gained: form.skills_gained,
      tags: form.tags,
    });
    setSaving(false);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else {
      setStatus({ type: "success", message: "تم حفظ بيانات الدورة." });
      onSaved();
    }
  };

  const textareaClass = "w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">هوية الدورة</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="العنوان"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="العنوان الفرعي"><Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></Field>
          <Field label="النوع">
            <select value={form.experience_type} onChange={(e) => set("experience_type", e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none">
              <option value="course">دورة</option>
              <option value="program">برنامج</option>
            </select>
          </Field>
          <Field label="المستوى">
            <select value={form.difficulty} onChange={(e) => set("difficulty", e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none">
              <option value="beginner">مبتدئ</option>
              <option value="intermediate">متوسط</option>
              <option value="advanced">متقدم</option>
            </select>
          </Field>
          <Field label="المدة المقدرة (دقائق)"><Input type="number" value={form.estimated_minutes} onChange={(e) => set("estimated_minutes", Number(e.target.value))} /></Field>
          <Field label="الظهور">
            <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none">
              <option value="assigned_only">المسندين فقط</option>
              <option value="catalog">الكتالوج العام</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="الوصف"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} className={`${textareaClass} min-h-[80px]`} /></Field>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">مخرجات التعلم</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="ماذا سيتعلم المتدرب (سطر لكل نقطة)"><textarea value={form.learning_outcomes} onChange={(e) => set("learning_outcomes", e.target.value)} className={`${textareaClass} min-h-[90px]`} /></Field>
          <Field label="المهارات المكتسبة (سطر لكل مهارة)"><textarea value={form.skills_gained} onChange={(e) => set("skills_gained", e.target.value)} className={`${textareaClass} min-h-[90px]`} /></Field>
          <Field label="الجمهور المستهدف"><textarea value={form.target_audience} onChange={(e) => set("target_audience", e.target.value)} className={`${textareaClass} min-h-[60px]`} /></Field>
          <Field label="المتطلبات المسبقة"><textarea value={form.prerequisites} onChange={(e) => set("prerequisites", e.target.value)} className={`${textareaClass} min-h-[60px]`} /></Field>
          <Field label="الوسوم (مفصولة بفاصلة)"><Input value={form.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
          <Field label="لغة المحتوى"><Input value={form.language} onChange={(e) => set("language", e.target.value)} /></Field>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">قواعد الإكمال والشهادة</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="درجة النجاح %"><Input type="number" value={form.passing_score} onChange={(e) => set("passing_score", Number(e.target.value))} /></Field>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_quiz_pass} onChange={(e) => set("requires_quiz_pass", e.target.checked)} className="accent-primary" /> يتطلب اجتياز الاختبارات</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_task_pass} onChange={(e) => set("requires_task_pass", e.target.checked)} className="accent-primary" /> يتطلب قبول المشاريع</label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.certificate_enabled} onChange={(e) => set("certificate_enabled", e.target.checked)} className="accent-primary" /> <Award className="h-4 w-4" /> تفعيل الشهادة</label>
          <Field label="عنوان الشهادة"><Input value={form.certificate_title} onChange={(e) => set("certificate_title", e.target.value)} /></Field>
          <Field label="اسم الموقّع"><Input value={form.certificate_signatory} onChange={(e) => set("certificate_signatory", e.target.value)} /></Field>
          <div className="md:col-span-2">
            <Field label="وصف الشهادة"><textarea value={form.certificate_description} onChange={(e) => set("certificate_description", e.target.value)} className={`${textareaClass} min-h-[60px]`} /></Field>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} حفظ البيانات</Button>
      </div>
    </div>
  );
}

type RubricItem = { id?: string; title: string; passing_criteria: string; points: number };

function RubricsTab({ tasks, setStatus }: { tasks: Record<string, unknown>[]; setStatus: (status: Status) => void }) {
  const [selected, setSelected] = React.useState("");
  const [title, setTitle] = React.useState("معايير تقييم المشروع");
  const [items, setItems] = React.useState<RubricItem[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const select = async (taskId: string) => {
    setSelected(taskId);
    if (!taskId) return;
    setLoading(true);
    const result = await getProjectRubric(taskId);
    setLoading(false);
    const rubric = R(R(result.data).rubric);
    setTitle(S(rubric.title) || "معايير تقييم المشروع");
    setItems(L(rubric.items).map((item) => ({ id: S(R(item).id), title: S(R(item).title), passing_criteria: S(R(item).passing_criteria), points: N(R(item).points) })));
  };

  const addItem = () => setItems((prev) => [...prev, { title: "", passing_criteria: "", points: 10 }]);
  const updateItem = (index: number, key: keyof RubricItem, value: unknown) => setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await upsertProjectRubric(selected, { title, items });
    setSaving(false);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else setStatus({ type: "success", message: "تم حفظ معايير التقييم." });
  };

  const total = items.reduce((sum, item) => sum + N(item.points), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <Field label="اختر المشروع">
          <select value={selected} onChange={(e) => select(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none">
            <option value="">— اختر مشروعاً —</option>
            {tasks.map((task) => (
              <option key={S(task.id)} value={S(task.id)}>{S(task.title)}</option>
            ))}
          </select>
        </Field>
        {tasks.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">أضف مشاريع من محرر المحتوى أولاً.</p> : null}
      </div>

      {selected ? (
        loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5">
            <Field label="عنوان المعايير"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div className="mt-4 space-y-3">
              {items.map((item, index) => (
                <div key={index} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Input value={item.title} onChange={(e) => updateItem(index, "title", e.target.value)} placeholder="عنوان المعيار" className="flex-1" />
                    <Input type="number" value={item.points} onChange={(e) => updateItem(index, "points", Number(e.target.value))} className="w-24" />
                    <button onClick={() => removeItem(index)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <textarea value={item.passing_criteria} onChange={(e) => updateItem(index, "passing_criteria", e.target.value)} placeholder="معيار النجاح..." className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button onClick={addItem} variant="outline" size="sm" className="gap-1"><Plus className="h-4 w-4" /> إضافة معيار</Button>
              <span className="text-xs text-muted-foreground">إجمالي النقاط: {total}</span>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} حفظ المعايير</Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function ResourcesTab({ courseId, setStatus }: { courseId: string; setStatus: (status: Status) => void }) {
  const [resources, setResources] = React.useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({ title: "", resource_type: "document", external_url: "", description: "" });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    const result = await getCourseResources(courseId);
    setResources(L(result.data));
    setLoading(false);
  }, [courseId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const result = await upsertCourseResource(courseId, {
      title: form.title.trim(),
      resource_type: form.resource_type,
      external_url: form.external_url.trim() || undefined,
      description: form.description.trim() || undefined,
    });
    setSaving(false);
    if (result.error) setStatus({ type: "error", message: result.error.message });
    else {
      setForm({ title: "", resource_type: "document", external_url: "", description: "" });
      setStatus({ type: "success", message: "تمت إضافة المصدر." });
      await load();
    }
  };

  const remove = async (resourceId: string) => {
    await deleteCourseResource(resourceId);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">إضافة مصدر</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="العنوان"><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
          <Field label="النوع">
            <select value={form.resource_type} onChange={(e) => setForm((p) => ({ ...p, resource_type: e.target.value }))} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none">
              <option value="document">مستند</option>
              <option value="video">فيديو</option>
              <option value="spreadsheet">جدول</option>
              <option value="template">قالب</option>
              <option value="external_link">رابط خارجي</option>
              <option value="file">ملف</option>
            </select>
          </Field>
          <Field label="رابط خارجي (اختياري)"><Input value={form.external_url} onChange={(e) => setForm((p) => ({ ...p, external_url: e.target.value }))} placeholder="https://..." /></Field>
          <Field label="وصف"><Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={add} disabled={saving || !form.title.trim()} size="sm" className="gap-1"><Plus className="h-4 w-4" /> إضافة</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : resources.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">لا توجد مصادر بعد.</p>
        ) : (
          <ul className="space-y-2">
            {resources.map((resource) => (
              <li key={S(resource.id)} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{S(resource.title)}</p>
                  <p className="text-[11px] text-muted-foreground">{S(resource.resource_type)}</p>
                </div>
                <button onClick={() => remove(S(resource.id))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PublishTab({ checklist, onArchive, onPublish, publishing, status }: { checklist: Record<string, unknown>; onArchive: () => void; onPublish: () => void; publishing: boolean; status: string }) {
  const checks = L(checklist.checks);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">قائمة التحقق قبل النشر</h2>
        <ul className="space-y-2">
          {checks.map((check, index) => (
            <li key={index} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              {Boolean(R(check).ok) ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : R(check).severity === "critical" ? <XCircle className="h-4 w-4 text-destructive" /> : <XCircle className="h-4 w-4 text-amber-500" />}
              <span className="flex-1">{S(R(check).label)}</span>
              {R(check).severity === "critical" && !Boolean(R(check).ok) ? <span className="text-[10px] font-medium text-destructive">حرج</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">{Boolean(checklist.canPublish) ? "الدورة جاهزة للنشر" : "أكمل الفحوصات الحرجة أولاً"}</p>
          <p className="text-xs text-muted-foreground">{N(checklist.passed)}/{N(checklist.total)} فحوصات مكتملة</p>
        </div>
        <div className="flex gap-2">
          {status !== "archived" ? <Button onClick={onArchive} variant="outline" size="sm">أرشفة</Button> : null}
          <Button onClick={onPublish} disabled={publishing || !Boolean(checklist.canPublish)} size="sm" className="gap-1"><Rocket className="h-4 w-4" /> نشر الدورة</Button>
        </div>
      </div>
    </div>
  );
}

function PreviewTab({ courseId }: { courseId: string }) {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getLearnerPreview(courseId).then((result) => {
      setData(result.data);
      setLoading(false);
    });
  }, [courseId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;
  const structure = L(data.structure);
  const counts = R(data.counts);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {([["أقسام", counts.sections], ["دروس", counts.lessons], ["اختبارات", counts.quizzes], ["مشاريع", counts.projects]] as [string, unknown][]).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-xl font-bold">{N(value)}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {structure.map((section, index) => (
          <div key={index} className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-sm font-semibold">{index + 1}. {S(R(section).title)}</p>
            <ul className="space-y-1">
              {L(R(section).lessons).map((lesson, i) => (
                <li key={`l-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-muted px-1.5 text-[10px]">درس</span> {S(R(lesson).title)}
                </li>
              ))}
              {L(R(section).quizzes).map((quiz, i) => (
                <li key={`q-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">اختبار</span> {S(R(quiz).title)}
                </li>
              ))}
              {L(R(section).projects).map((project, i) => (
                <li key={`p-${i}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-amber-500/15 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">مشروع</span> {S(R(project).title)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {structure.length === 0 ? <p className="rounded-xl border border-dashed border-border bg-card/50 py-8 text-center text-sm text-muted-foreground">لا يوجد محتوى بعد.</p> : null}
      </div>
    </div>
  );
}
