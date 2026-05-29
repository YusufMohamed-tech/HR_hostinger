"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { useAttendance, useEmployees, useLocations } from "@/hooks/use-data";
import { createCheckIn } from "@/lib/services/attendance";

const AUTO_ATTENDANCE_RADIUS_METERS = 50;

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

function getOrCreateDeviceFingerprint() {
  const key = "tatwir-attendance-device-id";
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
  const attemptedRef = useRef(false);
  const [status, setStatus] = useState("");

  const myAttendance = attendance.find((row) => row.employee_id === currentUser?.employeeId);

  const assignedLocation = useMemo(() => {
    if (!currentUser?.employeeId) return null;
    const employee = employees.find((emp) => emp.id === currentUser.employeeId);
    if (!employee?.location_id) return null;
    return locations.find((location) => location.id === employee.location_id) || null;
  }, [currentUser?.employeeId, employees, locations]);

  useEffect(() => {
    if (currentUser?.role !== "Employee" || !currentUser.orgId || !currentUser.employeeId) return;
    if (attemptedRef.current || myAttendance?.check_in_at) return;
    if (!assignedLocation) return;

    const locationLatitude = Number(assignedLocation.latitude);
    const locationLongitude = Number(assignedLocation.longitude);
    if (!Number.isFinite(locationLatitude) || !Number.isFinite(locationLongitude)) {
      attemptedRef.current = true;
      setStatus("لا يمكن تسجيل الحضور تلقائيًا لأن موقعك لا يحتوي على إحداثيات.");
      return;
    }

    attemptedRef.current = true;
    setStatus("جاري طلب موقعك لتسجيل الحضور تلقائيًا...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const distance = haversineDistance(latitude, longitude, locationLatitude, locationLongitude);

        if (distance > AUTO_ATTENDANCE_RADIUS_METERS) {
          setStatus(`أنت خارج نطاق الحضور. المسافة الحالية ${distance}م والحد المسموح 50م.`);
          return;
        }

        const now = new Date();
        const { error } = await createCheckIn({
          org_id: currentUser.orgId,
          employee_id: currentUser.employeeId,
          work_date: today,
          check_in_at: now.toISOString(),
          check_in_lat: latitude,
          check_in_lng: longitude,
          check_in_device: navigator.userAgent,
          device_fingerprint: getOrCreateDeviceFingerprint(),
          status: "present",
          late_minutes: 0,
          within_geofence: true,
          distance_meters: distance,
        });

        if (error) {
          setStatus(error.message);
          return;
        }

        setStatus("تم تسجيل حضورك تلقائيًا بنجاح.");
        await refetch();
        window.setTimeout(() => setStatus(""), 5000);
      },
      () => {
        setStatus("لم يتم تسجيل الحضور. يرجى السماح للموقع من المتصفح.");
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
  }, [assignedLocation, currentUser, myAttendance?.check_in_at, refetch, today]);

  if (!status || currentUser?.role !== "Employee") return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-lg">
      {status}
    </div>
  );
}
