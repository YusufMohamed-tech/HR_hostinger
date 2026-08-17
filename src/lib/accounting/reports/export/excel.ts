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
  // Support new structured format (sections with items) and legacy flat format
  const sections: { label: string; items: Record<string, unknown>[]; total: number }[] = [];

  if (data.revenue && typeof data.revenue === "object" && "items" in (data.revenue as object)) {
    const rev = data.revenue as { items: Record<string, unknown>[]; total: number };
    const cor = (data.cost_of_revenue || { items: [], total: 0 }) as { items: Record<string, unknown>[]; total: number };
    const opex = (data.operating_expenses || { items: [], total: 0 }) as { items: Record<string, unknown>[]; total: number };
    const oi = (data.other_income || { items: [], total: 0 }) as { items: Record<string, unknown>[]; total: number };
    const oe = (data.other_expenses || { items: [], total: 0 }) as { items: Record<string, unknown>[]; total: number };

    sections.push({ label: "الإيرادات", items: rev.items, total: rev.total });
    sections.push({ label: "تكلفة الإيرادات", items: cor.items, total: cor.total });
    sections.push({ label: "المصاريف التشغيلية", items: opex.items, total: opex.total });
    sections.push({ label: "إيرادات أخرى", items: oi.items, total: oi.total });
    sections.push({ label: "مصاريف أخرى", items: oe.items, total: oe.total });
  } else {
    const revenue = (data.revenue || []) as Record<string, unknown>[];
    const expenses = (data.expenses || []) as Record<string, unknown>[];
    sections.push({ label: "الإيرادات", items: revenue, total: Number(data.totalRevenue || 0) });
    sections.push({ label: "المصروفات", items: expenses, total: Number(data.totalExpenses || 0) });
  }

  const allRows: Record<string, unknown>[] = [];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    for (const item of section.items) {
      allRows.push({
        section: section.label,
        account_code: item.account_code || "",
        account_name: item.account_name_ar || item.account_name || "",
        amount: Number(item.amount || item.balance || 0),
      });
    }
    allRows.push({ section: "", account_code: "", account_name: `إجمالي ${section.label}`, amount: section.total });
  }

  // Summary rows
  if (data.gross_profit !== undefined) {
    allRows.push({ section: "", account_code: "", account_name: "إجمالي الربح", amount: Number(data.gross_profit) });
  }
  if (data.operating_income !== undefined) {
    allRows.push({ section: "", account_code: "", account_name: "الربح التشغيلي", amount: Number(data.operating_income) });
  }

  return generateExcelBuffer({
    title: "قائمة الدخل",
    sheetName: "قائمة الدخل",
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "section", label: "القسم", width: 18 },
      { key: "account_code", label: "رمز الحساب", width: 14 },
      { key: "account_name", label: "اسم الحساب", width: 30 },
      { key: "amount", label: "المبلغ", isMoney: true },
    ],
    rows: allRows,
    totals: { amount: Number(data.net_profit || data.netProfit || 0) },
  });
}

export async function cashFlowExcel(data: Record<string, unknown>, options?: { period?: string; orgName?: string }): Promise<Buffer> {
  const cfData = (data as { data?: Record<string, unknown> }).data || data;
  const sections = [
    { label: "الأنشطة التشغيلية", key: "operating" },
    { label: "الأنشطة الاستثمارية", key: "investing" },
    { label: "الأنشطة التمويلية", key: "financing" },
  ];

  const allRows: Record<string, unknown>[] = [];
  for (const section of sections) {
    const sectionData = (cfData as Record<string, unknown>)[section.key] as { items?: Record<string, unknown>[]; total?: number } | undefined;
    if (!sectionData || !sectionData.items?.length) continue;
    for (const item of sectionData.items) {
      allRows.push({
        section: section.label,
        account_name: item.account_name || "",
        amount: Number(item.amount || 0),
      });
    }
    allRows.push({ section: "", account_name: `إجمالي ${section.label}`, amount: sectionData.total || 0 });
  }

  // Summary
  allRows.push({ section: "", account_name: "", amount: "" });
  allRows.push({ section: "ملخص", account_name: "الرصيد الافتتاحي", amount: Number((cfData as Record<string, unknown>).opening_cash || 0) });
  allRows.push({ section: "", account_name: "صافي التغير", amount: Number((cfData as Record<string, unknown>).net_change || 0) });
  allRows.push({ section: "", account_name: "الرصيد الختامي", amount: Number((cfData as Record<string, unknown>).closing_cash || 0) });

  return generateExcelBuffer({
    title: "قائمة التدفقات النقدية",
    sheetName: "التدفقات النقدية",
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "section", label: "النشاط", width: 22 },
      { key: "account_name", label: "البيان", width: 30 },
      { key: "amount", label: "المبلغ", isMoney: true },
    ],
    rows: allRows,
  });
}
