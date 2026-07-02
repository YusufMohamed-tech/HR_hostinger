export function toCSV(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (rows.length === 0) return "";

  const cols = columns || Object.keys(rows[0]).map((key) => ({ key, label: key }));
  const header = cols.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((row) =>
    cols.map((c) => {
      const val = row[c.key];
      if (val === null || val === undefined) return "";
      if (typeof val === "number") return String(val);
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  ).join("\n");

  return `﻿${header}\n${body}`;
}

export function reportToCSV(reportData: Record<string, unknown>): string {
  if (Array.isArray(reportData)) {
    return toCSV(reportData as Record<string, unknown>[]);
  }

  // For nested report data, flatten main arrays
  const sections: string[] = [];
  for (const [key, value] of Object.entries(reportData)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      sections.push(`# ${key}`);
      sections.push(toCSV(value as Record<string, unknown>[]));
      sections.push("");
    }
  }

  return sections.join("\n") || toCSV([reportData]);
}
