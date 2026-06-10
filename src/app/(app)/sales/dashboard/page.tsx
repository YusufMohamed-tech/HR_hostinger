"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { getSalesDashboard, type SalesChartPoint, type SalesDashboardAgent, type SalesDashboardData } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { PageSkeleton } from "@/components/Skeletons";

function formatMoney(value: number) {
  return formatCurrency(value, 0);
}

function formatAxisMoney(value: number) {
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(1))}م`;
  if (value >= 1000) return `${Math.round(value / 1000)}ك`;
  return String(Math.round(value));
}

export default function SalesDashboardPage() {
  const [dashboard, setDashboard] = useState<SalesDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getSalesDashboard().then((result) => {
      if (result.error || !result.data) setMessage(result.error || "تعذر تحميل لوحة المبيعات.");
      else setDashboard(result.data);
      setLoading(false);
    });
  }, []);

  const stats = dashboard?.stats ?? { today: 0, week: 0, month: 0, activeAgents: 0 };
  const leaderboard = useMemo(() => dashboard?.leaderboard ?? [], [dashboard]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-950">لوحة المبيعات</h1>
        <p className="mt-2 text-gray-500">متابعة أداء فريق المبيعات وإجماليات الفترة الحالية.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="مبيعات اليوم" value={formatMoney(stats.today)} icon={TrendingUp} />
        <StatCard title="مبيعات الأسبوع" value={formatMoney(stats.week)} icon={CalendarDays} />
        <StatCard title="مبيعات الشهر" value={formatMoney(stats.month)} icon={BarChart3} />
        <StatCard title="البائعون النشطون" value={String(stats.activeAgents)} icon={Users} />
      </div>

      <SalesChartCard
        title="مبيعات الشهور"
        description="إجمالي المبيعات مجمعة شهرياً من بداية السنة الحالية."
        data={dashboard?.monthlySales ?? []}
        xInterval={0}
      />

      <SalesChartCard
        title="مبيعات آخر 30 يوم"
        description="إجمالي المبيعات اليومية خلال آخر 30 يوم."
        data={dashboard?.dailySales ?? []}
        xInterval={2}
      />

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>البائع</TableHead>
                <TableHead>اليوم</TableHead>
                <TableHead>الأسبوع</TableHead>
                <TableHead>الشهر</TableHead>
                <TableHead>التقرير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((agent: SalesDashboardAgent) => (
                <TableRow key={agent.user_id}>
                  <TableCell>
                    <p className="font-semibold">{agent.full_name}</p>
                    <p className="text-xs text-gray-500">{agent.email}</p>
                  </TableCell>
                  <TableCell>{formatMoney(agent.today)}</TableCell>
                  <TableCell>{formatMoney(agent.week)}</TableCell>
                  <TableCell className="font-semibold text-brand-dark">{formatMoney(agent.month)}</TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sales/reports?agent=${agent.user_id}`}>عرض التقرير</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SalesChartCard({
  title,
  description,
  data,
  xInterval,
}: {
  title: string;
  description: string;
  data: SalesChartPoint[];
  xInterval: number;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <div className="h-72 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d1d5db" />
              <XAxis
                dataKey="label"
                interval={xInterval}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#9ca3af" }}
              />
              <YAxis
                width={64}
                tickFormatter={(value) => formatAxisMoney(Number(value || 0))}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#9ca3af" }}
              />
              <Tooltip
                formatter={(value) => formatMoney(Number(value || 0))}
                labelStyle={{ color: "#111827" }}
                contentStyle={{ direction: "rtl", borderRadius: 8, borderColor: "#e5e7eb" }}
              />
              <Bar dataKey="total" fill="#58B145" radius={[7, 7, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="mt-2 text-xl font-bold text-gray-950">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
