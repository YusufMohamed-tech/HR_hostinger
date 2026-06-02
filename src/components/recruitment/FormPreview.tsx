"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormQuestion } from "@/lib/services/recruitment";
import { BRAND } from "@/config/brand";

type Props = {
  jobTitle: string;
  questions: FormQuestion[];
};

function QuestionPreview({ q }: { q: FormQuestion }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700">
        {q.label || <span className="italic text-muted-foreground">(بدون نص)</span>}
        {q.required && <span className="text-red-500 mr-1">*</span>}
      </label>

      {q.type === "text" && (
        <input
          disabled
          placeholder="نص قصير..."
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
        />
      )}
      {q.type === "textarea" && (
        <textarea
          disabled
          rows={3}
          placeholder="نص طويل..."
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground resize-none"
        />
      )}
      {q.type === "number" && (
        <input
          disabled
          type="number"
          placeholder="0"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
        />
      )}
      {q.type === "date" && (
        <input
          disabled
          type="date"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
        />
      )}
      {q.type === "select" && (
        <select
          disabled
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
        >
          <option>اختر...</option>
          {(q.options || []).map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      )}
      {q.type === "yesno" && (
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="radio" disabled />
            نعم
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="radio" disabled />
            لا
          </label>
        </div>
      )}
      {q.type === "file" && (
        <div className="border border-dashed border-border rounded-md px-3 py-4 text-center text-sm text-muted-foreground bg-muted/20">
          اختر ملفاً {q.accept ? `(${q.accept})` : ""}
        </div>
      )}
    </div>
  );
}

export function FormPreview({ jobTitle, questions }: Props) {
  return (
    <Card className="border border-border/60 h-full">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-sm font-semibold text-brand">معاينة نموذج التقديم</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          هذا ما سيراه المتقدمون — {questions.length} سؤال
        </p>
      </CardHeader>
      <CardContent className="pt-4 space-y-4 overflow-auto max-h-[calc(100vh-280px)]">
        <div className="bg-brand/5 border border-brand/20 rounded-lg p-3">
          <p className="text-sm font-semibold text-brand">{jobTitle || "عنوان الوظيفة"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{BRAND.name}</p>
        </div>

        {/* Fixed fields always shown */}
        <div className="space-y-3 border-b pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">معلومات أساسية</p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              الاسم الكامل <span className="text-red-500">*</span>
            </label>
            <input
              disabled
              placeholder="الاسم الكامل"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              البريد الإلكتروني <span className="text-red-500">*</span>
            </label>
            <input
              disabled
              placeholder="email@example.com"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">رقم الجوال</label>
            <input
              disabled
              placeholder="05xxxxxxxx"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">السيرة الذاتية (ملف)</label>
            <div className="border border-dashed border-border rounded-md px-3 py-4 text-center text-sm text-muted-foreground bg-muted/20">
              رفع ملف PDF أو Word
            </div>
          </div>
        </div>

        {/* Custom questions */}
        {questions.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">أسئلة إضافية</p>
            {questions.map((q) => (
              <QuestionPreview key={q.id} q={q} />
            ))}
          </div>
        )}

        <button
          disabled
          className="w-full bg-brand/80 text-white rounded-lg py-2.5 text-sm font-medium mt-2"
        >
          تقديم الطلب
        </button>
      </CardContent>
    </Card>
  );
}
