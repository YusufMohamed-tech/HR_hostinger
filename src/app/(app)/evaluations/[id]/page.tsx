"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/Skeletons";
import { ArrowRight, CheckCircle, AlertTriangle, Star, FileText, Image as ImageIcon } from "lucide-react";
import Link from "next/link";

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  reviewed: "تم المراجعة",
  flagged: "يحتاج متابعة",
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  reviewed: "bg-green-100 text-green-700",
  flagged: "bg-red-100 text-red-700",
};

interface EvaluationDetail {
  id: string;
  supervisor_id: string;
  location_id: string;
  evaluation_date: string;
  overall_score: number | null;
  status: string;
  comment: string | null;
  responses: Array<{ item_id: string; label: string; value: boolean | number | string; notes?: string }>;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  locations?: { id: string; name: string; type: string; city?: string } | null;
  employees?: { id: string; full_name: string } | null;
  attachments?: Array<{ id: string; file_name: string; file_type: string; file_key: string }>;
}

export default function EvaluationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [evaluation, setEvaluation] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/supervisor/evaluations/${id}`);
      if (res.ok) {
        const json = await res.json();
        setEvaluation(json.evaluation ?? null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  async function handleReview(status: "reviewed" | "flagged") {
    setSubmittingReview(true);
    try {
      const res = await fetch(`/api/supervisor/evaluations/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewer_notes: reviewerNotes || null }),
      });
      if (res.ok) {
        await fetchDetail();
      }
    } catch {
      // silent
    } finally {
      setSubmittingReview(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!evaluation) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">التقييم غير موجود</p>
        <Link href="/evaluations">
          <Button variant="ghost" className="mt-4">العودة للتقييمات</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/evaluations">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">تفاصيل التقييم</h1>
        <Badge className={statusColors[evaluation.status] ?? ""}>
          {statusLabels[evaluation.status] ?? evaluation.status}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">الموقع</p>
            <p className="font-medium">
              {(evaluation.locations as { name?: string } | null)?.name ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">المشرف</p>
            <p className="font-medium">
              {(evaluation.employees as { full_name?: string } | null)?.full_name ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">التاريخ</p>
            <p className="font-medium">{evaluation.evaluation_date}</p>
          </CardContent>
        </Card>
      </div>

      {evaluation.overall_score != null && (
        <Card>
          <CardContent className="pt-4 flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            <span className="text-2xl font-bold">{evaluation.overall_score}</span>
            <span className="text-muted-foreground">/5</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">عناصر التقييم</CardTitle>
        </CardHeader>
        <CardContent>
          {evaluation.responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد عناصر</p>
          ) : (
            <div className="space-y-3">
              {evaluation.responses.map((resp, i) => (
                <div key={i} className="flex items-center justify-between rounded border p-3">
                  <span className="text-sm font-medium">{resp.label}</span>
                  <span className="text-sm">
                    {typeof resp.value === "boolean" ? (resp.value ? "نعم" : "لا") :
                     typeof resp.value === "number" ? (
                       <span className="flex items-center gap-1">
                         {resp.value} <Star className="h-3 w-3 text-yellow-500" />
                       </span>
                     ) : resp.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {evaluation.comment && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ملاحظات المشرف</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{evaluation.comment}</p>
          </CardContent>
        </Card>
      )}

      {evaluation.attachments && evaluation.attachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">المرفقات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {evaluation.attachments.map((att) => (
                <div key={att.id} className="flex items-center gap-2 rounded border p-2">
                  {att.file_type.startsWith("image/") ? (
                    <ImageIcon className="h-4 w-4 text-blue-500" />
                  ) : (
                    <FileText className="h-4 w-4 text-gray-500" />
                  )}
                  <span className="text-sm truncate flex-1">{att.file_name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {evaluation.reviewer_notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ملاحظات المراجع</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{evaluation.reviewer_notes}</p>
            {evaluation.reviewed_at && (
              <p className="text-xs text-muted-foreground mt-2">
                تاريخ المراجعة: {new Date(evaluation.reviewed_at).toLocaleDateString("ar-SA")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {evaluation.status === "submitted" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">مراجعة التقييم</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">ملاحظات المراجعة (اختياري)</Label>
              <Textarea
                rows={3}
                value={reviewerNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReviewerNotes(e.target.value)}
                placeholder="أضف ملاحظاتك..."
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => handleReview("reviewed")}
                disabled={submittingReview}
                className="bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4 ml-2" />
                اعتماد التقييم
              </Button>
              <Button
                onClick={() => handleReview("flagged")}
                disabled={submittingReview}
                variant="destructive"
              >
                <AlertTriangle className="h-4 w-4 ml-2" />
                تحديد للمتابعة
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
