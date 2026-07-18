"use client";

interface HeatmapCell {
  value: number;
  label?: string;
}

interface HeatmapRow {
  rowLabel: string;
  cells: HeatmapCell[];
}

interface Props {
  columnLabels: string[];
  rows: HeatmapRow[];
  formatValue?: (v: number) => string;
  title?: string;
}

function interpolateColor(value: number, min: number, max: number): string {
  if (max === min) return "rgba(99,102,241,0.5)";
  const t = (value - min) / (max - min);
  // cold (dark navy) → hot (bright indigo/blue)
  const r = Math.round(15 + t * (59 - 15));
  const g = Math.round(52 + t * (130 - 52));
  const b = Math.round(96 + t * (246 - 96));
  return `rgb(${r},${g},${b})`;
}

export function HeatmapTable({ columnLabels, rows, formatValue, title }: Props) {
  const allValues = rows.flatMap((r) => r.cells.map((c) => c.value)).filter((v) => v > 0);
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 1;

  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  if (rows.length === 0) {
    return (
      <div className="bg-[#16213e] rounded-lg p-4">
        {title && <div className="text-sm text-[#94a3b8] mb-4">{title}</div>}
        <p className="text-xs text-[#64748b] text-center py-6">No data for this period</p>
      </div>
    );
  }

  return (
    <div className="bg-[#16213e] rounded-lg p-4 overflow-x-auto">
      {title && <div className="text-sm text-[#94a3b8] mb-4">{title}</div>}
      <table className="w-full text-xs border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-[#64748b] font-medium whitespace-nowrap w-28">Supervisor</th>
            {columnLabels.map((col) => (
              <th key={col} className="text-right px-2 py-1 text-[#64748b] font-medium whitespace-nowrap">{col}</th>
            ))}
            <th className="text-right px-2 py-1 text-[#64748b] font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowTotal = row.cells.reduce((s, c) => s + c.value, 0);
            return (
              <tr key={row.rowLabel}>
                <td className="px-2 py-1 text-white font-medium whitespace-nowrap truncate max-w-[7rem]" title={row.rowLabel}>
                  {row.rowLabel}
                </td>
                {row.cells.map((cell, ci) => {
                  const bg = cell.value > 0 ? interpolateColor(cell.value, min, max) : "transparent";
                  const textColor = cell.value > 0 ? "#fff" : "#475569";
                  return (
                    <td
                      key={ci}
                      className="px-2 py-1 text-right rounded tabular-nums transition-colors"
                      style={{ backgroundColor: bg, color: textColor }}
                      title={cell.label}
                    >
                      {cell.value > 0 ? fmt(cell.value) : "—"}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right text-white font-semibold tabular-nums">
                  {rowTotal > 0 ? fmt(rowTotal) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
