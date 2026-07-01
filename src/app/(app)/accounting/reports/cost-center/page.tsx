"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function CostCenterPnLPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("cost-center-pnl", dates);
      setData(result);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const inner = (data as any)?.data || data;
  const rows = inner?.rows || [];
  const totals = inner?.totals || {};

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="ربحية مراكز التكلفة"
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
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">لا توجد بيانات</div>
      ) : (
        <>
          {/* Chart */}
          <Card>
            <CardHeader><CardTitle>مقارنة الربحية</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={rows.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cost_center_name" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => v.toLocaleString("ar-SA")} />
                  <Legend />
                  <Bar dataKey="revenue" name="الإيرادات" fill="#3b82f6" />
                  <Bar dataKey="expenses" name="المصروفات" fill="#ef4444" />
                  <Bar dataKey="net_profit" name="صافي الربح" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardHeader><CardTitle>التفاصيل</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b font-medium">
                    <th className="text-right py-2">مركز التكلفة</th>
                    <th className="text-left py-2">الإيرادات</th>
                    <th className="text-left py-2">المصروفات</th>
                    <th className="text-left py-2">صافي الربح</th>
                    <th className="text-left py-2">الهامش %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => (
                    <tr key={row.cost_center_id} className="border-b last:border-0">
                      <td className="py-2">{row.cost_center_name}</td>
                      <td className="py-2 text-left"><MoneyAmount value={row.revenue} /></td>
                      <td className="py-2 text-left"><MoneyAmount value={row.expenses} /></td>
                      <td className={`py-2 text-left ${row.net_profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        <MoneyAmount value={row.net_profit} />
                      </td>
                      <td className="py-2 text-left">{row.margin_percent !== null ? `${row.margin_percent}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2">
                    <td className="py-2">الإجمالي</td>
                    <td className="py-2 text-left"><MoneyAmount value={totals.revenue} /></td>
                    <td className="py-2 text-left"><MoneyAmount value={totals.expenses} /></td>
                    <td className="py-2 text-left"><MoneyAmount value={totals.net_profit} /></td>
                    <td className="py-2 text-left">-</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
