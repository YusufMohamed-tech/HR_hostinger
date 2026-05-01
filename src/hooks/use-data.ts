"use client";

import { useState, useEffect, useCallback } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { getEmployees } from "@/lib/services/employees";
import { getDepartments } from "@/lib/services/departments";
import { getLocations } from "@/lib/services/locations";
import { getContracts } from "@/lib/services/contracts";
import { getOrganizations } from "@/lib/services/organizations";

/**
 * Generic hook factory — fetches data from a service function scoped to the user's org.
 * Falls back to mock data when the user has no org_id (e.g. first-time setup).
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
      setError(typeof result.error === "object" && result.error !== null && "message" in result.error
        ? (result.error as { message: string }).message
        : "Failed to load data");
      setData(mockData); // Fallback to mock on error
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

/* ─── Concrete hooks ─── */

import {
  employees as mockEmployees,
  departments as mockDepartments,
  locations as mockLocations,
  contracts as mockContracts,
  organizations as mockOrganizations,
} from "@/data/mock";

export function useEmployees() {
  return useOrgData(
    getEmployees as (orgId: string) => Promise<{ data: typeof mockEmployees | null; error: unknown }>,
    mockEmployees
  );
}

export function useDepartments() {
  return useOrgData(
    getDepartments as (orgId: string) => Promise<{ data: typeof mockDepartments | null; error: unknown }>,
    mockDepartments
  );
}

export function useLocations() {
  return useOrgData(
    getLocations as (orgId: string) => Promise<{ data: typeof mockLocations | null; error: unknown }>,
    mockLocations
  );
}

export function useContracts() {
  return useOrgData(
    getContracts as (orgId: string) => Promise<{ data: typeof mockContracts | null; error: unknown }>,
    mockContracts
  );
}

export function useOrganizations() {
  const [data, setData] = useState(mockOrganizations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await getOrganizations();
    if (result.error) {
      setError("Failed to load organizations");
      setData(mockOrganizations);
    } else if (result.data) {
      setData(result.data as typeof mockOrganizations);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
