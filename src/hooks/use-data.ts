"use client";

import { useState, useEffect, useCallback } from "react";
import { useRoleContext } from "@/providers/RoleProvider";

import { getEmployees } from "@/lib/services/employees";
import { getDepartments } from "@/lib/services/departments";
import { getLocations } from "@/lib/services/locations";
import { getShifts, getEmployeeShifts } from "@/lib/services/schedule";
import { getAttendance } from "@/lib/services/attendance";
import { getTasks } from "@/lib/services/tasks";
import { getLeaveRequests, getLeaveBalances } from "@/lib/services/leaves";
import { getNotifications } from "@/lib/services/notifications";
import { getOrganizations } from "@/lib/services/organizations";

type Fetcher<T> = (orgId: string) => Promise<{ data: T | null; error: unknown }>;

function useOrgData<T>(fetcher: Fetcher<T>, initial: T) {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orgId = currentUser?.orgId;

  const refetch = useCallback(async () => {
    if (!orgId) {
      setData(initial);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await fetcher(orgId);

    if (result.error) {
      setError(
        typeof result.error === "object" && result.error !== null && "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to load data"
      );
      setData(initial);
    } else if (result.data) {
      setData(result.data);
      setError(null);
    } else {
      setData(initial);
    }

    setLoading(false);
  }, [orgId, fetcher, initial]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// Core HR
export function useEmployees() {
  return useOrgData<Record<string, unknown>[]>(getEmployees as Fetcher<Record<string, unknown>[]>, []);
}

export function useDepartments() {
  return useOrgData<Record<string, unknown>[]>(getDepartments as Fetcher<Record<string, unknown>[]>, []);
}

export function useLocations() {
  return useOrgData<Record<string, unknown>[]>(getLocations as Fetcher<Record<string, unknown>[]>, []);
}

// Shifts
export function useShifts() {
  return useOrgData<Record<string, unknown>[]>(getShifts as Fetcher<Record<string, unknown>[]>, []);
}

// Backwards-compatible alias for legacy pages
export function useSchedule() {
  return useShifts();
}

export function useEmployeeShifts(employeeId?: string) {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!currentUser?.orgId) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await getEmployeeShifts(currentUser.orgId, employeeId);
    setData(result.data || []);
    setLoading(false);
  }, [currentUser?.orgId, employeeId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, refetch };
}

// Attendance
export function useAttendance(workDate?: string) {
  const fetcher = useCallback(
    (orgId: string) => getAttendance(orgId, workDate),
    [workDate]
  );

  return useOrgData<Record<string, unknown>[]>(fetcher as Fetcher<Record<string, unknown>[]>, []);
}

// Tasks
export function useTasks() {
  return useOrgData<Record<string, unknown>[]>(getTasks as Fetcher<Record<string, unknown>[]>, []);
}

// Leave
export function useLeaveRequests() {
  return useOrgData<Record<string, unknown>[]>(getLeaveRequests as Fetcher<Record<string, unknown>[]>, []);
}

export function useLeaveBalances(employeeId?: string) {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!currentUser?.orgId) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await getLeaveBalances(currentUser.orgId, employeeId);
    setData(result.data || []);
    setLoading(false);
  }, [currentUser?.orgId, employeeId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, refetch };
}

// Notifications
export function useNotifications() {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!currentUser?.orgId || !currentUser?.id) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await getNotifications(currentUser.orgId, currentUser.id);
    setData(result.data || []);
    setLoading(false);
  }, [currentUser?.orgId, currentUser?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, refetch };
}

// Organizations (admin)
export function useOrganizations() {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await getOrganizations();
    if (result.error) {
      setError("Failed to load organizations");
      setData([]);
    } else if (result.data) {
      setData(result.data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}


