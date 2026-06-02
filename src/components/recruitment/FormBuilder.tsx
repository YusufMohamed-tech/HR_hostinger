"use client";

import React from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import type { FormQuestion } from "@/lib/services/recruitment";

type Props = {
  questions: FormQuestion[];
  onChange: (questions: FormQuestion[]) => void;
};

const TYPE_OPTIONS = [
  { value: "text", label: "نص قصير" },
  { value: "textarea", label: "نص طويل" },
  { value: "select", label: "اختيار من قائمة" },
  { value: "file", label: "رفع ملف" },
  { value: "date", label: "تاريخ" },
  { value: "yesno", label: "نعم / لا" },
  { value: "number", label: "رقم" },
];

function newQuestion(order: number): FormQuestion {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type: "text",
    label: "",
    required: false,
    order,
  };
}

export function FormBuilder({ questions, onChange }: Props) {
  const addQuestion = () => {
    onChange([...questions, newQuestion(questions.length + 1)]);
  };

  const removeQuestion = (id: string) => {
    onChange(questions.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i + 1 })));
  };

  const updateQuestion = (id: string, patch: Partial<FormQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...questions];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next.map((q, i) => ({ ...q, order: i + 1 })));
  };

  const moveDown = (index: number) => {
    if (index === questions.length - 1) return;
    const next = [...questions];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next.map((q, i) => ({ ...q, order: i + 1 })));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">أسئلة نموذج التقديم</h3>
        <Button type="button" size="sm" variant="outline" onClick={addQuestion} className="text-xs gap-1">
          <Plus className="w-3.5 h-3.5" />
          إضافة سؤال
        </Button>
      </div>

      {questions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
          لا توجد أسئلة — اضغط «إضافة سؤال» لإضافة سؤال مخصص
        </p>
      )}

      {questions.map((q, index) => (
        <Card key={q.id} className="border border-border/60">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-5 text-center">{index + 1}</span>
              <div className="flex flex-col gap-0.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                >
                  <ChevronUp className="w-3 h-3" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4"
                  onClick={() => moveDown(index)}
                  disabled={index === questions.length - 1}
                >
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </div>
              <div className="flex-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs mb-1 block">نص السؤال</Label>
                  <Input
                    value={q.label}
                    placeholder="أدخل نص السؤال بالعربية"
                    className="h-8 text-sm"
                    onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">نوع الحقل</Label>
                  <Select
                    value={q.type}
                    onValueChange={(v) =>
                      updateQuestion(q.id, { type: v as FormQuestion["type"] })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-red-500 hover:text-red-700 h-7 w-7 shrink-0"
                onClick={() => removeQuestion(q.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {q.type === "select" && (
              <div className="pr-9">
                <Label className="text-xs mb-1 block">خيارات القائمة (مفصولة بفاصلة)</Label>
                <Input
                  value={q.options?.join("،") ?? ""}
                  placeholder="خيار 1،خيار 2،خيار 3"
                  className="h-8 text-sm"
                  onChange={(e) =>
                    updateQuestion(q.id, {
                      options: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
            )}

            {q.type === "file" && (
              <div className="pr-9">
                <Label className="text-xs mb-1 block">أنواع الملفات المقبولة</Label>
                <Input
                  value={q.accept ?? ""}
                  placeholder=".pdf,.doc,.docx"
                  className="h-8 text-sm"
                  onChange={(e) => updateQuestion(q.id, { accept: e.target.value })}
                />
              </div>
            )}

            <div className="pr-9 flex items-center gap-2">
              <input
                id={`req-${q.id}`}
                type="checkbox"
                checked={q.required}
                onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                className="w-3.5 h-3.5 accent-brand"
              />
              <label htmlFor={`req-${q.id}`} className="text-xs text-muted-foreground">
                حقل مطلوب
              </label>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
