"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CarrierKPICard } from "@/components/carrier-dashboard/CarrierKPICard";
import type { HourlyPoint } from "@/lib/services/carrier-dashboard";

function getDefaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmt12(h: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

export default function ShiftsPage() {
  const [month, setMonth] = useState(getDefaultMonth);
  const [data, setData] = useState<HourlyPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({ month });
    try {
      const res = await fetch(`/api/sales/carrier-dashboard/shifts?${qp}`);
      const json = await res.json() as { data?: HourlyPoint[] };
      setData(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const totalMorning = data.reduce((s, d) => s + d.morning, 0);
  const totalNight = data.reduce((s, d) => s + d.night, 0);
  const peakHour = data.reduce((peak, d) => (d.morning + d.night > (peak?.morning ?? 0) + (peak?.night ?? 0) ? d : peak), data[0]);

  const chartData = data.map((d) => ({
    hour: fmt12(d.hour),
    Morning: d.morning,
    Night: d.night,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-white">Shift Monitoring</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-[#0f3460] text-white border border-[#1e4080] rounded px-2 py-1.5 text-sm focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CarrierKPICard label="Morning Activations" value={totalMorning.toLocaleString()} accentColor="#ef4444" />
        <CarrierKPICard label="Night Activations" value={totalNight.toLocaleString()} accentColor="#6b7280" />
        <CarrierKPICard label="Peak Hour (اقوى ساعة)" value={peakHour ? fmt12(peakHour.hour) : "—"} accentColor="#f59e0b" />
        <CarrierKPICard label="Total" value={(totalMorning + totalNight).toLocaleString()} accentColor="#22c55e" />
      </div>

      {loading ? (
        <p className="text-[#94a3b8] text-sm animate-pulse">Loading…</p>
      ) : (
        <div className="bg-[#16213e] rounded-lg p-4">
          <div className="text-sm text-[#94a3b8] mb-4">Hourly Distribution</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
              <XAxis dataKey="hour" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f3460", border: "1px solid #1e4080", borderRadius: 6 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#fff" }}
              />
              <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
              <Bar dataKey="Morning" fill="#ef4444" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Night" fill="#6b7280" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
