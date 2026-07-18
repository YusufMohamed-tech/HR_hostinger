"use client";

import { useEffect, useState, useCallback } from "react";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { CarrierGaugeChart } from "@/components/carrier-dashboard/CarrierGaugeChart";
import { HorizontalBarChart } from "@/components/carrier-dashboard/HorizontalBarChart";
import { HeatmapTable } from "@/components/carrier-dashboard/HeatmapTable";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CarrierKPIs, BundleBreakdownRow, SupervisorRow } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const BUNDLE_COLORS: Record<string, string> = {
  "+10": "#ddd6fe", "+20": "#c4b5fd", "+30": "#a78bfa",
  "+45": "#8b5cf6", "+70": "#6366f1", "+90": "#3b82f6",
};

function buildMonthRange(endMonth: string, count = 6): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let mo = m - i;
    let yr = y;
    while (mo < 1) { mo += 12; yr--; }
    months.push(`${yr}-${String(mo).padStart(2, "0")}`);
  }
  return months;
}

interface HeatmapData {
  months: string[];
  rows: Array<{ supervisorName: string; values: number[] }>;
}

export default function ExecutivePage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [bundles, setBundles] = useState<BundleBreakdownRow[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapData>({ months: [], rows: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({ month });
    const heatmapMonths = buildMonthRange(month, 6);

    try {
      const [kpisRes, bundlesRes, ...supResArray] = await Promise.all([
        fetch(`/api/sales/carrier-dashboard/kpis?${qp}`),
        fetch(`/api/sales/carrier-dashboard/bundles?${qp}`),
        ...heatmapMonths.map((m) => fetch(`/api/sales/carrier-dashboard/supervisors?month=${m}`)),
      ]);

      const [kpisJson, bundlesJson] = await Promise.all([
        kpisRes.json() as Promise<{ data?: CarrierKPIs }>,
        bundlesRes.json() as Promise<{ data?: BundleBreakdownRow[] }>,
      ]);
      const supData: SupervisorRow[][] = await Promise.all(
        supResArray.map((r) => r.json().then((j: { data?: SupervisorRow[] }) => j.data ?? []))
      );

      setKpis(kpisJson.data ?? null);
      setBundles(bundlesJson.data ?? []);

      // Pivot supervisor × month for heatmap
      const supervisorNames = new Map<string, string>();
      supData.forEach((monthRows) => {
        monthRows.forEach((r) => supervisorNames.set(r.supervisorId, r.supervisorName));
      });
      const heatRows = Array.from(supervisorNames.entries()).map(([id, name]) => ({
        supervisorName: name,
        values: supData.map((monthRows) => {
          const found = monthRows.find((r) => r.supervisorId === id);
          return found?.ibr ?? 0;
        }),
      }));
      setHeatmap({ months: heatmapMonths, rows: heatRows });
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  // Aggregate bundles by category
  const byCategory = new Map<string, number>();
  for (const r of bundles) {
    byCategory.set(r.bundleCategory, (byCategory.get(r.bundleCategory) ?? 0) + r.count);
  }
  const bundleChartData = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({
    label, value, color: BUNDLE_COLORS[label] ?? "#3b82f6",
  }));

  // Channel split
  const directCount = bundles.filter((r) => r.channel === "Direct Sales").reduce((s, r) => s + r.count, 0);
  const modernCount = bundles.filter((r) => r.channel === "Modern trade").reduce((s, r) => s + r.count, 0);
  const channelData = [
    { name: "Direct Sales", value: directCount, color: "#3b82f6" },
    { name: "Modern Trade", value: modernCount, color: "#8b5cf6" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Executive Monthly</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : kpis ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CarrierKPICard label="Total FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#ef4444" />
            <CarrierKPICard label="Revenue (IBR)" value={`${formatCarrierNumber(kpis.ibr)} SAR`} accentColor="#8b5cf6" />
            <CarrierKPICard label="Active Users" value={kpis.users.toLocaleString()} accentColor="#3b82f6" />
            <CarrierKPICard label="Employees" value={kpis.employees.toLocaleString()} accentColor="#22c55e" />
          </div>

          <div className="flex gap-6 justify-center flex-wrap">
            <CarrierGaugeChart value={kpis.fpe} target={Math.max(kpis.fpe, 1)} label="Activations" sublabel={`${month}`} size={160} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#16213e] rounded-lg p-4">
              <div className="text-sm text-[#94a3b8] mb-4">Bundle Contribution Ranking</div>
              <HorizontalBarChart data={bundleChartData} formatValue={(v) => v.toLocaleString()} />
            </div>
            <div className="bg-[#16213e] rounded-lg p-4">
              <div className="text-sm text-[#94a3b8] mb-4">Channel Share</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={channelData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    dataKey="value"
                  >
                    {channelData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f3460", border: "1px solid #1e4080", borderRadius: 6 }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <HeatmapTable
            title="Supervisor Revenue (IBR) — Last 6 Months"
            columnLabels={heatmap.months}
            rows={heatmap.rows.map((r) => ({
              rowLabel: r.supervisorName,
              cells: r.values.map((v) => ({ value: v })),
            }))}
            formatValue={(v) => `${formatCarrierNumber(v)}`}
          />
        </>
      ) : null}
    </div>
  );
}
