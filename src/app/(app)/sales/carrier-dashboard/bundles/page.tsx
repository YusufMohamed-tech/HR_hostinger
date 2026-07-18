"use client";

import { useEffect, useState, useCallback } from "react";
import { HorizontalBarChart } from "@/components/carrier-dashboard/HorizontalBarChart";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import type { BundleBreakdownRow } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const BUNDLE_COLORS: Record<string, string> = {
  "+10": "#ddd6fe",
  "+20": "#c4b5fd",
  "+30": "#a78bfa",
  "+45": "#8b5cf6",
  "+70": "#6366f1",
  "+90": "#3b82f6",
};

export default function BundlesPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [brand, setBrand] = useState("");
  const [rows, setRows] = useState<BundleBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({ month });
    if (brand) qp.set("segment_brand", brand);
    try {
      const res = await fetch(`/api/sales/carrier-dashboard/bundles?${qp}`);
      const json = await res.json() as { data?: BundleBreakdownRow[] };
      setRows(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [month, brand]);

  useEffect(() => { load(); }, [load]);

  // Aggregate by bundle category (collapsed across channel/region)
  const byCategory = new Map<string, { count: number; ibr: number }>();
  for (const r of rows) {
    const existing = byCategory.get(r.bundleCategory) ?? { count: 0, ibr: 0 };
    existing.count += r.count;
    existing.ibr += r.ibr;
    byCategory.set(r.bundleCategory, existing);
  }

  const chartData = [...byCategory.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([label, vals]) => ({
      label,
      value: vals.count,
      color: BUNDLE_COLORS[label] ?? "#3b82f6",
    }));

  const totalFPE = [...byCategory.values()].reduce((s, v) => s + v.count, 0);
  const totalIBR = [...byCategory.values()].reduce((s, v) => s + v.ibr, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Bundle Analysis</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-[#0f3460] rounded p-0.5">
            {["", "FRiENDi mobile", "Virgin Mobile"].map((b) => (
              <button
                key={b}
                onClick={() => setBrand(b)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  brand === b ? "bg-blue-600 text-white" : "text-[#94a3b8] hover:text-white"
                }`}
              >
                {b === "" ? "All" : b === "FRiENDi mobile" ? "FRiENDi" : "Virgin"}
              </button>
            ))}
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CarrierKPICard label="Total FPE" value={formatCarrierNumber(totalFPE)} accentColor="#3b82f6" />
        <CarrierKPICard label="Total IBR" value={formatCarrierNumber(totalIBR)} accentColor="#8b5cf6" />
        <CarrierKPICard label="Categories" value={byCategory.size.toString()} accentColor="#f59e0b" />
        <CarrierKPICard label="Avg IBR/FPE" value={totalFPE > 0 ? formatCarrierNumber(totalIBR / totalFPE) : "0"} accentColor="#22c55e" />
      </div>

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <div className="bg-[#16213e] rounded-lg p-4">
          <div className="text-sm text-[#94a3b8] mb-4">FPE by Bundle Category</div>
          <HorizontalBarChart
            data={chartData}
            formatValue={(v) => v.toLocaleString()}
          />
        </div>
      )}

      {/* Per-channel/region breakdown table */}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#0f3460]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460]">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Category</th>
                <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Channel</th>
                <th className="px-3 py-2 text-left text-xs text-[#94a3b8] font-medium">Region</th>
                <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">FPE</th>
                <th className="px-3 py-2 text-right text-xs text-[#94a3b8] font-medium">IBR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0f3460]">
              {rows.map((r, i) => (
                <tr key={i} className="bg-[#16213e] hover:bg-[#1e3a5f] transition-colors">
                  <td className="px-3 py-2">
                    <span className="font-mono text-white" style={{ color: BUNDLE_COLORS[r.bundleCategory] ?? "#fff" }}>
                      {r.bundleCategory}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#94a3b8]">{r.channel ?? "—"}</td>
                  <td className="px-3 py-2 text-[#94a3b8]">{r.region ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-white tabular-nums">{r.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-[#94a3b8] tabular-nums">{formatCarrierNumber(r.ibr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
