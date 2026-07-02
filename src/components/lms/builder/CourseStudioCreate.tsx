"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ClipboardCheck, Layers, Loader2, MonitorPlay, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLmsCourse, createLmsSection } from "@/lib/services/lms";
import { cn } from "@/lib/utils";

type TemplateKey = "blank" | "corporate" | "compliance" | "project";
type Status = { type: "success" | "error"; message: string } | null;

const templates: {
  key: TemplateKey;
  title: string;
  description: string;
  icon: typeof BookOpen;
  defaults: {
    title: string;
    description: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    estimated_minutes: number;
    requires_quiz_pass: boolean;
    requires_task_pass: boolean;
    sections: string[];
  };
}[] = [
  {
    key: "blank",
    title: "دورة فارغة",
    description: "ابدأ من صفحة بيضاء داخل الاستوديو.",
    icon: BookOpen,
    defaults: {
      title: "",
      description: "",
      difficulty: "beginner",
      estimated_minutes: 60,
      requires_quiz_pass: false,
      requires_task_pass: false,
      sections: [],
    },
  },
  {
    key: "corporate",
    title: "تدريب داخلي",
    description: "هيكل مناسب لدورات السياسات والإجراءات.",
    icon: Layers,
    defaults: {
      title: "دورة تدريب داخلية",
      description: "دورة مخصصة لتدريب الموظفين داخل المؤسسة.",
      difficulty: "beginner",
      estimated_minutes: 90,
      requires_quiz_pass: true,
      requires_task_pass: false,
      sections: ["مقدمة الدورة", "المحتوى الرئيسي", "الاختبار النهائي"],
    },
  },
  {
    key: "compliance",
    title: "امتثال إلزامي",
    description: "إعداد مناسب لدورات إلزامية مع اختبار نجاح.",
    icon: ClipboardCheck,
    defaults: {
      title: "دورة امتثال إلزامية",
      description: "دورة إلزامية تتطلب إكمال المحتوى واجتياز الاختبار.",
      difficulty: "beginner",
      estimated_minutes: 45,
      requires_quiz_pass: true,
      requires_task_pass: false,
      sections: ["السياسة", "أمثلة عملية", "اختبار الامتثال"],
    },
  },
  {
    key: "project",
    title: "مشروع تطبيقي",
    description: "هيكل مناسب لدورات فيها مشروع أو واجب.",
    icon: MonitorPlay,
    defaults: {
      title: "دورة مشروع تطبيقي",
      description: "دورة عملية تنتهي بمهمة أو مشروع قابل للمراجعة.",
      difficulty: "intermediate",
      estimated_minutes: 120,
      requires_quiz_pass: false,
      requires_task_pass: true,
      sections: ["التهيئة", "التطبيق العملي", "المشروع النهائي"],
    },
  },
];

export function CourseStudioCreate() {
  const router = useRouter();
  const [selected, setSelected] = useState<TemplateKey>("blank");
  const [form, setForm] = useState({
    title: "",
    description: "",
    difficulty: "beginner",
    estimated_minutes: 60,
    visibility: "assigned_only",
    requires_quiz_pass: false,
    requires_task_pass: false,
  });
  const [status, setStatus] = useState<Status>(null);
  const [creating, setCreating] = useState(false);

  const chooseTemplate = (key: TemplateKey) => {
    const template = templates.find((item) => item.key === key) || templates[0];
    setSelected(key);
    setForm((current) => ({
      ...current,
      title: template.defaults.title,
      description: template.defaults.description,
      difficulty: template.defaults.difficulty,
      estimated_minutes: template.defaults.estimated_minutes,
      requires_quiz_pass: template.defaults.requires_quiz_pass,
      requires_task_pass: template.defaults.requires_task_pass,
    }));
  };

  const createCourse = async () => {
    if (!form.title.trim()) {
      setStatus({ type: "error", message: "اكتب عنوان الدورة أولا." });
      return;
    }

    setCreating(true);
    setStatus(null);
    const result = await createLmsCourse({
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      difficulty: form.difficulty,
      estimated_minutes: Number(form.estimated_minutes || 0),
      visibility: form.visibility,
      requires_quiz_pass: form.requires_quiz_pass,
      requires_task_pass: form.requires_task_pass,
      status: "draft",
    });

    if (result.error) {
      setCreating(false);
      setStatus({ type: "error", message: result.error.message });
      return;
    }

    const courseId = String(result.data?.id || "");
    const template = templates.find((item) => item.key === selected) || templates[0];
    for (let index = 0; index < template.defaults.sections.length; index += 1) {
      await createLmsSection(courseId, {
        title: template.defaults.sections[index],
        sort_order: index + 1,
      });
    }

    router.push(`/lms/courses/${courseId}/studio`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">إنشاء دورة في الاستوديو</h1>
        <p className="mt-1 text-sm text-muted-foreground">أنشئ هيكل الدورة فقط، ثم أكمل المحتوى والاختبارات والمهام داخل Course Studio.</p>
      </div>

      {status ? (
        <div className={cn("rounded-lg border px-4 py-2.5 text-sm", status.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-destructive/30 bg-destructive/10 text-destructive")}>
          {status.message}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">اختر قالب البداية</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => chooseTemplate(template.key)}
              className={cn(
                "rounded-xl border p-4 text-right transition-colors",
                selected === template.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/60 hover:bg-muted/50"
              )}
            >
              <template.icon className="mb-3 h-5 w-5 text-primary" />
              <div className="flex items-center gap-2">
                <p className="font-semibold">{template.title}</p>
                {selected === template.key ? <Badge>مختار</Badge> : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">بيانات البداية</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">عنوان الدورة</span>
            <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">المستوى</span>
            <select value={form.difficulty} onChange={(event) => setForm((current) => ({ ...current, difficulty: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="beginner">مبتدئ</option>
              <option value="intermediate">متوسط</option>
              <option value="advanced">متقدم</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">المدة بالدقائق</span>
            <Input type="number" value={form.estimated_minutes} onChange={(event) => setForm((current) => ({ ...current, estimated_minutes: Number(event.target.value) }))} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">الظهور</span>
            <select value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none">
              <option value="assigned_only">المكلفون فقط</option>
              <option value="catalog">كتالوج الدورات</option>
            </select>
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-semibold text-muted-foreground">وصف مختصر</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requires_quiz_pass} onChange={(event) => setForm((current) => ({ ...current, requires_quiz_pass: event.target.checked }))} />
            يتطلب اجتياز الاختبار
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requires_task_pass} onChange={(event) => setForm((current) => ({ ...current, requires_task_pass: event.target.checked }))} />
            يتطلب قبول مهمة أو مشروع
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={createCourse} disabled={creating || !form.title.trim()} className="gap-1">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            إنشاء وفتح الاستوديو
          </Button>
        </div>
      </section>
    </div>
  );
}
