"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useChecklistTemplates } from "@/hooks/use-supervisor";
import { Upload, X, Star, Loader2 } from "lucide-react";

interface Props {
  locationId: string;
  locationType: string;
  attendanceRecordId: string | null;
  onComplete: () => void;
  onClose: () => void;
}

interface ResponseEntry {
  item_id: string;
  label: string;
  value: boolean | number | string;
  notes?: string;
}

export function EvaluationChecklistModal({
  locationId,
  locationType,
  attendanceRecordId,
  onComplete,
  onClose,
}: Props) {
  const { templates, loading: loadingTemplates } = useChecklistTemplates(locationType);
  const template = templates[0];

  const [responses, setResponses] = useState<Map<string, ResponseEntry>>(new Map());
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateResponse(itemId: string, label: string, value: boolean | number | string) {
    setResponses((prev) => {
      const next = new Map(prev);
      next.set(itemId, { item_id: itemId, label, value });
      return next;
    });
  }

  function renderRating(itemId: string, label: string) {
    const current = responses.get(itemId)?.value as number ?? 0;
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => updateResponse(itemId, label, n)}
            className="focus:outline-none"
          >
            <Star
              className={`h-5 w-5 ${n <= current ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
            />
          </button>
        ))}
      </div>
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const selected = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (template) {
      const requiredItems = template.items.filter((item) => item.required);
      const missing = requiredItems.filter((item) => !responses.has(item.id));
      if (missing.length > 0) {
        setError(`يجب إكمال جميع العناصر المطلوبة (${missing.length} عناصر متبقية)`);
        return;
      }
    }

    setSubmitting(true);
    setError("");

    try {
      const today = new Date().toISOString().split("T")[0];
      const responseArray = Array.from(responses.values());
      const overallScore = calculateOverallScore(responseArray);

      const res = await fetch("/api/supervisor/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: locationId,
          attendance_record_id: attendanceRecordId,
          template_id: template?.id ?? null,
          responses: responseArray,
          overall_score: overallScore,
          comment: comment || null,
          evaluation_date: today,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.message || "فشل إرسال التقييم");
        setSubmitting(false);
        return;
      }

      const { evaluation } = await res.json();

      if (files.length > 0 && evaluation?.id) {
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          await fetch(`/api/supervisor/evaluations/${evaluation.id}/attachments`, {
            method: "POST",
            body: formData,
          });
        }
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
      setSubmitting(false);
    }
  }

  function calculateOverallScore(items: ResponseEntry[]): number | null {
    const ratings = items.filter((r) => typeof r.value === "number");
    if (ratings.length === 0) return null;
    const sum = ratings.reduce((acc, r) => acc + (r.value as number), 0);
    return Math.round((sum / ratings.length) * 10) / 10;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl" dir="rtl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white p-4">
          <h2 className="text-lg font-bold">تقييم الموقع</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {loadingTemplates ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !template ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              لا يوجد نموذج تقييم لهذا النوع من المواقع. يمكنك إضافة ملاحظاتك أدناه.
            </p>
          ) : (
            <div className="space-y-3">
              {template.items
                .sort((a, b) => a.order - b.order)
                .map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {item.label}
                        {item.required && <span className="text-red-500 mr-1">*</span>}
                      </Label>
                    </div>
                    {item.type === "boolean" && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={responses.get(item.id)?.value === true}
                          onCheckedChange={(checked: boolean) =>
                            updateResponse(item.id, item.label, checked === true)
                          }
                        />
                        <span className="text-sm text-muted-foreground">نعم</span>
                      </div>
                    )}
                    {item.type === "rating" && renderRating(item.id, item.label)}
                    {item.type === "text" && (
                      <Textarea
                        placeholder="أدخل ملاحظاتك..."
                        rows={2}
                        value={String(responses.get(item.id)?.value ?? "")}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateResponse(item.id, item.label, e.target.value)}
                      />
                    )}
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">ملاحظات عامة</Label>
            <Textarea
              placeholder="أضف أي ملاحظات إضافية..."
              rows={3}
              value={comment}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">إرفاق صور أو ملفات</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 ml-1" />
                إضافة ملف
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.docx,.xlsx"
                multiple
                onChange={handleFileChange}
              />
            </div>
            {files.length > 0 && (
              <div className="space-y-1 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                    <span className="truncate max-w-[200px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 border-t bg-white p-4">
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                جاري الإرسال...
              </>
            ) : (
              "إرسال التقييم وتسجيل الانصراف"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
