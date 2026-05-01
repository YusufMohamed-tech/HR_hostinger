import React from "react";

interface MiniBarChartProps {
  values: number[];
}

export function MiniBarChart({ values }: MiniBarChartProps) {
  const max = Math.max(...values, 1);

  return (
    <div className="flex h-24 items-end gap-2">
      {values.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-md bg-brand/20"
          style={{ height: `${(value / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
