import React from "react";

interface MiniBarChartProps {
  values: number[];
}

export function MiniBarChart({ values }: MiniBarChartProps) {
  const max = Math.max(...values, 1);

  return (
    <div className="flex h-24 items-end gap-2">
      {values.map((value, index) => {
        const pct = Math.round((value / max) * 100);
        return (
          <div key={index} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
              {value}
            </span>
            <div
              className="w-full rounded-md bg-brand/20 hover:bg-brand/40 transition-colors cursor-default relative group/bar"
              style={{ height: `${pct}%` }}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {value}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
