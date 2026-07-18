"use client";

import { useEffect, useState, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import { formatCarrierNumber } from "@/lib/utils/carrier-kpi";
import type { CarrierKPIs } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBack(current: string, count: number): string[] {
  const months: string[] = [];
  let [y, m] = current.split("-").map(Number);
  for (let i = 0; i < count; i++) {
    months.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return months;
}

export default function MomentumPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [kpis, setKpis] = useState<CarrierKPIs | null>(null);
  const [trendData, setTrendData] = useState<{ month: string; fpe: number; ibr: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const months = monthsBack(month, 7);
    try {
      const results = await Promise.all(
        months.map((m) =>
          fetch(`/api/sales/carrier-dashboard/kpis?month=${m}`)
            .then((r) => r.json() as Promise<{ data?: CarrierKPIs }>)
            .then((j) => ({ month: m, fpe: j.data?.fpe ?? 0, ibr: j.data?.ibr ?? 0 }))
        )
      );
      setTrendData(results);
      const current = results.find((r) => r.month === month);
      setKpis(current ? { fpe: current.fpe, ibr: current.ibr, fpeFriendi: 0, fpeVirgin: 0, postpaid: 0, hbb: 0, ibrFriendi: 0, ibrVirgin: 0, users: 0, employees: 0, activationsTotal: 0 } : null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const chartData = trendData.map((d) => ({
    month: d.month.slice(5), // MM
    FPE: d.fpe,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Performance Momentum</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <CarrierKPICard label="FPE" value={formatCarrierNumber(kpis.fpe)} accentColor="#ef4444" />
          <CarrierKPICard label="IBR" value={formatCarrierNumber(kpis.ibr)} accentColor="#8b5cf6" />
          <CarrierKPICard label="Users" value={kpis.users.toLocaleString()} accentColor="#3b82f6" />
          <CarrierKPICard label="Employees" value={kpis.employees.toLocaleString()} accentColor="#22c55e" />
        </div>
      )}

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <div className="bg-[#16213e] rounded-lg p-4">
          <div className="text-sm text-[#94a3b8] mb-4">Performance Momentum (last 7 months)</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fpeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f3460", border: "1px solid #1e4080", borderRadius: 6 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#fff" }}
              />
              <Area type="monotone" dataKey="FPE" stroke="#ef4444" fill="url(#fpeGrad)" strokeWidth={2} dot={{ fill: "#ef4444", r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
