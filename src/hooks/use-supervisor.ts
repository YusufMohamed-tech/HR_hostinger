"use client";

import { useState, useEffect, useCallback } from "react";

interface SupervisorLocation {
  id: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  is_primary: boolean;
}

interface SiteEvaluation {
  id: string;
  location_id: string;
  evaluation_date: string;
  overall_score: number | null;
  status: string;
  comment: string | null;
  submitted_at: string;
  locations?: { id: string; name: string; type: string } | null;
  employees?: { id: string; full_name: string } | null;
}

export function useSupervisorLocations() {
  const [locations, setLocations] = useState<SupervisorLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch("/api/supervisor/locations");
      if (res.ok) {
        const json = await res.json();
        setLocations(json.locations ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { locations, loading, refetch: fetch };
}

export function useSiteEvaluations(filters?: {
  location_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}) {
  const [evaluations, setEvaluations] = useState<SiteEvaluation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters?.location_id) params.set("location_id", filters.location_id);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.date_from) params.set("date_from", filters.date_from);
      if (filters?.date_to) params.set("date_to", filters.date_to);
      if (filters?.page) params.set("page", String(filters.page));
      if (filters?.limit) params.set("limit", String(filters.limit));

      const res = await window.fetch(`/api/supervisor/evaluations?${params.toString()}`);
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
  }, [filters?.location_id, filters?.status, filters?.date_from, filters?.date_to, filters?.page, filters?.limit]);

  useEffect(() => { fetch(); }, [fetch]);

  return { evaluations, total, loading, refetch: fetch };
}

export function useChecklistTemplates(locationType?: string) {
  const [templates, setTemplates] = useState<Array<{
    id: string;
    name: string;
    items: Array<{ id: string; label: string; type: string; required: boolean; order: number }>;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (locationType) params.set("location_type", locationType);
      const res = await window.fetch(`/api/supervisor/checklist-templates?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setTemplates(json.templates ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [locationType]);

  useEffect(() => { fetch(); }, [fetch]);

  return { templates, loading, refetch: fetch };
}
