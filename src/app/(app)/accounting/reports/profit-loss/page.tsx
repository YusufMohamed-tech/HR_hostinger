"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IncomeStatementReport, type IncomeStatementData } from "@/components/accounting/reports/IncomeStatementReport";

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProfitLossPage() {
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/accounting/reports/profit-loss?date_from=${dateFrom}&date_to=${dateTo}`);
      const json = await res.json();
      const raw = json.data || json;
      // Transform API response to IncomeStatementData format
      const sections = [];
      if (raw.revenue) sections.push({ id: "revenue", label_ar: "الإيرادات", label_en: "Revenue", rows: raw.revenue.items || [], total: raw.revenue.total || 0, expanded_by_default: true });
      if (raw.cost_of_revenue) sections.push({ id: "cost_of_revenue", label_ar: "تكلفة الإيرادات", label_en: "Cost of Revenue", rows: raw.cost_of_revenue.items || [], total: raw.cost_of_revenue.total || 0, expanded_by_default: false });
      if (raw.operating_expenses) sections.push({ id: "operating_expense", label_ar: "المصاريف التشغيلية", label_en: "Operating Expenses", rows: raw.operating_expenses.items || [], total: raw.operating_expenses.total || 0, expanded_by_default: false });
      if (raw.other_income) sections.push({ id: "other_income", label_ar: "إيرادات أخرى", label_en: "Other Income", rows: raw.other_income.items || [], total: raw.other_income.total || 0, expanded_by_default: false });
      if (raw.other_expenses) sections.push({ id: "other_expense", label_ar: "مصاريف أخرى", label_en: "Other Expenses", rows: raw.other_expenses.items || [], total: raw.other_expenses.total || 0, expanded_by_default: false });

      const transformed: IncomeStatementData = {
        sections,
        gross_profit: raw.gross_profit ?? 0,
        operating_income: raw.operating_income ?? 0,
        net_profit: raw.net_profit ?? raw.net_income ?? 0,
        period: { from: dateFrom, to: dateTo },
        entity: raw.entity || { id: "", name_ar: "المنشأة" },
        currency: raw.currency || "SAR",
        unmapped_accounts: raw.unmapped_accounts,
      };
      setData(transformed);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={load}>تحديث</Button>
      </div>
      {data ? (
        <IncomeStatementReport data={data} isLoading={isLoading} />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-20">لا توجد بيانات لقائمة الدخل في هذه الفترة</div>
      )}
    </div>
  );
}
