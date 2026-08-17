import ExcelJS from "exceljs";

export interface ExcelColumn {
  key: string;
  label: string;
  width?: number;
  isMoney?: boolean;
}

export interface ExcelExportOptions {
  title: string;
  sheetName?: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  period?: string;
  orgName?: string;
  currency?: string;
}

export async function generateExcelBuffer(options: ExcelExportOptions): Promise<Buffer> {
  const { title, sheetName = "تقرير", columns, rows, totals, period, orgName, currency = "SAR" } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "تطوير تالنت - المحاسبة";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
  });

  sheet.mergeCells("A1", `${String.fromCharCode(64 + columns.length)}1`);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: "right" };

  if (orgName || period) {
    sheet.mergeCells("A2", `${String.fromCharCode(64 + columns.length)}2`);
    const metaCell = sheet.getCell("A2");
    metaCell.value = [orgName, period].filter(Boolean).join(" — ");
    metaCell.font = { size: 11, color: { argb: "FF666666" } };
    metaCell.alignment = { horizontal: "right" };
  }

  const headerRow = sheet.getRow(4);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.label;
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.border = { bottom: { style: "medium", color: { argb: "FF333333" } } };
    cell.alignment = { horizontal: col.isMoney ? "left" : "right" };
    sheet.getColumn(idx + 1).width = col.width || (col.isMoney ? 16 : 22);
  });

  rows.forEach((row, rowIdx) => {
    const excelRow = sheet.getRow(rowIdx + 5);
    columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const value = row[col.key];
      if (col.isMoney && typeof value === "number") {
        cell.value = value;
        cell.numFmt = `#,##0.00 "${currency}"`;
      } else {
        cell.value = value == null ? "" : String(value);
      }
      cell.alignment = { horizontal: col.isMoney ? "left" : "right" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFEEEEEE" } } };
    });
  });

  if (totals) {
    const totalRow = sheet.getRow(rows.length + 5);
    columns.forEach((col, colIdx) => {
      const cell = totalRow.getCell(colIdx + 1);
      if (col.key in totals) {
        cell.value = totals[col.key];
        if (col.isMoney) cell.numFmt = `#,##0.00 "${currency}"`;
      } else if (colIdx === 0) {
        cell.value = "الإجمالي";
      }
      cell.font = { bold: true };
      cell.border = { top: { style: "medium", color: { argb: "FF333333" } } };
      cell.alignment = { horizontal: col.isMoney ? "left" : "right" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function trialBalanceExcel(rows: Record<string, unknown>[], options?: { period?: string; orgName?: string }): Promise<Buffer> {
  return generateExcelBuffer({
    title: "ميزان المراجعة",
    sheetName: "ميزان المراجعة",
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "account_code", label: "رمز الحساب", width: 14 },
      { key: "account_name", label: "اسم الحساب", width: 30 },
      { key: "debit", label: "مدين", isMoney: true },
      { key: "credit", label: "دائن", isMoney: true },
      { key: "balance", label: "الرصيد", isMoney: true },
    ],
    rows,
    totals: {
      debit: rows.reduce((s, r) => s + Number(r.debit || 0), 0),
      credit: rows.reduce((s, r) => s + Number(r.credit || 0), 0),
    },
  });
}

export async function profitLossExcel(data: Record<string, unknown>, options?: { period?: string; orgName?: string }): Promise<Buffer> {
  const revenue = (data.revenue || []) as Record<string, unknown>[];
  const expenses = (data.expenses || []) as Record<string, unknown>[];
  const allRows = [
    ...revenue.map((r) => ({ ...r, section: "الإيرادات" })),
    ...expenses.map((r) => ({ ...r, section: "المصروفات" })),
  ];

  return generateExcelBuffer({
    title: "قائمة الدخل",
    sheetName: "قائمة الدخل",
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "section", label: "القسم", width: 14 },
      { key: "account_code", label: "رمز الحساب", width: 14 },
      { key: "account_name", label: "اسم الحساب", width: 30 },
      { key: "balance", label: "الرصيد", isMoney: true },
    ],
    rows: allRows,
    totals: { balance: Number(data.netProfit || 0) },
  });
}
