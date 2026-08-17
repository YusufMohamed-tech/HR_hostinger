"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { ReportExportMenu } from "./ReportExportMenu";

export interface IncomeStatementRow {
  account_code: string;
  account_name_ar: string;
  account_name_en?: string;
  amount: number;
  children?: IncomeStatementRow[];
}

export interface IncomeStatementSection {
  id: string;
  label_ar: string;
  label_en: string;
  rows: IncomeStatementRow[];
  total: number;
  expanded_by_default: boolean;
}

export interface IncomeStatementData {
  sections: IncomeStatementSection[];
  gross_profit: number;
  operating_income: number;
  net_profit: number;
  period: { from: string; to: string };
  entity: { id: string; name_ar: string };
  currency: string;
  unmapped_accounts?: { code: string; name_ar: string }[];
}

interface Props {
  data: IncomeStatementData;
  isLoading?: boolean;
}

function formatAmount(amount: number, currency: string): string {
  const formatted = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (amount < 0) return `(${formatted})`;
  return formatted;
}

function SectionBlock({ section }: { section: IncomeStatementSection }) {
  const [expanded, setExpanded] = useState(section.expanded_by_default);

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold hover:bg-muted/50 transition-colors"
        aria-expanded={expanded}
        aria-controls={`section-${section.id}`}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="flex-1 text-start">{section.label_ar}</span>
        <span className="font-mono text-sm tabular-nums" dir="ltr">
          {formatAmount(section.total, "SAR")}
        </span>
      </button>

      {expanded && (
        <div id={`section-${section.id}`} className="pb-2">
          {section.rows.map((row, idx) => (
            <AccountRow key={`${row.account_code}-${idx}`} row={row} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRow({ row, depth }: { row: IncomeStatementRow; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = row.children && row.children.length > 0;
  const indent = 16 + depth * 20;

  return (
    <>
      <div
        className="flex items-center px-4 py-1 text-sm hover:bg-muted/30"
        style={{ paddingInlineStart: `${indent}px` }}
      >
        {hasChildren && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="me-1 p-0.5 rounded hover:bg-muted"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronLeft className="h-3 w-3" />
            )}
          </button>
        )}
        <span className="font-mono text-xs text-muted-foreground me-2 tabular-nums" dir="ltr">
          {row.account_code}
        </span>
        <span className="flex-1">{row.account_name_ar}</span>
        <span className="font-mono text-sm tabular-nums" dir="ltr">
          {formatAmount(row.amount, "SAR")}
        </span>
      </div>
      {hasChildren && expanded && row.children!.map((child, idx) => (
        <AccountRow key={`${child.account_code}-${idx}`} row={child} depth={depth + 1} />
      ))}
    </>
  );
}

function SummaryLine({ label, amount, isBold }: { label: string; amount: number; isBold?: boolean }) {
  return (
    <div className={`flex items-center px-4 py-2 ${isBold ? "font-bold text-base" : "font-semibold text-sm"} border-t`}>
      <span className="flex-1">{label}</span>
      <span className={`font-mono tabular-nums ${amount < 0 ? "text-destructive" : ""}`} dir="ltr">
        {formatAmount(amount, "SAR")}
      </span>
    </div>
  );
}

export function IncomeStatementReport({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const revenue = data.sections.find(s => s.id === "revenue");
  const costOfRevenue = data.sections.find(s => s.id === "cost_of_revenue");
  const operatingExpense = data.sections.find(s => s.id === "operating_expense");
  const otherIncome = data.sections.find(s => s.id === "other_income");
  const otherExpense = data.sections.find(s => s.id === "other_expense");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{data.entity.name_ar}</h2>
          <p className="text-sm text-muted-foreground">
            قائمة الدخل للفترة من {data.period.from} إلى {data.period.to}
          </p>
        </div>
        <ReportExportMenu
          reportId="profit-loss"
          params={{ date_from: data.period.from, date_to: data.period.to }}
        />
      </div>

      {/* Unmapped accounts warning */}
      {data.unmapped_accounts && data.unmapped_accounts.length > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm">
          <p className="font-semibold text-yellow-800">
            تحذير: توجد حسابات غير مصنفة ({data.unmapped_accounts.length})
          </p>
          <ul className="mt-1 list-disc list-inside text-yellow-700">
            {data.unmapped_accounts.slice(0, 5).map(a => (
              <li key={a.code}>{a.code} — {a.name_ar}</li>
            ))}
            {data.unmapped_accounts.length > 5 && (
              <li>... و {data.unmapped_accounts.length - 5} حسابات أخرى</li>
            )}
          </ul>
        </div>
      )}

      {/* Report body */}
      <div className="rounded-lg border bg-card">
        {revenue && <SectionBlock section={revenue} />}
        {costOfRevenue && <SectionBlock section={costOfRevenue} />}

        <SummaryLine label="إجمالي الربح" amount={data.gross_profit} />

        {operatingExpense && <SectionBlock section={operatingExpense} />}

        <SummaryLine label="الربح التشغيلي" amount={data.operating_income} />

        {otherIncome && <SectionBlock section={otherIncome} />}
        {otherExpense && <SectionBlock section={otherExpense} />}

        <SummaryLine label="صافي الربح / (الخسارة)" amount={data.net_profit} isBold />
      </div>
    </div>
  );
}
