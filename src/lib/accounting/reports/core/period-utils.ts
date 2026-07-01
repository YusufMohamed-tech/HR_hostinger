export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

export function getPriorPeriod(dateFrom: string, dateTo: string): PeriodRange {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const durationMs = to.getTime() - from.getTime();
  const priorTo = new Date(from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - durationMs);

  return {
    from: priorFrom.toISOString().slice(0, 10),
    to: priorTo.toISOString().slice(0, 10),
    label: `${priorFrom.toISOString().slice(0, 10)} - ${priorTo.toISOString().slice(0, 10)}`,
  };
}

export function getPriorYear(dateFrom: string, dateTo: string): PeriodRange {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  from.setFullYear(from.getFullYear() - 1);
  to.setFullYear(to.getFullYear() - 1);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: `${from.toISOString().slice(0, 10)} - ${to.toISOString().slice(0, 10)}`,
  };
}

export function getPriorYearAsOf(asOf: string): PeriodRange {
  const date = new Date(asOf);
  date.setFullYear(date.getFullYear() - 1);
  return {
    from: "1900-01-01",
    to: date.toISOString().slice(0, 10),
    label: `As of ${date.toISOString().slice(0, 10)}`,
  };
}

export function getMonthsInRange(dateFrom: string, dateTo: string): string[] {
  const months: string[] = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    months.push(current.toISOString().slice(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

export function getQuartersInRange(dateFrom: string, dateTo: string): { quarter: string; from: string; to: string }[] {
  const quarters: { quarter: string; from: string; to: string }[] = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  let year = start.getFullYear();
  let q = Math.ceil((start.getMonth() + 1) / 3);

  while (true) {
    const qFrom = new Date(year, (q - 1) * 3, 1);
    const qTo = new Date(year, q * 3, 0);
    if (qFrom > end) break;
    quarters.push({
      quarter: `${year}-Q${q}`,
      from: qFrom.toISOString().slice(0, 10),
      to: qTo.toISOString().slice(0, 10),
    });
    q++;
    if (q > 4) { q = 1; year++; }
  }

  return quarters;
}

export interface VarianceItem {
  current: number;
  prior: number;
  change: number;
  changePercent: number | null;
  trend: "up" | "down" | "flat";
}

export function computeVariance(current: number, prior: number): VarianceItem {
  const change = current - prior;
  const changePercent = prior !== 0 ? Math.round((change / Math.abs(prior)) * 10000) / 100 : null;
  const trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return { current, prior, change, changePercent, trend };
}

export function computeVarianceMap(
  currentData: Record<string, number>,
  priorData: Record<string, number>
): Record<string, VarianceItem> {
  const result: Record<string, VarianceItem> = {};
  const allKeys = new Set([...Object.keys(currentData), ...Object.keys(priorData)]);
  for (const key of allKeys) {
    result[key] = computeVariance(currentData[key] || 0, priorData[key] || 0);
  }
  return result;
}
