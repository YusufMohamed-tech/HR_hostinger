"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierGaugeChart } from "@/components/carrier-dashboard/CarrierGaugeChart";
import { DailyTrendChart } from "@/components/carrier-dashboard/DailyTrendChart";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import type { SupervisorRow, DailyDataPoint } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function SupervisorsPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([]);
  const [daily, setDaily] = useState<DailyDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams({ month });
      const [svRes, dailyRes] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/supervisors?${qp}`),
        fetch(`/api/sales/carrier-dashboard/daily?${qp}`),
      ]);
      const [svJson, dailyJson] = await Promise.all([
        svRes.json() as Promise<{ data?: SupervisorRow[]; message?: string }>,
        dailyRes.json() as Promise<{ data?: DailyDataPoint[]; message?: string }>,
      ]);
      if (!svRes.ok) throw new Error(svJson.message);
      setSupervisors(svJson.data ?? []);
      setDaily(dailyJson.data ?? []);
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
        <h1 className="text-lg font-bold text-white">Supervisors</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <>
          {/* Gauge pairs */}
          {supervisors.length > 0 && (
            <div className="flex flex-wrap gap-6 justify-center">
              {supervisors.slice(0, 4).map((sv) => (
                <div key={sv.supervisorId} className="flex gap-4 items-end">
                  <CarrierGaugeChart
                    value={sv.fpe}
                    target={sv.fpeTarget ?? sv.fpe}
                    label={sv.supervisorName}
                    sublabel="FPE"
                    size={120}
                  />
                  <CarrierGaugeChart
                    value={sv.ibr}
                    target={sv.revenueTarget ?? sv.ibr}
                    label={sv.supervisorName}
                    sublabel="Revenue"
                    size={120}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Supervisor table */}
          <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
            <table className="w-full text-sm">
              <thead className="bg-[#0f3460]">
                <tr>
                  {["Supervisor", "Employees", "Postpaid", "HBB", "FPE", "FPE Target", "Revenue", "Rev Target"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0f3460]">
                {supervisors.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-[#94a3b8]">No data</td></tr>
                ) : supervisors.map((sv) => (
                  <tr key={sv.supervisorId} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                    <td className="px-3 py-2 text-white font-medium">{sv.supervisorName}</td>
                    <td className="px-3 py-2 text-[#94a3b8] tabular-nums">{sv.employeeCount}</td>
                    <td className="px-3 py-2 text-[#22c55e] tabular-nums">{sv.postpaid}</td>
                    <td className="px-3 py-2 text-[#06b6d4] tabular-nums">{sv.hbb}</td>
                    <td className="px-3 py-2 text-white font-bold tabular-nums">{sv.fpe.toLocaleString()}</td>
                    <td className="px-3 py-2 text-[#94a3b8] tabular-nums">{sv.fpeTarget?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2 text-white tabular-nums">{formatCarrierNumber(sv.ibr)}</td>
                    <td className="px-3 py-2 text-[#94a3b8] tabular-nums">{sv.revenueTarget ? formatCarrierNumber(sv.revenueTarget) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DailyTrendChart data={trendData} label="Total FPE" />
        </>
      )}
    </div>
  );
}
