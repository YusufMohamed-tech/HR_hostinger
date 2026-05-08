"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createCheckIn, updateCheckOut, uploadAttendanceSelfie } from "@/lib/services/attendance";
import { PageSkeleton } from "@/components/Skeletons";

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export default function AttendancePage() {
  const { currentUser } = useRoleContext();
  const today = new Date().toISOString().split("T")[0];
  const { data: attendance, loading, refetch } = useAttendance(today);
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();
  const { data: employeeShifts } = useEmployeeShifts(currentUser?.employeeId);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const isAdmin = currentUser?.role === "Admin";
  const myAttendance = attendance.find((row) => row.employee_id === currentUser?.employeeId);

  const assignedLocation = useMemo(() => {
    if (!currentUser?.employeeId) return null;
    const employee = employees.find((emp) => emp.id === currentUser.employeeId);
    if (!employee?.location_id) return null;
    return locations.find((loc) => loc.id === employee.location_id) || null;
  }, [currentUser?.employeeId, employees, locations]);

  const assignedShift = employeeShifts[0]?.shift;

  const handleCheckIn = async () => {
    if (!currentUser?.orgId || !currentUser?.employeeId) return;
    if (!photoFile) {
      setError("Please attach a selfie for check-in.");
      return;
    }
    setSubmitting(true);
    setError("");

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    }).catch(() => null);

    if (!position) {
      setError("Unable to fetch GPS location. Please enable location services.");
      setSubmitting(false);
      return;
    }

    const { latitude, longitude } = position.coords;
    const radius = assignedLocation?.radius_meters || 100;
    const distance = assignedLocation?.latitude && assignedLocation?.longitude
      ? haversineDistance(latitude, longitude, Number(assignedLocation.latitude), Number(assignedLocation.longitude))
      : 0;
    const withinGeofence = !assignedLocation || distance <= radius;

    if (!withinGeofence) {
      setError("You are outside the allowed radius. Please move closer to your assigned location.");
      setSubmitting(false);
      return;
    }

    const now = new Date();
    const deviceInfo = navigator.userAgent;
    let status = "present";
    let lateMinutes = 0;

    if (assignedShift?.start_time) {
      const [hours, minutes] = String(assignedShift.start_time).split(":");
      const shiftStart = new Date();
      shiftStart.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      if (now.getTime() > shiftStart.getTime()) {
        status = "late";
        lateMinutes = Math.max(0, Math.round((now.getTime() - shiftStart.getTime()) / 60000));
      }
    }

    const { data: uploadData, error: uploadError } = await uploadAttendanceSelfie(
      currentUser.orgId,
      currentUser.employeeId,
      today,
      photoFile
    );

    if (uploadError) {
      setError(uploadError.message);
      setSubmitting(false);
      return;
    }

    const { error: err } = await createCheckIn({
      org_id: currentUser.orgId,
      employee_id: currentUser.employeeId,
      work_date: today,
      shift_id: assignedShift?.id || undefined,
      check_in_at: now.toISOString(),
      check_in_lat: latitude,
      check_in_lng: longitude,
      check_in_device: deviceInfo,
      check_in_photo_path: uploadData?.path || undefined,
      status,
      late_minutes: lateMinutes,
      within_geofence: withinGeofence,
      distance_meters: distance,
    });

    if (err) {
      setError(err.message);
    } else {
      refetch();
      setPhotoFile(null);
    }
    setSubmitting(false);
  };

  const handleCheckOut = async () => {
    if (!currentUser?.employeeId || !myAttendance) return;
    setSubmitting(true);
    setError("");

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    }).catch(() => null);

    if (!position) {
      setError("Unable to fetch GPS location. Please enable location services.");
      setSubmitting(false);
      return;
    }

    const now = new Date();
    const deviceInfo = navigator.userAgent;
    const startTime = myAttendance.check_in_at ? new Date(myAttendance.check_in_at).getTime() : now.getTime();
    const totalMinutes = Math.max(0, Math.round((now.getTime() - startTime) / 60000));

    const { error: err } = await updateCheckOut(myAttendance.id, {
      check_out_at: now.toISOString(),
      check_out_lat: position.coords.latitude,
      check_out_lng: position.coords.longitude,
      check_out_device: deviceInfo,
      total_minutes: totalMinutes,
    });

    if (err) {
      setError(err.message);
    } else {
      refetch();
    }

    setSubmitting(false);
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
        <p className="text-gray-500 text-sm mt-1">Verify presence, track late arrivals, and record work hours.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 border-none shadow-sm">
          <CardHeader>
            <CardTitle>My Check-in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Status</p>
              <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">
                {myAttendance?.status || "Not checked"}
              </Badge>
            </div>
            <div className="space-y-2">
              <Label>Selfie (check-in only)</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setPhotoFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
              />
            </div>
            <Button
              className="w-full bg-brand hover:bg-brand-dark text-white"
              onClick={handleCheckIn}
              disabled={submitting || Boolean(myAttendance?.check_in_at)}
            >
              {myAttendance?.check_in_at ? "Checked In" : "I Arrived"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCheckOut}
              disabled={submitting || !myAttendance?.check_in_at || Boolean(myAttendance?.check_out_at)}
            >
              {myAttendance?.check_out_at ? "Checked Out" : "I Left"}
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle>Today&apos;s Records</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                  <TableHead className="font-semibold text-gray-600">Status</TableHead>
                  <TableHead className="font-semibold text-gray-600">Check-in</TableHead>
                  <TableHead className="font-semibold text-gray-600">Check-out</TableHead>
                  <TableHead className="font-semibold text-gray-600">Late (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(isAdmin ? attendance : attendance.filter((row) => row.employee_id === currentUser?.employeeId)).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-gray-900">{row.employee?.full_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={row.status === "late" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}>
                        {row.status || "present"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{row.check_in_at ? new Date(row.check_in_at).toLocaleTimeString() : "—"}</TableCell>
                    <TableCell className="text-gray-600">{row.check_out_at ? new Date(row.check_out_at).toLocaleTimeString() : "—"}</TableCell>
                    <TableCell className="text-gray-600">{row.late_minutes ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
