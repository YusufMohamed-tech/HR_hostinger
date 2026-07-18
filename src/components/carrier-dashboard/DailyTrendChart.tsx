"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  value: number;
}

interface DailyTrendChartProps {
  data: DataPoint[];
  label?: string;
  color?: string;
}

export function DailyTrendChart({ data, label = "FPE", color = "#ef4444" }: DailyTrendChartProps) {
  const avg = data.length > 0 ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;

  return (
    <div className="bg-[#16213e] rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-[#94a3b8]">{label} Daily Trend</span>
        <span className="text-xs text-[#94a3b8]">Avg: {Math.round(avg).toLocaleString()}</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => {
              const d = new Date(v);
              return String(d.getDate());
            }}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ backgroundColor: "#0f3460", border: "1px solid #1e4080", borderRadius: 6 }}
            labelStyle={{ color: "#94a3b8" }}
            itemStyle={{ color: "#fff" }}
            formatter={(v: number) => [v.toLocaleString(), label]}
            labelFormatter={(l) => new Date(l as string).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          />
          <ReferenceLine y={avg} stroke={color} strokeDasharray="4 4" strokeOpacity={0.6} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
