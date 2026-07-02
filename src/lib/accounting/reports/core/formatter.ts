export function formatMoney(amount: number, currency = "SAR", locale = "ar-SA"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, locale = "ar-SA"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatDate(date: string, locale = "ar-SA"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function formatPeriod(dateFrom: string, dateTo: string): string {
  return `${dateFrom} - ${dateTo}`;
}

export interface ReportResponse<T> {
  report_name: string;
  generated_at: string;
  period: { from: string; to: string } | { as_of: string };
  org_id: string;
  data: T;
  comparison?: T;
  variance?: Record<string, { current: number; prior: number; change: number; changePercent: number | null; trend: string }>;
  metadata: {
    currency: string;
    account_count?: number;
    entry_count?: number;
  };
}

export function buildReportResponse<T>(
  name: string,
  orgId: string,
  period: { from: string; to: string } | { as_of: string },
  data: T,
  options?: {
    comparison?: T;
    variance?: Record<string, { current: number; prior: number; change: number; changePercent: number | null; trend: string }>;
    accountCount?: number;
    entryCount?: number;
  }
): ReportResponse<T> {
  return {
    report_name: name,
    generated_at: new Date().toISOString(),
    period,
    org_id: orgId,
    data,
    comparison: options?.comparison,
    variance: options?.variance,
    metadata: {
      currency: "SAR",
      account_count: options?.accountCount,
      entry_count: options?.entryCount,
    },
  };
}
