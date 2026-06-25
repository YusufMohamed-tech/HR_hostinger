"use client";

import React, { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useRoleContext } from "@/providers/RoleProvider";
import { useAttendance, useEmployees, useLocations, useEmployeeShifts } from "@/hooks/use-data";
import { createCheckIn, notifyMissingAttendanceLocation, updateCheckOut } from "@/lib/services/attendance";
import { PageSkeleton } from "@/components/Skeletons";
import { MessageDialog } from "@/components/ui/feedback-dialog";

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function getOrCreateDeviceFingerprint(orgId: string) {
  const key = `tatwir-attendance-device-id-${orgId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `${Date.now()}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, next);
  return next;
}

function getLocationRadiusMeters(location: Record<string, unknown> | null) {
  const radius = Number(location?.radius_meters);
  return Number.isFinite(radius) && radius > 0 ? Math.round(radius) : 0;
}

function outsideGeofenceMessage(distance: number, radius: number) {
  return `أنت بعيد عن الفرع بـ ${distance} متر. المسافة المسموح بها هي ${radius} متر فقط.`;
}

const attendanceStatusLabels: Record<string, string> = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  "half-day": "نصف يوم",
};

const arrivalStatusLabels: Record<string, string> = {
  early: "حضور مبكر",
  on_time: "في الموعد",
  late: "حضور متأخر",
};

const departureStatusLabels: Record<string, string> = {
  early_leave: "انصراف مبكر",
  on_time: "في الموعد",
  overtime: "انصراف متأخر",
};

export default function AttendancePage() {
  const { currentUser } = useRoleContext();
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const { data: attendance, loading, refetch } = useAttendance(selectedDate);
  const { data: employees, loading: loadingEmployees } = useEmployees();
  const { data: locations, loading: loadingLocations } = useLocations();
  const { data: employeeShifts } = useEmployeeShifts(currentUser?.employeeId, { requireEmployee: true });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [popupMessage, setPopupMessage] = useState("");
  const checkInClickIntentRef = useRef(false);
  const checkOutClickIntentRef = useRef(false);
  const isViewingToday = selectedDate === today;

  const canViewTeam = ["Superadmin", "Admin", "HR_Admin", "Training_Manager"].includes(currentUser?.role || "");
  const visibleAttendance = canViewTeam
    ? currentUser?.role === "Training_Manager"
      ? attendance.filter((row) => {
          const employee = (row.employee ?? null) as Record<string, unknown> | null;
          return String(employee?.manager_id || "") === currentUser?.employeeId;
        })
      : attendance
    : attendance.filter((row) => row.employee_id === currentUser?.employeeId);
  const myAttendance = attendance.find((row) => row.employee_id === currentUser?.employeeId);

  const assignedLocations = useMemo(() => {
    if (!currentUser?.employeeId) return null;
    const employee = employees.find((emp) => emp.id === currentUser.employeeId);
    const employeeLocationRows = Array.isArray(employee?.employee_locations) ? employee.employee_locations : [];
    const mappedLocations = employeeLocationRows
      .map((row) => (row as Record<string, unknown>).location as Record<string, unknown> | undefined)
      .filter((location): location is Record<string, unknown> => Boolean(location?.id));

    if (mappedLocations.length > 0) return mappedLocations;
    if (!employee?.location_id) return [];
    const legacyLocation = locations.find((loc) => loc.id === employee.location_id);
    return legacyLocation ? [legacyLocation] : [];
  }, [currentUser?.employeeId, employees, locations]);
  const findClosestAllowedLocation = (latitude: number, longitude: number) => {
    const candidates = (assignedLocations || [])
      .map((location) => {
        const radius = getLocationRadiusMeters(location);
        const locLat = Number(location.latitude);
        const locLng = Number(location.longitude);
        const distance = Number.isFinite(locLat) && Number.isFinite(locLng)
          ? haversineDistance(latitude, longitude, locLat, locLng)
          : Number.POSITIVE_INFINITY;
        return { location, radius, distance, withinGeofence: radius > 0 && distance <= radius };
      })
      .sort((a, b) => a.distance - b.distance);

    return candidates.find((candidate) => candidate.withinGeofence) || candidates[0] || null;
  };

  const assignedShift = (employeeShifts[0]?.shift ?? null) as Record<string, unknown> | null;
  const shiftStartTime = typeof assignedShift?.start_time === "string" ? assignedShift.start_time : undefined;
  const shiftId = typeof assignedShift?.id === "string" ? assignedShift.id : undefined;

  const showMissingLocationPopup = async (action: "check_in" | "check_out") => {
    const message = "لم يتم تعيين موقع حضور لحسابك بعد. تم إرسال تنبيه إلى الموارد البشرية لتحديد موقعك، ولن يمكن تسجيل الحضور أو الانصراف قبل ربط الموقع.";
    setError(message);
    setPopupMessage(message);
    await notifyMissingAttendanceLocation(action);
  };

  const handleCheckIn = async () => {
    if (!checkInClickIntentRef.current) {
      setError("لا يتم تسجيل الحضور تلقائيًا. اضغط زر تسجيل الحضور للمتابعة.");
      return;
    }
    checkInClickIntentRef.current = false;
    if (!currentUser?.orgId || !currentUser?.employeeId) return;
    if (!isViewingToday) {
      setError("يمكن تسجيل الحضور لليوم الحالي فقط. غيّر التاريخ إلى اليوم للتسجيل.");
      return;
    }
    if (assignedLocations !== null && assignedLocations.length === 0) {
      await showMissingLocationPopup("check_in");
      return;
    }
    setSubmitting(true);
    setError("");

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    }).catch(() => null);

    if (!position) {
      setError("تعذّر تحديد موقعك. يرجى تفعيل خدمات الموقع.");
      setSubmitting(false);
      return;
    }

    const { latitude, longitude } = position.coords;
    const closestLocation = findClosestAllowedLocation(latitude, longitude);
    const radius = closestLocation?.radius || 0;
    const distance = Number.isFinite(closestLocation?.distance) ? Number(closestLocation?.distance) : 0;
    const withinGeofence = Boolean(closestLocation?.withinGeofence);

    if (!withinGeofence) {
      setError(outsideGeofenceMessage(distance, radius));
      setSubmitting(false);
      return;
    }

    const now = new Date();
    const deviceInfo = navigator.userAgent;
    const deviceFingerprint = getOrCreateDeviceFingerprint(currentUser.orgId);
    let status = "present";
    let lateMinutes = 0;

    if (shiftStartTime) {
      const [hours, minutes] = shiftStartTime.split(":");
      const shiftStart = new Date();
      shiftStart.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      if (now.getTime() > shiftStart.getTime()) {
        status = "late";
        lateMinutes = Math.max(0, Math.round((now.getTime() - shiftStart.getTime()) / 60000));
      }
    }

    const { error: err } = await createCheckIn({
      org_id: currentUser.orgId,
      employee_id: currentUser.employeeId,
      work_date: today,
      shift_id: shiftId,
      check_in_at: now.toISOString(),
      check_in_lat: latitude,
      check_in_lng: longitude,
      location_id: closestLocation?.location?.id,
      check_in_device: deviceInfo,
      device_fingerprint: deviceFingerprint,
      status,
      late_minutes: lateMinutes,
      within_geofence: withinGeofence,
      distance_meters: distance,
    });

    if (err) {
      setError(err.message);
    } else {
      refetch();
    }
    setSubmitting(false);
  };

  const handleCheckOut = async () => {
    if (!checkOutClickIntentRef.current) {
      setError("لا يتم تسجيل الانصراف تلقائيًا. اضغط زر تسجيل الانصراف للمتابعة.");
      return;
    }
    checkOutClickIntentRef.current = false;
    if (!currentUser?.orgId || !currentUser?.employeeId || !myAttendance) return;
    if (!isViewingToday) {
      setError("يمكن تسجيل الانصراف لليوم الحالي فقط. غيّر التاريخ إلى اليوم للتسجيل.");
      return;
    }
    if (assignedLocations !== null && assignedLocations.length === 0) {
      await showMissingLocationPopup("check_out");
      return;
    }
    setSubmitting(true);
    setError("");

    const attendanceId = typeof myAttendance.id === "string" ? myAttendance.id : "";
    if (!attendanceId) {
      setError("تعذّر إيجاد سجل الحضور.");
      setSubmitting(false);
      return;
    }

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    }).catch(() => null);

    if (!position) {
      setError("تعذّر تحديد موقعك. يرجى تفعيل خدمات الموقع.");
      setSubmitting(false);
      return;
    }

    const now = new Date();
    const deviceInfo = navigator.userAgent;
    const deviceFingerprint = getOrCreateDeviceFingerprint(currentUser.orgId);
    const { latitude, longitude } = position.coords;
    const closestLocation = findClosestAllowedLocation(latitude, longitude);
    const radius = closestLocation?.radius || 0;
    const distance = Number.isFinite(closestLocation?.distance) ? Number(closestLocation?.distance) : 0;
    const withinGeofence = Boolean(closestLocation?.withinGeofence);

    if (!withinGeofence) {
      setError(outsideGeofenceMessage(distance, radius));
      setSubmitting(false);
      return;
    }

    const checkInAt = typeof myAttendance.check_in_at === "string" ? myAttendance.check_in_at : null;
    const startTime = checkInAt ? new Date(checkInAt).getTime() : now.getTime();
    const totalMinutes = Math.max(0, Math.round((now.getTime() - startTime) / 60000));

    const { error: err } = await updateCheckOut(
      currentUser.orgId,
      currentUser.employeeId,
      attendanceId,
      {
        check_out_at: now.toISOString(),
        check_out_lat: latitude,
        check_out_lng: longitude,
        check_out_device: deviceInfo,
        device_fingerprint: deviceFingerprint,
        total_minutes: totalMinutes,
        check_out_within_geofence: withinGeofence,
        check_out_distance_meters: distance,
      }
    );

    if (err) {
      setError(err.message);
    } else {
      refetch();
    }

    setSubmitting(false);
  };

  if (loading || loadingEmployees || loadingLocations) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <MessageDialog
        open={Boolean(popupMessage)}
        onOpenChange={(open) => !open && setPopupMessage("")}
        title="موقع الحضور غير محدد"
        description={popupMessage}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الحضور</h1>
          <p className="text-gray-500 text-sm mt-1">التحقق من التواجد، متابعة التأخير، وتسجيل ساعات العمل.</p>
        </div>
        <div className="w-full sm:w-56">
          <label className="mb-2 block text-sm font-medium text-gray-700">تاريخ السجل</label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value || today)}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 border-none shadow-sm">
          <CardHeader>
            <CardTitle>تسجيل حضوري</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-gray-500">الحالة</p>
              <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">
                {myAttendance?.status ? (attendanceStatusLabels[String(myAttendance.status)] || String(myAttendance.status)) : "لم يُسجّل"}
              </Badge>
            </div>
            <Button
              className="w-full bg-brand hover:bg-brand-dark text-white"
              onClick={() => {
                checkInClickIntentRef.current = true;
                void handleCheckIn();
              }}
              disabled={submitting || !isViewingToday}
            >
              تسجيل الحضور
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                checkOutClickIntentRef.current = true;
                void handleCheckOut();
              }}
              disabled={submitting || !isViewingToday || !myAttendance?.check_in_at || Boolean(myAttendance?.check_out_at)}
            >
              {myAttendance?.check_out_at ? "مسجّل الانصراف" : "تسجيل الانصراف"}
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle>سجلات اليوم</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-600">الموظف</TableHead>
                  <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                  <TableHead className="font-semibold text-gray-600">تسجيل الحضور</TableHead>
                  <TableHead className="font-semibold text-gray-600">الفرع</TableHead>
                  <TableHead className="font-semibold text-gray-600">تسجيل الانصراف</TableHead>
                  <TableHead className="font-semibold text-gray-600">حالة الحضور</TableHead>
                  <TableHead className="font-semibold text-gray-600">حالة الانصراف</TableHead>
                  <TableHead className="font-semibold text-gray-600">الفروقات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAttendance.map((row) => {
                  const rowStatus = typeof row.status === "string" ? row.status : "present";
                  const checkInAt = typeof row.check_in_at === "string" ? row.check_in_at : null;
                  const checkOutAt = typeof row.check_out_at === "string" ? row.check_out_at : null;
                  const lateMinutes = typeof row.late_minutes === "number" ? row.late_minutes : 0;
                  const earlyArrivalMinutes = typeof row.early_arrival_minutes === "number" ? row.early_arrival_minutes : 0;
                  const earlyLeaveMinutes = typeof row.early_leave_minutes === "number" ? row.early_leave_minutes : 0;
                  const overtimeMinutes = typeof row.overtime_minutes === "number" ? row.overtime_minutes : 0;
                  const arrivalStatus = typeof row.arrival_status === "string" ? row.arrival_status : "on_time";
                  const departureStatus = typeof row.departure_status === "string" ? row.departure_status : "";
                  const employee = (row.employee ?? null) as Record<string, unknown> | null;
                  const rowLocation = (row.location ?? null) as Record<string, unknown> | null;
                  const rowShift = (row.shift ?? null) as Record<string, unknown> | null;
                  const shiftLocation = (rowShift?.location ?? null) as Record<string, unknown> | null;
                  const employeeName = typeof employee?.full_name === "string" ? employee.full_name : "—";
                  const locationName = String(rowLocation?.name || shiftLocation?.name || "—");
                  const differences = [
                    lateMinutes > 0 ? `تأخير ${lateMinutes}د` : "",
                    earlyArrivalMinutes > 0 ? `مبكر ${earlyArrivalMinutes}د` : "",
                    earlyLeaveMinutes > 0 ? `انصراف مبكر ${earlyLeaveMinutes}د` : "",
                    overtimeMinutes > 0 ? `إضافي ${overtimeMinutes}د` : "",
                  ].filter(Boolean);
                  return (
                    <TableRow key={String(row.id)}>
                      <TableCell className="font-medium text-gray-900">{employeeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={rowStatus === "late" ? "bg-amber-50 text-amber-700 border-amber-200" : rowStatus === "absent" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}>
                          {attendanceStatusLabels[rowStatus] || rowStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-600">{checkInAt ? new Date(checkInAt).toLocaleTimeString() : "—"}</TableCell>
                      <TableCell className="text-gray-600">{locationName}</TableCell>
                      <TableCell className="text-gray-600">{checkOutAt ? new Date(checkOutAt).toLocaleTimeString() : "—"}</TableCell>
                      <TableCell className="text-gray-600">{arrivalStatusLabels[arrivalStatus] || arrivalStatus}</TableCell>
                      <TableCell className="text-gray-600">{departureStatus ? departureStatusLabels[departureStatus] || departureStatus : "—"}</TableCell>
                      <TableCell className="text-gray-600">{differences.length > 0 ? differences.join("، ") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
