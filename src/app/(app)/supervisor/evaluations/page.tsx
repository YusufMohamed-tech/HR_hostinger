"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useSupervisorLocations, useSiteEvaluations } from "@/hooks/use-supervisor";
import { PageSkeleton } from "@/components/Skeletons";
import { ClipboardList } from "lucide-react";

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

export default function SupervisorEvaluationsPage() {
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { locations, loading: loadingLocs } = useSupervisorLocations();
  const { evaluations, total, loading: loadingEvals } = useSiteEvaluations({
    location_id: locationFilter || undefined,
    status: statusFilter || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: 50,
  });

  if (loadingLocs) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          سجل التقييمات
        </h1>
        <span className="text-sm text-muted-foreground">{total} تقييم</span>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Select value={locationFilter} onValueChange={(v) => setLocationFilter(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="جميع المواقع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">جميع المواقع</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="جميع الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">جميع الحالات</SelectItem>
                <SelectItem value="submitted">مرسل</SelectItem>
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
          <CardTitle className="text-base">التقييمات</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingEvals ? (
            <p className="text-sm text-muted-foreground text-center py-8">جاري التحميل...</p>
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد تقييمات</p>
          ) : (
            <div className="space-y-2">
              {evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {(ev.locations as { name?: string } | null)?.name ?? "موقع"}
                    </p>
                    <p className="text-xs text-muted-foreground">{ev.evaluation_date}</p>
                    {ev.comment && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{ev.comment}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {ev.overall_score != null && (
                      <span className="text-lg font-bold text-primary">{ev.overall_score}/5</span>
                    )}
                    <Badge className={statusColors[ev.status] ?? ""}>
                      {statusLabels[ev.status] ?? ev.status}
                    </Badge>
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
