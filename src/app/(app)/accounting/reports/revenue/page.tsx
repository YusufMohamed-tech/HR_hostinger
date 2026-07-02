"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function RevenueAnalysisPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [groupBy, setGroupBy] = useState("customer");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("revenue-analysis", { ...dates, group_by: groupBy });
      setData(result);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const analysis = (data as any)?.data || data;
  const breakdown = analysis?.breakdown || [];
  const trend = analysis?.monthly_trend || [];

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="تحليل الإيرادات"
        actions={
          <>
            <Select value={groupBy} onValueChange={(v) => v !== null && setGroupBy(v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">حسب العميل</SelectItem>
                <SelectItem value="product">حسب المنتج</SelectItem>
                <SelectItem value="channel">حسب القناة</SelectItem>
                <SelectItem value="month">حسب الشهر</SelectItem>
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
      ) : !analysis ? (
        <div className="text-center py-12 text-muted-foreground">لا توجد بيانات</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">إجمالي الإيرادات</div>
                <div className="text-2xl font-bold mt-1"><MoneyAmount value={analysis.total_revenue} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">عدد الفواتير</div>
                <div className="text-2xl font-bold mt-1">{analysis.invoice_count}</div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Trend */}
          <Card>
            <CardHeader><CardTitle>الاتجاه الشهري</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: unknown) => typeof v === "number" ? v.toLocaleString("ar-SA") : String(v ?? "")} />
                  <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Breakdown Pie + Table */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>التوزيع</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={breakdown.slice(0, 8)} dataKey="total" nameKey="label" cx="50%" cy="50%" outerRadius={80}>
                      {breakdown.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => typeof v === "number" ? v.toLocaleString("ar-SA") : String(v ?? "")} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>التفاصيل</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right py-2">البند</th>
                      <th className="text-left py-2">المبلغ</th>
                      <th className="text-left py-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((item: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2">{item.label}</td>
                        <td className="py-2 text-left"><MoneyAmount value={item.total} /></td>
                        <td className="py-2 text-left">{item.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
