"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function ComparativePage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today(), as_of: today() });
  const [report, setReport] = useState("profit-loss");
  const [compare, setCompare] = useState("prior_period");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("comparative", { ...dates, report, compare });
      setData(result);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const reportData = (data as any)?.data || data;

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="التقارير المقارنة"
        actions={
          <>
            <Select value={report} onValueChange={setReport}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="profit-loss">الأرباح والخسائر</SelectItem>
                <SelectItem value="balance-sheet">المركز المالي</SelectItem>
              </SelectContent>
            </Select>
            <Select value={compare} onValueChange={setCompare}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prior_period">مقارنة بالفترة السابقة</SelectItem>
                <SelectItem value="prior_year">مقارنة بنفس الفترة العام السابق</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={dates.date_from} onChange={(e) => setDates((d) => ({ ...d, date_from: e.target.value }))} className="w-36" />
            <Input type="date" value={dates.date_to} onChange={(e) => setDates((d) => ({ ...d, date_to: e.target.value }))} className="w-36" />
            <Button onClick={load}>تحديث</Button>
          </>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
      ) : !reportData ? (
        <div className="text-center py-12 text-muted-foreground">لا توجد بيانات</div>
      ) : report === "profit-loss" ? (
        <PnLComparative data={reportData} />
      ) : (
        <BSComparative data={reportData} />
      )}
    </div>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <ArrowUp className="h-4 w-4 text-green-600 inline" />;
  if (trend === "down") return <ArrowDown className="h-4 w-4 text-red-600 inline" />;
  return <Minus className="h-4 w-4 text-gray-400 inline" />;
}

function VarianceRow({ row }: { row: any }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2">{row.account_code}</td>
      <td className="py-2">{row.account_name}</td>
      <td className="py-2 text-left"><MoneyAmount value={row.current_balance} /></td>
      <td className="py-2 text-left"><MoneyAmount value={row.prior_balance} /></td>
      <td className="py-2 text-left">
        <span className={row.variance?.change >= 0 ? "text-green-600" : "text-red-600"}>
          <MoneyAmount value={row.variance?.change || 0} />
        </span>
      </td>
      <td className="py-2 text-left">
        {row.variance?.changePercent !== null ? `${row.variance.changePercent}%` : "-"}
        {" "}<TrendIcon trend={row.variance?.trend} />
      </td>
    </tr>
  );
}

function ComparisonTable({ title, rows, totals }: { title: string; rows: any[]; totals?: any }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b font-medium">
              <th className="text-right py-2">الرمز</th>
              <th className="text-right py-2">الحساب</th>
              <th className="text-left py-2">الفترة الحالية</th>
              <th className="text-left py-2">الفترة السابقة</th>
              <th className="text-left py-2">الفرق</th>
              <th className="text-left py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, i: number) => <VarianceRow key={i} row={row} />)}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="font-bold border-t-2">
                <td colSpan={2} className="py-2">الإجمالي</td>
                <td className="py-2 text-left"><MoneyAmount value={totals.current} /></td>
                <td className="py-2 text-left"><MoneyAmount value={totals.prior} /></td>
                <td className="py-2 text-left"><MoneyAmount value={totals.change} /></td>
                <td className="py-2 text-left">{totals.changePercent !== null ? `${totals.changePercent}%` : "-"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}

function PnLComparative({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <ComparisonTable title="الإيرادات" rows={data.revenue || []} totals={data.total_revenue} />
      <ComparisonTable title="المصروفات" rows={data.expenses || []} totals={data.total_expenses} />
      <Card>
        <CardContent className="pt-4">
          <div className="flex justify-between items-center text-lg font-bold">
            <span>صافي الربح</span>
            <span className={data.net_profit?.current >= 0 ? "text-green-600" : "text-red-600"}>
              <MoneyAmount value={data.net_profit?.current || 0} />
              {data.net_profit?.changePercent !== null && (
                <span className="text-sm ml-2">({data.net_profit.changePercent}%)</span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BSComparative({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <ComparisonTable title="الأصول" rows={data.assets || []} totals={data.total_assets} />
      <ComparisonTable title="الالتزامات" rows={data.liabilities || []} totals={data.total_liabilities} />
      <ComparisonTable title="حقوق الملكية" rows={data.equity || []} totals={data.total_equity} />
    </div>
  );
}
