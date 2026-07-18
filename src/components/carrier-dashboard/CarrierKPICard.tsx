"use client";

interface CarrierKPICardProps {
  label: string;
  value: string | number;
  target?: string | number;
  remaining?: string | number;
  reqPerDay?: string | number;
  average?: string | number;
  expected?: string | number;
  achievedPct?: number;
  accentColor?: string;
}

export function CarrierKPICard({
  label,
  value,
  target,
  remaining,
  reqPerDay,
  average,
  expected,
  achievedPct,
  accentColor = "#3b82f6",
}: CarrierKPICardProps) {
  return (
    <div
      className="bg-[#16213e] rounded-lg p-4 flex flex-col gap-2 min-w-0"
      style={{ borderTop: `3px solid ${accentColor}` }}
    >
      <div className="text-xs text-[#94a3b8] uppercase tracking-wide truncate">{label}</div>
      <div className="text-3xl font-bold text-white tabular-nums">{value}</div>

      {target !== undefined && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs mt-1">
          <span className="text-[#94a3b8]">Target</span>
          <span className="text-white text-right tabular-nums">{target}</span>
          {remaining !== undefined && (
            <>
              <span className="text-[#94a3b8]">Remaining</span>
              <span className="text-white text-right tabular-nums">{remaining}</span>
            </>
          )}
          {reqPerDay !== undefined && (
            <>
              <span className="text-[#94a3b8]">Req/Day</span>
              <span className="text-white text-right tabular-nums">{reqPerDay}</span>
            </>
          )}
          {average !== undefined && (
            <>
              <span className="text-[#94a3b8]">Average</span>
              <span className="text-white text-right tabular-nums">{average}</span>
            </>
          )}
          {expected !== undefined && (
            <>
              <span className="text-[#94a3b8]">Expected</span>
              <span className="text-white text-right tabular-nums">{expected}</span>
            </>
          )}
        </div>
      )}

      {achievedPct !== undefined && (
        <div className="mt-1">
          <div className="flex justify-between text-xs text-[#94a3b8] mb-1">
            <span>Achievement</span>
            <span>{Math.round(achievedPct)}%</span>
          </div>
          <div className="w-full h-1.5 bg-[#0f3460] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, achievedPct)}%`, backgroundColor: accentColor }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
