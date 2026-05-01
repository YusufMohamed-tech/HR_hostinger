import React from "react";

interface MiniLineChartProps {
  values: number[];
  stroke?: string;
}

export function MiniLineChart({ values, stroke = "#5DAE46" }: MiniLineChartProps) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const span = Math.max(values.length - 1, 1);
  const points = values
    .map((value, index) => {
      const x = (index / span) * 100;
      const y = 40 - ((value - min) / range) * 40;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 40" className="h-12 w-full" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
