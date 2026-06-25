"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { useAttendance, useEmployees, useLocations } from "@/hooks/use-data";
import { createCheckIn, updateCheckOut } from "@/lib/services/attendance";

const AUTO_ATTENDANCE_RADIUS_METERS = 50;
// Poll every 90 seconds to detect if user entered/left geofence
const POLL_INTERVAL_MS = 90_000;

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

function getOrCreateDeviceFingerprint(orgId: string) {
  const key = `tatwir-attendance-device-id-${orgId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `${Date.now()}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, next);
  return next;
}

export function AutoAttendanceRecorder() {
  const { currentUser } = useRoleContext();
  const today = new Date().toISOString().split("T")[0];
  const { data: attendance, refetch } = useAttendance(today);
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();
  const [status, setStatus] = useState("");
  const lastCheckInAttemptRef = useRef(false);
  const lastCheckOutAttemptRef = useRef(false);

  const myAttendance = attendance.find((row) => row.employee_id === currentUser?.employeeId);
  const myAttendanceRecord = myAttendance as Record<string, unknown> | undefined;
  const myAttendanceId = typeof myAttendanceRecord?.id === "string" ? myAttendanceRecord.id : "";
  const myAttendanceCheckInAt = typeof myAttendanceRecord?.check_in_at === "string" ? myAttendanceRecord.check_in_at : "";
  const myAttendanceCheckOutAt = typeof myAttendanceRecord?.check_out_at === "string" ? myAttendanceRecord.check_out_at : "";

  const assignedLocation = useMemo(() => {
    if (!currentUser?.employeeId) return null;
    const employee = employees.find((emp) => emp.id === currentUser.employeeId);
    if (!employee?.location_id) return null;
    return locations.find((location) => location.id === employee.location_id) || null;
  }, [currentUser?.employeeId, employees, locations]);

  const locationLatitude = assignedLocation ? Number(assignedLocation.latitude) : NaN;
  const locationLongitude = assignedLocation ? Number(assignedLocation.longitude) : NaN;

  const attemptCheckIn = useCallback(async () => {
    if (!currentUser?.orgId || !currentUser?.employeeId) return;
    if (lastCheckInAttemptRef.current) return;
    if (!assignedLocation || !Number.isFinite(locationLatitude) || !Number.isFinite(locationLongitude)) return;

    setStatus("جاري طلب موقعك لتسجيل الحضور تلقائيًا...");

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 15000,
      });
    });

    if (!position) {
      setStatus("لم يتم تسجيل الحضور. يرجى السماح للموقع من المتصفح.");
      return;
    }

    const { latitude, longitude } = position.coords;
    const distance = haversineDistance(latitude, longitude, locationLatitude, locationLongitude);

    if (distance > AUTO_ATTENDANCE_RADIUS_METERS) {
      setStatus("");
      return;
    }

    lastCheckInAttemptRef.current = true;
    const now = new Date();
    const { error } = await createCheckIn({
      org_id: currentUser.orgId,
      employee_id: currentUser.employeeId,
      work_date: today,
      check_in_at: now.toISOString(),
      check_in_lat: latitude,
      check_in_lng: longitude,
      check_in_device: navigator.userAgent,
      device_fingerprint: getOrCreateDeviceFingerprint(currentUser.orgId),
      status: "present",
      late_minutes: 0,
      within_geofence: true,
      distance_meters: distance,
    });

    if (error) {
      // Already checked in or device mismatch — clear status silently
      lastCheckInAttemptRef.current = false;
      setStatus("");
      return;
    }

    setStatus("تم تسجيل حضورك تلقائيًا بنجاح.");
    await refetch();
    window.setTimeout(() => setStatus(""), 5000);
  }, [
    assignedLocation,
    currentUser?.employeeId,
    currentUser?.orgId,
    locationLatitude,
    locationLongitude,
    refetch,
    today,
  ]);

  const attemptCheckOut = useCallback(async (attendanceId: string) => {
    if (!currentUser?.orgId || !currentUser?.employeeId) return;
    if (lastCheckOutAttemptRef.current) return;
    if (!assignedLocation || !Number.isFinite(locationLatitude) || !Number.isFinite(locationLongitude)) return;

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 15000,
      });
    });

    if (!position) return;

    const { latitude, longitude } = position.coords;
    const distance = haversineDistance(latitude, longitude, locationLatitude, locationLongitude);

    // Auto checkout only when user has left the geofence (> 200m away to avoid noise)
    if (distance <= 200) return;

    lastCheckOutAttemptRef.current = true;
    const now = new Date();
    const totalMinutes = myAttendanceCheckInAt
      ? Math.max(0, Math.round((now.getTime() - new Date(myAttendanceCheckInAt).getTime()) / 60000))
      : 0;

    const { error } = await updateCheckOut(
      currentUser.orgId,
      currentUser.employeeId,
      attendanceId,
      {
        check_out_at: now.toISOString(),
        check_out_lat: latitude,
        check_out_lng: longitude,
        check_out_device: navigator.userAgent,
        device_fingerprint: getOrCreateDeviceFingerprint(currentUser.orgId),
        total_minutes: totalMinutes,
        check_out_within_geofence: false,
        check_out_distance_meters: distance,
      }
    );

    if (!error) {
      setStatus("تم تسجيل انصرافك تلقائيًا.");
      await refetch();
      window.setTimeout(() => setStatus(""), 5000);
    } else {
      lastCheckOutAttemptRef.current = false;
    }
  }, [
    assignedLocation,
    currentUser?.employeeId,
    currentUser?.orgId,
    locationLatitude,
    locationLongitude,
    myAttendanceCheckInAt,
    refetch,
  ]);

  // Periodic polling: check-in on range entry, check-out on range exit
  useEffect(() => {
    if (currentUser?.role !== "Employee" || !currentUser.orgId || !currentUser.employeeId) return;
    if (!assignedLocation || !Number.isFinite(locationLatitude) || !Number.isFinite(locationLongitude)) return;

    const poll = async () => {
      // Need latest attendance state — this runs inside effect so reads from closure
      if (!myAttendanceCheckInAt && !lastCheckInAttemptRef.current) {
        await attemptCheckIn();
      } else if (myAttendanceCheckInAt && !myAttendanceCheckOutAt && myAttendanceId) {
        await attemptCheckOut(myAttendanceId);
      }
    };

    // Initial run after a short delay
    const initTimer = window.setTimeout(poll, 3000);
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(interval);
    };
  }, [
    assignedLocation,
    attemptCheckIn,
    attemptCheckOut,
    currentUser?.employeeId,
    currentUser?.orgId,
    currentUser?.role,
    locationLatitude,
    locationLongitude,
    myAttendanceCheckInAt,
    myAttendanceCheckOutAt,
    myAttendanceId,
  ]);

  if (!status || currentUser?.role !== "Employee") return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-lg">
      {status}
    </div>
  );
}
