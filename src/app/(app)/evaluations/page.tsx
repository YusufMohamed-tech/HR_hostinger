"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoleContext } from "@/providers/RoleProvider";
import { PageSkeleton } from "@/components/Skeletons";
import { ClipboardList, Eye, CheckCircle, AlertTriangle } from "lucide-react";
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

interface Evaluation {
  id: string;
  supervisor_id: string;
  location_id: string;
  evaluation_date: string;
  overall_score: number | null;
  status: string;
  comment: string | null;
  submitted_at: string;
  locations?: { id: string; name: string; type: string } | null;
  employees?: { id: string; full_name: string } | null;
}

export default function HREvaluationsPage() {
  const { currentUser } = useRoleContext();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const fetchEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      params.set("limit", "50");

      const res = await fetch(`/api/supervisor/evaluations?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setEvaluations(json.evaluations ?? []);
        setTotal(json.total ?? 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => { fetchEvaluations(); }, [fetchEvaluations]);

  async function handleReview(id: string, status: "reviewed" | "flagged") {
    setReviewingId(id);
    try {
      const res = await fetch(`/api/supervisor/evaluations/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await fetchEvaluations();
      }
    } catch {
      // silent
    } finally {
      setReviewingId(null);
    }
  }

  if (!currentUser) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          تقييمات المواقع
        </h1>
        <span className="text-sm text-muted-foreground">{total} تقييم</span>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="جميع الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">جميع الحالات</SelectItem>
                <SelectItem value="submitted">مرسل - بانتظار المراجعة</SelectItem>
                <SelectItem value="reviewed">تم المراجعة</SelectItem>
                <SelectItem value="flagged">يحتاج متابعة</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="من تاريخ"
            />

            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="إلى تاريخ"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">جميع التقييمات</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">جاري التحميل...</p>
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد تقييمات</p>
          ) : (
            <div className="space-y-3">
              {evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {(ev.locations as { name?: string } | null)?.name ?? "موقع"}
                      </p>
                      <Badge className={statusColors[ev.status] ?? ""}>
                        {statusLabels[ev.status] ?? ev.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      المشرف: {(ev.employees as { full_name?: string } | null)?.full_name ?? "—"} | {ev.evaluation_date}
                    </p>
                    {ev.comment && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{ev.comment}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mr-4">
                    {ev.overall_score != null && (
                      <span className="text-lg font-bold text-primary">{ev.overall_score}/5</span>
                    )}

                    <Link href={`/evaluations/${ev.id}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>

                    {ev.status === "submitted" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => handleReview(ev.id, "reviewed")}
                          disabled={reviewingId === ev.id}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleReview(ev.id, "flagged")}
                          disabled={reviewingId === ev.id}
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
