"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function ExpenseAnalysisPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [groupBy, setGroupBy] = useState("category");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("expense-analysis", { ...dates, group_by: groupBy });
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
        title="تحليل المصروفات"
        actions={
          <>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="category">حسب التصنيف</SelectItem>
                <SelectItem value="vendor">حسب المورد</SelectItem>
                <SelectItem value="cost_center">حسب مركز التكلفة</SelectItem>
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
                <div className="text-sm text-muted-foreground">إجمالي المصروفات</div>
                <div className="text-2xl font-bold mt-1"><MoneyAmount value={analysis.total_expenses} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">عدد المصروفات</div>
                <div className="text-2xl font-bold mt-1">{analysis.expense_count}</div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Trend */}
          <Card>
            <CardHeader><CardTitle>الاتجاه الشهري</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => v.toLocaleString("ar-SA")} />
                  <Bar dataKey="total" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Breakdown */}
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
                    <Tooltip formatter={(v: number) => v.toLocaleString("ar-SA")} />
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
