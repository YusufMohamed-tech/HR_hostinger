"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoleContext } from "@/providers/RoleProvider";
import { useSupervisorLocations, useSiteEvaluations } from "@/hooks/use-supervisor";
import { createCheckIn, updateCheckOut } from "@/lib/services/attendance";
import { useAttendance } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";
import { MapPin, Clock, ClipboardList, LogIn, LogOut } from "lucide-react";
import { EvaluationChecklistModal } from "@/components/supervisor/EvaluationChecklistModal";

function getOrCreateDeviceFingerprint(orgId: string) {
  const key = `tatwir-attendance-device-id-${orgId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `${Date.now()}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, next);
  return next;
}

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

export default function SupervisorDashboard() {
  const { currentUser } = useRoleContext();
  const today = new Date().toISOString().split("T")[0];
  const { locations, loading: loadingLocations } = useSupervisorLocations();
  const { evaluations, loading: loadingEvals } = useSiteEvaluations({ limit: 5 });
  const { data: attendance, loading: loadingAttendance, refetch: refetchAttendance } = useAttendance(today);

  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showChecklist, setShowChecklist] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  const myRecord = attendance?.find?.(
    (r: Record<string, unknown>) =>
      r.employee_id === currentUser?.employeeId ||
      r.user_id === currentUser?.id
  ) as Record<string, unknown> | undefined;

  const isCheckedIn = myRecord && myRecord.check_in_at && !myRecord.check_out_at;

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  async function handleCheckIn() {
    if (!selectedLocationId) {
      setError("اختر الموقع أولاً");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 })
      );
      const result = await createCheckIn({
        org_id: currentUser?.orgId,
        employee_id: currentUser?.employeeId,
        check_in_lat: pos.coords.latitude,
        check_in_lng: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
        device_fingerprint: getOrCreateDeviceFingerprint(currentUser?.orgId ?? ""),
      }) as { data: unknown; error: { message: string } | null };
      if (result.error) {
        setError(result.error.message ?? "فشل تسجيل الحضور");
      } else {
        await refetchAttendance();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحصول على الموقع");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCheckOutClick() {
    if (myRecord?.id) {
      setActiveRecordId(String(myRecord.id));
      setShowChecklist(true);
    }
  }

  async function handleCheckOutAfterEvaluation() {
    setShowChecklist(false);
    setSubmitting(true);
    setError("");
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 })
      );
      const recordId = String(myRecord?.id ?? "");
      const result = await updateCheckOut(
        currentUser?.orgId ?? "",
        currentUser?.employeeId ?? "",
        recordId,
        {
          check_out_lat: pos.coords.latitude,
          check_out_lng: pos.coords.longitude,
          accuracy_meters: pos.coords.accuracy,
          device_fingerprint: getOrCreateDeviceFingerprint(currentUser?.orgId ?? ""),
        }
      ) as { data: unknown; error: { message: string } | null };
      if (result.error) {
        setError(result.error.message ?? "فشل تسجيل الانصراف");
      } else {
        await refetchAttendance();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحصول على الموقع");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingLocations || loadingAttendance) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">لوحة المشرف</h1>
        <p className="text-muted-foreground text-sm">
          مرحباً، {currentUser?.name}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              الموقع
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedLocationId} onValueChange={(v) => setSelectedLocationId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الموقع" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name} {loc.is_primary && "(رئيسي)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLocation && (
              <p className="mt-2 text-xs text-muted-foreground">
                النوع: {selectedLocation.type} | النطاق: {selectedLocation.radius_meters ?? "—"} متر
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              حالة الحضور
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isCheckedIn ? (
              <>
                <Badge variant="default" className="bg-green-600">مسجل حضور</Badge>
                <p className="text-xs text-muted-foreground">
                  وقت الحضور: {new Date(String(myRecord.check_in_at)).toLocaleTimeString("ar-SA")}
                </p>
                <Button
                  onClick={handleCheckOutClick}
                  disabled={submitting}
                  variant="destructive"
                  className="w-full"
                >
                  <LogOut className="h-4 w-4 ml-2" />
                  {submitting ? "جاري..." : "تسجيل الانصراف"}
                </Button>
              </>
            ) : (
              <>
                <Badge variant="secondary">غير مسجل</Badge>
                <Button
                  onClick={handleCheckIn}
                  disabled={submitting || !selectedLocationId}
                  className="w-full"
                >
                  <LogIn className="h-4 w-4 ml-2" />
                  {submitting ? "جاري..." : "تسجيل الحضور"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            آخر التقييمات
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingEvals ? (
            <p className="text-sm text-muted-foreground">جاري التحميل...</p>
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد تقييمات بعد</p>
          ) : (
            <div className="space-y-2">
              {evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium text-sm">
                      {(ev.locations as { name?: string } | null)?.name ?? "موقع"}
                    </p>
                    <p className="text-xs text-muted-foreground">{ev.evaluation_date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.overall_score != null && (
                      <span className="text-sm font-medium">{ev.overall_score}/5</span>
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

      {showChecklist && selectedLocationId && (
        <EvaluationChecklistModal
          locationId={selectedLocationId}
          locationType={selectedLocation?.type ?? "branch"}
          attendanceRecordId={activeRecordId}
          onComplete={handleCheckOutAfterEvaluation}
          onClose={() => setShowChecklist(false)}
        />
      )}
    </div>
  );
}
