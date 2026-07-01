import { toCSV } from "./csv";

// XLSX export using CSV-compatible format
// For true XLSX with formatting, install xlsx package
export function toExcelCSV(rows: Record<string, unknown>[], sheetName?: string): string {
  return toCSV(rows);
}

export interface ExcelSheet {
  name: string;
  rows: Record<string, unknown>[];
  columns?: { key: string; label: string }[];
}

export function multiSheetExport(sheets: ExcelSheet[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const sheet of sheets) {
    result[sheet.name] = toCSV(sheet.rows, sheet.columns);
  }
  return result;
}
