// Pure functions for carrier dashboard KPI computations — no DB calls.

export interface BundleCategory {
  category_label: string;
  min_value: number;
  max_value: number | null;
}

export const DEFAULT_BUNDLE_CATEGORIES: BundleCategory[] = [
  { category_label: "+10", min_value: 10, max_value: 20 },
  { category_label: "+20", min_value: 20, max_value: 30 },
  { category_label: "+30", min_value: 30, max_value: 50 },
  { category_label: "+45", min_value: 50, max_value: 70 },
  { category_label: "+70", min_value: 70, max_value: 100 },
  { category_label: "+90", min_value: 100, max_value: null },
];

export function getBundleCategory(
  ibrExclVat: number,
  categories: BundleCategory[] = DEFAULT_BUNDLE_CATEGORIES
): string | null {
  for (const cat of categories) {
    if (ibrExclVat >= cat.min_value && (cat.max_value === null || ibrExclVat < cat.max_value)) {
      return cat.category_label;
    }
  }
  return null;
}

export function getShiftType(
  activatedAt: Date | string | null,
  nightStart: string = "16:00"
): "morning" | "night" | null {
  if (!activatedAt) return null;
  const date = typeof activatedAt === "string" ? new Date(activatedAt) : activatedAt;
  if (isNaN(date.getTime())) return null;

  const [nightHour, nightMin] = nightStart.split(":").map(Number);
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  const nightStartMinutes = nightHour * 60 + nightMin;
  return totalMinutes >= nightStartMinutes ? "night" : "morning";
}

export function computeLocationStatus(
  daysWithActivations: number,
  totalWorkingDays: number,
  thresholds = { active: 100, acceptable: 85, warning: 70 }
): "active" | "acceptable" | "warning" | "inactive" {
  if (totalWorkingDays === 0) return "inactive";
  const pct = (daysWithActivations / totalWorkingDays) * 100;
  if (pct >= thresholds.active) return "active";
  if (pct >= thresholds.acceptable) return "acceptable";
  if (pct >= thresholds.warning) return "warning";
  return "inactive";
}

export interface TargetKPIs {
  achieved: number;
  target: number;
  daysElapsed: number;
  totalWorkingDays: number;
}

export function computeTargetKPIs(p: TargetKPIs) {
  const remaining = Math.max(0, p.target - p.achieved);
  const daysLeft = Math.max(0, p.totalWorkingDays - p.daysElapsed);
  const requiredDaily = daysLeft > 0 ? remaining / daysLeft : 0;
  const average = p.daysElapsed > 0 ? p.achieved / p.daysElapsed : 0;
  const expected = average * p.totalWorkingDays;
  const excellentPct = p.target > 0 ? Math.min(200, (p.achieved / p.target) * 100) : 0;
  const riskPct = p.totalWorkingDays > 0 ? (p.daysElapsed / p.totalWorkingDays) * 100 : 0;
  const onTrack = p.target > 0 && p.achieved >= p.target * (p.daysElapsed / p.totalWorkingDays);

  return { remaining, daysLeft, requiredDaily, average, expected, excellentPct, riskPct, onTrack };
}

export function formatCarrierNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}
