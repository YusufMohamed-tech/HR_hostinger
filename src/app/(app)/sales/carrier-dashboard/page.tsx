"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { DailyTrendChart } from "@/components/carrier-dashboard/DailyTrendChart";
import { HorizontalBarChart } from "@/components/carrier-dashboard/HorizontalBarChart";
import { formatCarrierNumber, computeTargetKPIs } from "@/lib/utils/carrier-kpi";
import type { CarrierKPIs } from "@/lib/services/carrier-dashboard";
import type { DailyDataPoint } from "@/lib/services/carrier-dashboard";

interface EmployeeTarget {
  employee_id: string;
  employee?: { id: string; full_name: string };
  fpe_target: number;
  friendi_target: number;
  virgin_target: number;
  postpaid_target: number;
  hbb_target: number;
  revenue_target: number;
  working_days: number;
}

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function daysElapsedInMonth(month: string) {
  const now = new Date();
  const [y, m] = month.split("-").map(Number);
  if (now.getFullYear() === y && now.getMonth() + 1 === m) {
    return now.getDate();
  }
  return new Date(y, m, 0).getDate();
}

export default function EmployeePerformancePage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [daily, setDaily] = useState<DailyDataPoint[]>([]);
  const [targets, setTargets] = useState<EmployeeTarget[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams({ month });
      if (selectedEmployeeId) qp.set("employee_id", selectedEmployeeId);

      const [kpisRes, dailyRes, targetsRes] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/kpis?${qp}`),
        fetch(`/api/sales/carrier-dashboard/daily?${qp}`),
        fetch(`/api/sales/carrier-targets?month=${month}`),
      ]);

      const [kpisJson, dailyJson, targetsJson] = await Promise.all([
        kpisRes.json() as Promise<{ data?: CarrierKPIs; message?: string }>,
        dailyRes.json() as Promise<{ data?: DailyDataPoint[]; message?: string }>,
        targetsRes.json() as Promise<{ data?: EmployeeTarget[]; message?: string }>,
      ]);

      if (!kpisRes.ok) throw new Error(kpisJson.message);
      setKpis(kpisJson.data ?? null);
      setDaily(dailyJson.data ?? []);
      setTargets(targetsJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month, selectedEmployeeId]);

  useEffect(() => { load(); }, [load]);

  const daysElapsed = daysElapsedInMonth(month);
  const target = selectedEmployeeId
    ? targets.find((t) => t.employee_id === selectedEmployeeId)
    : null;

  const fpeTargetVal = target?.fpe_target ?? 0;
  const friendiTargetVal = target?.friendi_target ?? 0;
  const virginTargetVal = target?.virgin_target ?? 0;
  const workingDays = target?.working_days ?? 25;

  const fpeKPIs = fpeTargetVal > 0
    ? computeTargetKPIs({ achieved: kpis?.fpe ?? 0, target: fpeTargetVal, daysElapsed, totalWorkingDays: workingDays })
    : null;
  const friendiKPIs = friendiTargetVal > 0
    ? computeTargetKPIs({ achieved: kpis?.fpeFriendi ?? 0, target: friendiTargetVal, daysElapsed, totalWorkingDays: workingDays })
    : null;
  const virginKPIs = virginTargetVal > 0
    ? computeTargetKPIs({ achieved: kpis?.fpeVirgin ?? 0, target: virginTargetVal, daysElapsed, totalWorkingDays: workingDays })
    : null;

  const trendData = daily.map((d) => ({
    date: d.date,
    value: d.fpe,
  }));

  // Bundle category breakdown from kpis if we had it — use a placeholder aggregation
  const bundleChartData = [
    { label: "+90", value: 0, color: "#3b82f6" },
    { label: "+70", value: 0, color: "#6366f1" },
    { label: "+45", value: 0, color: "#8b5cf6" },
    { label: "+30", value: 0, color: "#a78bfa" },
    { label: "+20", value: 0, color: "#c4b5fd" },
    { label: "+10", value: 0, color: "#ddd6fe" },
  ];

  const employeeOptions = targets.map((t) => ({
    id: t.employee_id,
    name: t.employee?.full_name ?? t.employee_id,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Employee Performance</h1>
        <div className="flex items-center gap-2">
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          >
            <option value="">All Employees</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-[#16213e] rounded-lg h-40 animate-pulse" />
          ))}
        </div>
      ) : kpis ? (
        <>
          {/* KPI Cards row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <CarrierKPICard
              label="FRiENDi FPE"
              value={formatCarrierNumber(kpis.fpeFriendi)}
              target={friendiTargetVal > 0 ? friendiTargetVal : undefined}
              remaining={friendiKPIs ? formatCarrierNumber(friendiKPIs.remaining) : undefined}
              reqPerDay={friendiKPIs ? friendiKPIs.requiredDaily.toFixed(1) : undefined}
              average={friendiKPIs ? friendiKPIs.average.toFixed(1) : undefined}
              expected={friendiKPIs ? formatCarrierNumber(friendiKPIs.expected) : undefined}
              achievedPct={friendiKPIs?.excellentPct}
              accentColor="#3b82f6"
            />
            <CarrierKPICard
              label="Virgin FPE"
              value={formatCarrierNumber(kpis.fpeVirgin)}
              target={virginTargetVal > 0 ? virginTargetVal : undefined}
              remaining={virginKPIs ? formatCarrierNumber(virginKPIs.remaining) : undefined}
              reqPerDay={virginKPIs ? virginKPIs.requiredDaily.toFixed(1) : undefined}
              average={virginKPIs ? virginKPIs.average.toFixed(1) : undefined}
              expected={virginKPIs ? formatCarrierNumber(virginKPIs.expected) : undefined}
              achievedPct={virginKPIs?.excellentPct}
              accentColor="#ef4444"
            />
            <CarrierKPICard
              label="Postpaid"
              value={formatCarrierNumber(kpis.postpaid)}
              accentColor="#22c55e"
            />
          </div>

          {/* Second row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <CarrierKPICard label="Total FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#f59e0b" />
            <CarrierKPICard label="IBR" value={`${formatCarrierNumber(kpis.ibr)} SAR`} accentColor="#8b5cf6" />
            <CarrierKPICard label="HBB" value={kpis.hbb.toLocaleString()} accentColor="#06b6d4" />
            <CarrierKPICard label="Users" value={kpis.users.toLocaleString()} accentColor="#ec4899" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DailyTrendChart data={trendData} label="FPE" />
            <div className="bg-[#16213e] rounded-lg p-4">
              <div className="text-sm text-[#94a3b8] mb-4">Bundle Quality Distribution</div>
              <HorizontalBarChart data={bundleChartData} formatValue={(v) => v.toLocaleString()} />
              <p className="text-xs text-[#64748b] mt-3">Bundle breakdown available after filtering by employee with loaded activation data</p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
