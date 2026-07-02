"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
} from "recharts";

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function KPIDashboardPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("kpi-dashboard", dates);
      setData(result as Record<string, unknown>);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const kpis = (data as any)?.data?.kpis || (data as any)?.kpis || [];
  const summary = (data as any)?.data?.summary || (data as any)?.summary || {};

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="لوحة المؤشرات المالية"
        actions={
          <>
            <Input type="date" value={dates.date_from} onChange={(e) => setDates((d) => ({ ...d, date_from: e.target.value }))} className="w-40" />
            <Input type="date" value={dates.date_to} onChange={(e) => setDates((d) => ({ ...d, date_to: e.target.value }))} className="w-40" />
            <Button onClick={load}>تحديث</Button>
          </>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="إجمالي الإيرادات" value={summary.total_revenue} />
            <StatCard label="إجمالي المصروفات" value={summary.total_expenses} />
            <StatCard label="صافي الربح" value={summary.net_profit} positive={summary.net_profit >= 0} />
            <StatCard label="الرصيد النقدي" value={summary.cash_balance} />
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {kpis.map((kpi: any) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">{kpi.label_ar}</div>
                  <div className="text-2xl font-bold mt-1">
                    {kpi.value !== null ? `${kpi.value}${kpi.unit === "%" ? "%" : kpi.unit === "ratio" ? "" : ` ${kpi.unit}`}` : "-"}
                  </div>
                  {kpi.trend && (
                    <div className={`text-xs mt-1 ${kpi.trend.trend === "up" ? "text-green-600" : kpi.trend.trend === "down" ? "text-red-600" : "text-gray-500"}`}>
                      {kpi.trend.changePercent !== null ? `${kpi.trend.changePercent > 0 ? "+" : ""}${kpi.trend.changePercent}%` : ""}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Revenue vs Expenses Chart */}
          <Card>
            <CardHeader><CardTitle>الإيرادات مقابل المصروفات</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { name: "الإيرادات", value: summary.total_revenue },
                  { name: "المصروفات", value: summary.total_expenses },
                  { name: "صافي الربح", value: summary.net_profit },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold mt-1 ${positive === false ? "text-red-600" : positive === true ? "text-green-600" : ""}`}>
          <MoneyAmount value={value || 0} />
        </div>
      </CardContent>
    </Card>
  );
}
