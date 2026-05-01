"use client";

import { useState, useEffect, useCallback } from "react";
import { useRoleContext } from "@/providers/RoleProvider";

/* ─── Services ─── */
import { getEmployees } from "@/lib/services/employees";
import { getDepartments } from "@/lib/services/departments";
import { getLocations } from "@/lib/services/locations";
import { getContracts } from "@/lib/services/contracts";
import { getOrganizations } from "@/lib/services/organizations";
import { getEvents } from "@/lib/services/events";
import { getKpiDefinitions } from "@/lib/services/analytics";
import { getPayrollCycles, getPayrollItems } from "@/lib/services/payroll";
import { getCourses } from "@/lib/services/learning";
import { getAuditLogs, getAiInsights, getTrackingSessions, getShifts, getHierarchy } from "@/lib/services/operations";

/* ─── Mock fallbacks ─── */
import {
  employees as mockEmployees,
  departments as mockDepartments,
  locations as mockLocations,
  contracts as mockContracts,
  organizations as mockOrganizations,
  events as mockEvents,
  kpiTargets as mockKpiTargets,
  payrollRuns as mockPayrollRuns,
  payrollPreview as mockPayrollPreview,
  courses as mockCourses,
  auditLogs as mockAuditLogs,
  aiInsights as mockAiInsights,
  trackingAlerts as mockTrackingAlerts,
  hierarchy as mockHierarchy,
} from "@/data/mock";

/**
 * Generic hook — fetches org-scoped data, falls back to mock when no orgId or on error.
 */
function useOrgData<T>(
  fetcher: (orgId: string) => Promise<{ data: T | null; error: unknown }>,
  mockData: T
) {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState<T>(mockData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orgId = currentUser?.orgId;

  const refetch = useCallback(async () => {
    if (!orgId) {
      setData(mockData);
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
      setData(mockData);
    } else if (result.data) {
      setData(result.data);
      setError(null);
    } else {
      setData(mockData);
    }

    setLoading(false);
  }, [orgId, fetcher, mockData]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/* ─── Core HR ─── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFetcher = (orgId: string) => Promise<{ data: any; error: unknown }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyList = any[];

export function useEmployees() {
  return useOrgData<AnyList>(getEmployees as AnyFetcher, mockEmployees);
}

export function useDepartments() {
  return useOrgData<AnyList>(getDepartments as AnyFetcher, mockDepartments);
}

export function useLocations() {
  return useOrgData<AnyList>(getLocations as AnyFetcher, mockLocations);
}

export function useContracts() {
  return useOrgData<AnyList>(getContracts as AnyFetcher, mockContracts);
}

export function useOrganizations() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>(mockOrganizations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await getOrganizations();
    if (result.error) {
      setError("Failed to load organizations");
      setData(mockOrganizations);
    } else if (result.data) {
      setData(result.data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}

/* ─── Events ─── */

export function useEvents() {
  return useOrgData<AnyList>(getEvents as AnyFetcher, mockEvents);
}

/* ─── Analytics / KPI ─── */

export function useKpiTargets() {
  return useOrgData<AnyList>(getKpiDefinitions as AnyFetcher, mockKpiTargets);
}

/* ─── Payroll ─── */

export function usePayrollRuns() {
  return useOrgData<AnyList>(getPayrollCycles as AnyFetcher, mockPayrollRuns);
}

export function usePayrollPreview() {
  return useOrgData<AnyList>(getPayrollItems as AnyFetcher, mockPayrollPreview);
}

/* ─── Learning ─── */

export function useCourses() {
  return useOrgData<AnyList>(getCourses as AnyFetcher, mockCourses);
}

/* ─── Audit / AI / Tracking ─── */

export function useAuditLogs() {
  return useOrgData<AnyList>(getAuditLogs as AnyFetcher, mockAuditLogs);
}

export function useAiInsights() {
  return useOrgData<AnyList>(getAiInsights as AnyFetcher, mockAiInsights);
}

export function useTrackingAlerts() {
  return useOrgData<AnyList>(getTrackingSessions as AnyFetcher, mockTrackingAlerts);
}

/* ─── Schedule / Hierarchy ─── */

export function useSchedule() {
  return useOrgData<AnyList>(getShifts as AnyFetcher, []);
}

export function useHierarchy() {
  return useOrgData<AnyList>(getHierarchy as AnyFetcher, mockHierarchy);
}

