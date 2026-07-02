import { roundMoney } from "@/lib/accounting/validation";

export interface GroupedTotal {
  key: string;
  label: string;
  total: number;
  count: number;
  percentage?: number;
}

export function groupAndSum<T>(
  items: T[],
  keyFn: (item: T) => string,
  labelFn: (item: T) => string,
  valueFn: (item: T) => number
): GroupedTotal[] {
  const map = new Map<string, { label: string; total: number; count: number }>();

  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key) || { label: labelFn(item), total: 0, count: 0 };
    existing.total = roundMoney(existing.total + valueFn(item));
    existing.count++;
    map.set(key, existing);
  }

  const results = Array.from(map.entries()).map(([key, value]) => ({
    key,
    label: value.label,
    total: value.total,
    count: value.count,
  }));

  const grandTotal = roundMoney(results.reduce((sum, r) => sum + r.total, 0));

  return results
    .map((r) => ({
      ...r,
      percentage: grandTotal !== 0 ? Math.round((r.total / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function topN(items: GroupedTotal[], n: number): { top: GroupedTotal[]; others: GroupedTotal | null } {
  if (items.length <= n) return { top: items, others: null };
  const top = items.slice(0, n);
  const rest = items.slice(n);
  const othersTotal = roundMoney(rest.reduce((sum, r) => sum + r.total, 0));
  const othersCount = rest.reduce((sum, r) => sum + r.count, 0);
  const grandTotal = roundMoney(items.reduce((sum, r) => sum + r.total, 0));
  return {
    top,
    others: {
      key: "others",
      label: "أخرى",
      total: othersTotal,
      count: othersCount,
      percentage: grandTotal !== 0 ? Math.round((othersTotal / grandTotal) * 10000) / 100 : 0,
    },
  };
}

export interface SubtotalSection<T> {
  label: string;
  items: T[];
  subtotal: number;
}

export function sectionize<T>(
  items: T[],
  sectionFn: (item: T) => string,
  valueFn: (item: T) => number
): SubtotalSection<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const section = sectionFn(item);
    const existing = map.get(section) || [];
    existing.push(item);
    map.set(section, existing);
  }

  return Array.from(map.entries()).map(([label, sectionItems]) => ({
    label,
    items: sectionItems,
    subtotal: roundMoney(sectionItems.reduce((sum, item) => sum + valueFn(item), 0)),
  }));
}

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  items: Array<Record<string, unknown>>;
  total: number;
  count: number;
}

export function computeAging(
  items: Array<Record<string, unknown>>,
  dateField: string,
  amountField: string,
  asOf?: string
): AgingBucket[] {
  const today = asOf ? new Date(asOf) : new Date();
  const buckets: AgingBucket[] = [
    { label: "حالي", minDays: -Infinity, maxDays: 0, items: [], total: 0, count: 0 },
    { label: "1-30 يوم", minDays: 1, maxDays: 30, items: [], total: 0, count: 0 },
    { label: "31-60 يوم", minDays: 31, maxDays: 60, items: [], total: 0, count: 0 },
    { label: "61-90 يوم", minDays: 61, maxDays: 90, items: [], total: 0, count: 0 },
    { label: "90+ يوم", minDays: 91, maxDays: null, items: [], total: 0, count: 0 },
  ];

  for (const item of items) {
    const date = new Date(String(item[dateField] || ""));
    const days = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    const amount = Number(item[amountField] || 0);

    for (const bucket of buckets) {
      if (days >= bucket.minDays && (bucket.maxDays === null || days <= bucket.maxDays)) {
        bucket.items.push(item);
        bucket.total = roundMoney(bucket.total + amount);
        bucket.count++;
        break;
      }
    }
  }

  return buckets;
}
