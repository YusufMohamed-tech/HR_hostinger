import { formatMoney } from "../core/formatter";

interface PdfTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  isMoney?: boolean;
}

interface PdfReportOptions {
  title: string;
  subtitle?: string;
  period?: string;
  orgName?: string;
  columns: PdfTableColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  currency?: string;
}

export function generateReportHtml(options: PdfReportOptions): string {
  const { title, subtitle, period, orgName, columns, rows, totals, currency = "SAR" } = options;

  const headerRows = columns.map((col) => `<th style="text-align:${col.align || "right"};padding:8px;border-bottom:2px solid #333;">${col.label}</th>`).join("");

  const bodyRows = rows.map((row) => {
    const cells = columns.map((col) => {
      const value = row[col.key];
      const formatted = col.isMoney ? formatMoney(Number(value || 0), currency) : String(value ?? "");
      return `<td style="text-align:${col.align || "right"};padding:6px;border-bottom:1px solid #eee;">${formatted}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  const totalRow = totals ? `<tr style="font-weight:bold;border-top:2px solid #333;">${columns.map((col) => {
    if (col.key in totals) {
      return `<td style="text-align:${col.align || "right"};padding:8px;">${col.isMoney ? formatMoney(totals[col.key], currency) : totals[col.key]}</td>`;
    }
    return `<td style="padding:8px;"></td>`;
  }).join("")}</tr>` : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 40px; direction: rtl; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #666; margin-bottom: 20px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 20px; color: #444; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
  <div class="meta">
    ${orgName ? `<span>${orgName}</span>` : ""}
    ${period ? `<span>${period}</span>` : ""}
    <span>${new Date().toLocaleDateString("ar-SA")}</span>
  </div>
  <table>
    <thead><tr>${headerRows}</tr></thead>
    <tbody>${bodyRows}</tbody>
    ${totalRow ? `<tfoot>${totalRow}</tfoot>` : ""}
  </table>
</body>
</html>`;
}

export function trialBalancePdf(rows: Record<string, unknown>[], options?: { period?: string; orgName?: string }): string {
  return generateReportHtml({
    title: "ميزان المراجعة",
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "account_code", label: "رمز الحساب" },
      { key: "account_name", label: "اسم الحساب" },
      { key: "debit", label: "مدين", align: "left", isMoney: true },
      { key: "credit", label: "دائن", align: "left", isMoney: true },
      { key: "balance", label: "الرصيد", align: "left", isMoney: true },
    ],
    rows,
    totals: {
      debit: rows.reduce((s, r) => s + Number(r.debit || 0), 0),
      credit: rows.reduce((s, r) => s + Number(r.credit || 0), 0),
    },
  });
}

export function profitLossPdf(data: Record<string, unknown>, options?: { period?: string; orgName?: string }): string {
  const allRows: Record<string, unknown>[] = [];

  if (data.revenue && typeof data.revenue === "object" && "items" in (data.revenue as object)) {
    const sections = [
      { label: "الإيرادات", data: data.revenue },
      { label: "تكلفة الإيرادات", data: data.cost_of_revenue },
      { label: "المصاريف التشغيلية", data: data.operating_expenses },
      { label: "إيرادات أخرى", data: data.other_income },
      { label: "مصاريف أخرى", data: data.other_expenses },
    ];
    for (const section of sections) {
      const s = (section.data || { items: [], total: 0 }) as { items: Record<string, unknown>[]; total: number };
      if (!s.items?.length) continue;
      for (const item of s.items) {
        allRows.push({ section: section.label, account_code: item.account_code || "", account_name: item.account_name_ar || "", amount: Number(item.amount || 0) });
      }
      allRows.push({ section: "", account_code: "", account_name: `إجمالي ${section.label}`, amount: s.total });
    }
  } else {
    const revenue = (data.revenue || []) as Record<string, unknown>[];
    const expenses = (data.expenses || []) as Record<string, unknown>[];
    allRows.push(...revenue.map((r) => ({ ...r, section: "الإيرادات", amount: r.balance })));
    allRows.push(...expenses.map((r) => ({ ...r, section: "المصروفات", amount: r.balance })));
  }

  return generateReportHtml({
    title: "قائمة الدخل",
    subtitle: `صافي الربح: ${formatMoney(Number(data.net_profit || data.netProfit || 0))}`,
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "section", label: "القسم" },
      { key: "account_code", label: "رمز الحساب" },
      { key: "account_name", label: "اسم الحساب" },
      { key: "amount", label: "المبلغ", align: "left", isMoney: true },
    ],
    rows: allRows,
    totals: {
      amount: Number(data.net_profit || data.netProfit || 0),
    },
  });
}

export function cashFlowPdf(data: Record<string, unknown>, options?: { period?: string; orgName?: string }): string {
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
      allRows.push({ section: section.label, account_name: item.account_name || "", amount: Number(item.amount || 0) });
    }
    allRows.push({ section: "", account_name: `إجمالي ${section.label}`, amount: sectionData.total || 0 });
  }

  allRows.push({ section: "ملخص", account_name: "الرصيد الافتتاحي", amount: Number((cfData as Record<string, unknown>).opening_cash || 0) });
  allRows.push({ section: "", account_name: "صافي التغير", amount: Number((cfData as Record<string, unknown>).net_change || 0) });
  allRows.push({ section: "", account_name: "الرصيد الختامي", amount: Number((cfData as Record<string, unknown>).closing_cash || 0) });

  return generateReportHtml({
    title: "قائمة التدفقات النقدية",
    subtitle: `صافي التدفق: ${formatMoney(Number((cfData as Record<string, unknown>).net_change || 0))}`,
    period: options?.period,
    orgName: options?.orgName,
    columns: [
      { key: "section", label: "النشاط" },
      { key: "account_name", label: "البيان" },
      { key: "amount", label: "المبلغ", align: "left", isMoney: true },
    ],
    rows: allRows,
  });
}
