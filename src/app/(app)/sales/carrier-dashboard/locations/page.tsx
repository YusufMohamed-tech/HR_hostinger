"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import type { LocationRow } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_COLORS: Record<LocationRow["status"], string> = {
  active: "#22c55e",
  acceptable: "#f59e0b",
  warning: "#f97316",
  inactive: "#ef4444",
};

const STATUS_ARABIC: Record<LocationRow["status"], string> = {
  active: "نشط",
  acceptable: "مقبول",
  warning: "تنبيه",
  inactive: "غير نشط",
};

export default function LocationsPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({ month });
    try {
      const res = await fetch(`/api/sales/carrier-dashboard/locations?${qp}`);
      const json = await res.json() as { data?: LocationRow[] };
      setLocations(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const empty = locations.filter((l) => l.status === "inactive").length;
  const avgCoverage = locations.length > 0
    ? locations.reduce((s, l) => s + l.coveragePercent, 0) / locations.length
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Location Monitoring</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CarrierKPICard label="Coverage Rate (معدل التغطية)" value={`${Math.round(avgCoverage)}%`} accentColor="#22c55e" />
        <CarrierKPICard label="Empty Locations (الفاضية)" value={empty.toString()} accentColor="#ef4444" />
        <CarrierKPICard label="Total Locations (عدد)" value={locations.length.toString()} accentColor="#3b82f6" />
        <CarrierKPICard label="Active Locations" value={locations.filter((l) => l.status === "active").length.toString()} accentColor="#22c55e" />
      </div>

      {/* Status legend */}
      <div className="flex gap-4 flex-wrap">
        {(["active", "acceptable", "warning", "inactive"] as LocationRow["status"][]).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: STATUS_COLORS[s] }} />
            <span dir="rtl">{STATUS_ARABIC[s]}</span>
            <span>({s})</span>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460]">
              <tr>
                {["Location", "Dealer Code", "Region", "Activations", "Days Active", "Coverage %", "Last Activation", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0f3460]">
              {locations.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-[#94a3b8]">No data</td></tr>
              ) : locations.map((loc, i) => (
                <tr key={i} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                  <td className="px-3 py-2 text-white max-w-xs truncate" title={loc.locationName}>{loc.locationName}</td>
                  <td className="px-3 py-2 font-mono text-blue-400">{loc.dealerCode}</td>
                  <td className="px-3 py-2 text-[#94a3b8]">{loc.region ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-white tabular-nums">{loc.totalActivations.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-[#94a3b8] tabular-nums">{loc.daysWithActivations}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: STATUS_COLORS[loc.status] }}>
                    {Math.round(loc.coveragePercent)}%
                  </td>
                  <td className="px-3 py-2 text-[#94a3b8]">{loc.lastActivationDate ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ color: STATUS_COLORS[loc.status], backgroundColor: `${STATUS_COLORS[loc.status]}20` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: STATUS_COLORS[loc.status] }} />
                      <span dir="rtl">{STATUS_ARABIC[loc.status]}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
