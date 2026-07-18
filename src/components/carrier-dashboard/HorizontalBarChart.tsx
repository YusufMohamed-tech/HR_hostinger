"use client";

interface BarRow {
  label: string;
  value: number;
  color?: string;
  secondaryValue?: number;
  secondaryLabel?: string;
}

interface HorizontalBarChartProps {
  data: BarRow[];
  maxValue?: number;
  formatValue?: (v: number) => string;
  defaultColor?: string;
}

export function HorizontalBarChart({
  data,
  maxValue,
  formatValue = (v) => v.toLocaleString(),
  defaultColor = "#3b82f6",
}: HorizontalBarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex flex-col gap-2">
      {data.map((row, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0">
          <div className="w-28 shrink-0 text-xs text-[#94a3b8] text-right truncate" title={row.label}>
            {row.label}
          </div>
          <div className="flex-1 h-5 bg-[#0f3460] rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-300"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: row.color ?? defaultColor,
              }}
            />
          </div>
          <div className="w-16 shrink-0 text-xs text-white text-right tabular-nums">
            {formatValue(row.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
