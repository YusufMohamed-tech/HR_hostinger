"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AccountingPageHeader, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { ReportExportMenu } from "@/components/accounting/reports/ReportExportMenu";
import { getAccountingReport } from "@/lib/services/accounting";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

function today() { return new Date().toISOString().slice(0, 10); }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function CashFlowPage() {
  const [dates, setDates] = useState({ date_from: yearStart(), date_to: today() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await getAccountingReport("cash-flow", dates);
      setData(result);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const cashFlow = (data as any)?.data || data;

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="قائمة التدفقات النقدية"
        actions={
          <>
            <Input type="date" value={dates.date_from} onChange={(e) => setDates((d) => ({ ...d, date_from: e.target.value }))} className="w-40" />
            <Input type="date" value={dates.date_to} onChange={(e) => setDates((d) => ({ ...d, date_to: e.target.value }))} className="w-40" />
            <Button onClick={load}>تحديث</Button>
            <ReportExportMenu reportId="cash-flow" params={{ date_from: dates.date_from, date_to: dates.date_to }} />
          </>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
      ) : !cashFlow ? (
        <div className="text-center py-12 text-muted-foreground">لا توجد بيانات</div>
      ) : (
        <>
          {/* Chart */}
          <Card>
            <CardHeader><CardTitle>ملخص التدفقات النقدية</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { name: "تشغيلية", value: cashFlow.operating?.total || 0 },
                  { name: "استثمارية", value: cashFlow.investing?.total || 0 },
                  { name: "تمويلية", value: cashFlow.financing?.total || 0 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(v: unknown) => typeof v === "number" ? v.toLocaleString("ar-SA") : String(v ?? "")} />
                  <Bar dataKey="value" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Sections */}
          <CashFlowSection title="الأنشطة التشغيلية" section={cashFlow.operating} />
          <CashFlowSection title="الأنشطة الاستثمارية" section={cashFlow.investing} />
          <CashFlowSection title="الأنشطة التمويلية" section={cashFlow.financing} />

          {/* Reconciliation warning */}
          {cashFlow.reconciliation_difference && cashFlow.reconciliation_difference !== 0 && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm">
              <p className="font-semibold text-yellow-800">
                تحذير: فرق في المطابقة ({cashFlow.reconciliation_difference.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س)
              </p>
              <p className="text-yellow-700 mt-1">
                الرصيد المحسوب لا يطابق رصيد دفتر الأستاذ. يرجى مراجعة تصنيف الحسابات.
              </p>
            </div>
          )}

          {/* Summary Cards - Footer */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            <SummaryCard label="الرصيد الافتتاحي" value={cashFlow.opening_cash} />
            <SummaryCard label="صافي التغير" value={cashFlow.net_change} />
            <SummaryCard label="الرصيد الختامي" value={cashFlow.closing_cash} />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-xl font-bold mt-1"><MoneyAmount value={value || 0} /></div>
      </CardContent>
    </Card>
  );
}

function CashFlowSection({ title, section }: { title: string; section: any }) {
  if (!section) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{title}</span>
          <MoneyAmount value={section.total || 0} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-right py-2">الحساب</th>
              <th className="text-left py-2">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {(section.items || []).map((item: any, i: number) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2">{item.account_name}</td>
                <td className="py-2 text-left"><MoneyAmount value={item.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
