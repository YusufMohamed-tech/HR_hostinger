"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { getSalesReports, type SalesAgent, type SalesLog } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { PageSkeleton } from "@/components/Skeletons";

function formatMoney(value: number) {
  return formatCurrency(value, 0);
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function SalesDashboardPage() {
  const [logs, setLogs] = useState<SalesLog[]>([]);
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    params.set("date_from", from);
    getSalesReports(params).then((result) => {
      if (result.error || !result.data) setMessage(result.error || "تعذر تحميل لوحة المبيعات.");
      else {
        setLogs(result.data.logs);
        setAgents(result.data.agents);
      }
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const today = dateKey(now);
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeAgents = agents.filter((agent) => agent.role === "sales" && String(agent.status || "").toLowerCase() === "active").length;
    return {
      today: logs.filter((log) => log.log_date === today).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
      week: logs.filter((log) => new Date(log.log_date) >= weekStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
      month: logs.filter((log) => new Date(log.log_date) >= monthStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
      activeAgents,
    };
  }, [agents, logs]);

  const leaderboard = useMemo(() => {
    const now = new Date();
    const today = dateKey(now);
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return agents
      .filter((agent) => agent.role === "sales")
      .map((agent) => {
        const agentLogs = logs.filter((log) => log.sales_agent_id === agent.user_id);
        return {
          ...agent,
          today: agentLogs.filter((log) => log.log_date === today).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          week: agentLogs.filter((log) => new Date(log.log_date) >= weekStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          month: agentLogs.filter((log) => new Date(log.log_date) >= monthStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
        };
      })
      .sort((a, b) => b.month - a.month);
  }, [agents, logs]);

  const chartData = useMemo(() => {
    const days = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.now() - (29 - index) * 86400000);
      const key = dateKey(date);
      return { date: key.slice(5), total: 0 };
    });
    const byDate = new Map(days.map((day) => [day.date, day]));
    logs.forEach((log) => {
      const key = log.log_date.slice(5);
      const day = byDate.get(key);
      if (day) day.total += Number(log.grand_total || 0);
    });
    return days;
  }, [logs]);

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

      <Card className="border-none shadow-sm">
        <CardContent className="p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-950">مبيعات آخر 30 يوم</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => formatMoney(Number(value || 0))} />
                <Bar dataKey="total" fill="#58B145" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

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
              {leaderboard.map((agent) => (
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
