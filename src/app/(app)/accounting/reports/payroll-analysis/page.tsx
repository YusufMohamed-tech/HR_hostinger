"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function PayrollAnalysisPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [groupBy, setGroupBy] = useState("month");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("payroll-analysis", { ...dates, group_by: groupBy });
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
        title="تحليل الرواتب"
        actions={
          <>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">حسب الشهر</SelectItem>
                <SelectItem value="department">حسب القسم</SelectItem>
                <SelectItem value="employee">حسب الموظف</SelectItem>
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
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">إجمالي تكلفة الرواتب</div>
                <div className="text-2xl font-bold mt-1"><MoneyAmount value={analysis.total_cost} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">عدد الموظفين</div>
                <div className="text-2xl font-bold mt-1">{analysis.employee_count}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">متوسط التكلفة/موظف</div>
                <div className="text-2xl font-bold mt-1"><MoneyAmount value={analysis.avg_cost_per_employee} /></div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Trend */}
          <Card>
            <CardHeader><CardTitle>اتجاه تكلفة الرواتب الشهرية</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => v.toLocaleString("ar-SA")} />
                  <Area type="monotone" dataKey="total" stroke="#8b5cf6" fill="#8b5cf680" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Breakdown Table */}
          <Card>
            <CardHeader><CardTitle>التفاصيل</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b font-medium">
                    <th className="text-right py-2">البند</th>
                    <th className="text-left py-2">الراتب الأساسي</th>
                    <th className="text-left py-2">البدلات</th>
                    <th className="text-left py-2">الخصومات</th>
                    <th className="text-left py-2">الصافي</th>
                    <th className="text-left py-2">العدد</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((item: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">{item.label}</td>
                      <td className="py-2 text-left"><MoneyAmount value={item.base_salary} /></td>
                      <td className="py-2 text-left"><MoneyAmount value={item.allowances} /></td>
                      <td className="py-2 text-left"><MoneyAmount value={item.deductions} /></td>
                      <td className="py-2 text-left font-medium"><MoneyAmount value={item.net} /></td>
                      <td className="py-2 text-left">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
