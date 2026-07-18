"use client";

interface GaugeChartProps {
  value: number;       // achieved
  target: number;      // 100% mark
  label: string;
  sublabel?: string;
  size?: number;       // SVG size in px, default 160
}

export function CarrierGaugeChart({ value, target, label, sublabel, size = 160 }: GaugeChartProps) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const timePct = 46.8; // days elapsed / total — would be passed in real usage
  const excellent = pct >= timePct;

  const r = (size / 2) * 0.7;
  const cx = size / 2;
  const cy = size * 0.6;

  // Half-circle arc: from -180° to 0° (left to right)
  const startAngle = Math.PI;
  const endAngle = 0;
  const sweepAngle = endAngle - startAngle;

  function polarToXY(angle: number) {
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  }

  const start = polarToXY(startAngle);
  const full = polarToXY(endAngle);

  const fillAngle = startAngle + sweepAngle * (pct / 100);
  const fill = polarToXY(fillAngle);

  const trackPath = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${full.x} ${full.y}`;
  const fillPath = `M ${start.x} ${start.y} A ${r} ${r} 0 ${pct > 50 ? 1 : 0} 1 ${fill.x} ${fill.y}`;

  const strokeWidth = size * 0.1;
  const color = excellent ? "#22c55e" : "#f59e0b";

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size }}>
      <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
        {/* Track */}
        <path d={trackPath} fill="none" stroke="#1e3a5f" strokeWidth={strokeWidth} strokeLinecap="round" />
        {/* Fill */}
        {pct > 0 && (
          <path d={fillPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        {/* Center text */}
        <text x={cx} y={cy - r * 0.1} textAnchor="middle" fill="white" fontSize={size * 0.14} fontWeight="bold">
          {Math.round(pct)}%
        </text>
        <text x={cx} y={cy + size * 0.06} textAnchor="middle" fill="#94a3b8" fontSize={size * 0.08}>
          {excellent ? "Excellent" : "At Risk"}
        </text>
      </svg>
      <div className="text-center">
        <div className="text-sm font-medium text-white">{label}</div>
        {sublabel && <div className="text-xs text-[#94a3b8]">{sublabel}</div>}
      </div>
    </div>
  );
}
