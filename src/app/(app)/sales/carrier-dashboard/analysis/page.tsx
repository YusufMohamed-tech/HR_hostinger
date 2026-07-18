"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { DailyTrendChart } from "@/components/carrier-dashboard/DailyTrendChart";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import type { CarrierKPIs, DailyDataPoint, EmployeePerformanceRow } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const BUNDLE_LABELS = ["+10", "+20", "+30", "+45", "+70", "+90"];

export default function AnalysisPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [daily, setDaily] = useState<DailyDataPoint[]>([]);
  const [employees, setEmployees] = useState<EmployeePerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams({ month });
      const [kpisRes, dailyRes, empRes] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/kpis?${qp}`),
        fetch(`/api/sales/carrier-dashboard/daily?${qp}`),
        fetch(`/api/sales/carrier-dashboard/employees?${qp}`),
      ]);
      const [kpisJson, dailyJson, empJson] = await Promise.all([
        kpisRes.json() as Promise<{ data?: CarrierKPIs; message?: string }>,
        dailyRes.json() as Promise<{ data?: DailyDataPoint[]; message?: string }>,
        empRes.json() as Promise<{ data?: EmployeePerformanceRow[]; message?: string }>,
      ]);
      if (!kpisRes.ok) throw new Error(kpisJson.message);
      setKpis(kpisJson.data ?? null);
      setDaily(dailyJson.data ?? []);
      setEmployees(empJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const trendData = daily.map((d) => ({ date: d.date, value: d.fpe }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Analysis</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="bg-[#16213e] rounded-lg h-24 animate-pulse" />)}
        </div>
      ) : kpis ? (
        <>
          {/* Top KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <CarrierKPICard label="FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#ef4444" />
            <CarrierKPICard label="FPE Friendi" value={formatCarrierNumber(kpis.fpeFriendi)} accentColor="#3b82f6" />
            <CarrierKPICard label="FPE Virgin" value={formatCarrierNumber(kpis.fpeVirgin)} accentColor="#ef4444" />
            <CarrierKPICard label="Postpaid" value={kpis.postpaid.toLocaleString()} accentColor="#22c55e" />
            <CarrierKPICard label="HBB" value={kpis.hbb.toLocaleString()} accentColor="#06b6d4" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <CarrierKPICard label="IBR Total" value={`${formatCarrierNumber(kpis.ibr)}`} accentColor="#8b5cf6" />
            <CarrierKPICard label="IBR Friendi" value={formatCarrierNumber(kpis.ibrFriendi)} accentColor="#3b82f6" />
            <CarrierKPICard label="IBR Virgin" value={formatCarrierNumber(kpis.ibrVirgin)} accentColor="#ef4444" />
            <CarrierKPICard label="Users" value={kpis.users.toLocaleString()} accentColor="#f59e0b" />
            <CarrierKPICard label="Employees" value={kpis.employees.toLocaleString()} accentColor="#ec4899" />
          </div>

          {/* Employee table */}
          <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
            <table className="w-full text-sm">
              <thead className="bg-[#0f3460]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Employee</th>
                  <th className="px-3 py-2 text-center text-xs text-[#94a3b8] font-medium">GOSI</th>
                  <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">FPE</th>
                  {BUNDLE_LABELS.map((b) => (
                    <th key={b} className="px-2 py-2 text-right text-xs text-[#94a3b8] font-medium">{b}</th>
                  ))}
                  <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">Friendi</th>
                  <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">Virgin</th>
                  <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">Post</th>
                  <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0f3460]">
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={10 + BUNDLE_LABELS.length} className="px-3 py-4 text-center text-[#94a3b8]">
                      No data for this month
                    </td>
                  </tr>
                ) : employees.map((emp) => (
                  <tr key={emp.employeeId} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                    <td className="px-3 py-2 text-white max-w-xs truncate" title={emp.employeeName}>
                      {emp.employeeName}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {emp.gosiRegistered
                        ? <span className="text-green-400 text-xs">✓</span>
                        : <span className="text-[#64748b] text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-white tabular-nums font-medium">{emp.fpe}</td>
                    {BUNDLE_LABELS.map((b) => (
                      <td key={b} className="px-2 py-2 text-right text-[#94a3b8] tabular-nums text-xs">
                        {emp.bundleCounts[b] ?? 0}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-[#3b82f6] tabular-nums">{emp.fpeFriendi}</td>
                    <td className="px-3 py-2 text-right text-[#ef4444] tabular-nums">{emp.fpeVirgin}</td>
                    <td className="px-3 py-2 text-right text-[#22c55e] tabular-nums">{emp.postpaid}</td>
                    <td className="px-3 py-2 text-right text-[#94a3b8] tabular-nums">
                      {emp.fpeTarget !== null ? emp.fpeTarget : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {employees.length > 0 && (
                <tfoot className="bg-[#0f3460]">
                  <tr>
                    <td className="px-3 py-2 text-xs text-[#94a3b8] font-medium">Totals</td>
                    <td></td>
                    <td className="px-3 py-2 text-right text-white font-bold tabular-nums">
                      {employees.reduce((s, e) => s + e.fpe, 0)}
                    </td>
                    {BUNDLE_LABELS.map((b) => (
                      <td key={b} className="px-2 py-2 text-right text-[#94a3b8] text-xs tabular-nums">
                        {employees.reduce((s, e) => s + (e.bundleCounts[b] ?? 0), 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-[#3b82f6] font-bold tabular-nums">
                      {employees.reduce((s, e) => s + e.fpeFriendi, 0)}
                    </td>
                    <td className="px-3 py-2 text-right text-[#ef4444] font-bold tabular-nums">
                      {employees.reduce((s, e) => s + e.fpeVirgin, 0)}
                    </td>
                    <td className="px-3 py-2 text-right text-[#22c55e] font-bold tabular-nums">
                      {employees.reduce((s, e) => s + e.postpaid, 0)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Daily trend */}
          <DailyTrendChart data={trendData} label="Total FPE" />
        </>
      ) : null}
    </div>
  );
}
