"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MiniBarChart } from "@/components/charts/MiniBarChart";
import { MiniLineChart } from "@/components/charts/MiniLineChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useKpiTargets } from "@/hooks/use-data";

const trendClass = (trend: string) =>
  trend.startsWith("-")
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-green-50 text-green-700 border-green-200";

export default function AnalyticsPage() {
  const { data: kpiTargets, loading } = useKpiTargets();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading analytics...</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">KPI and Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">
          Track targets, team performance, and workforce comparisons.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {kpiTargets.map((kpi) => (
          <Card key={kpi.id} className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{kpi.name}</CardTitle>
              <CardDescription>Target vs actual</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Target</p>
                  <p className="text-lg font-semibold text-gray-900">{kpi.target}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Actual</p>
                  <p className="text-lg font-semibold text-gray-900">{kpi.actual}</p>
                </div>
                <Badge className={trendClass(kpi.trend)}>{kpi.trend}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Performance Over Time</CardTitle>
            <CardDescription>Weekly KPI trend line.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <MiniLineChart values={[62, 66, 68, 72, 74, 73, 76]} />
              <p className="text-xs text-gray-500 mt-3">Utilization trend for the last 7 days.</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Team Comparison</CardTitle>
            <CardDescription>Output by team and location.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <MiniBarChart values={[58, 82, 74, 90, 66]} />
              <div className="mt-3 flex justify-between text-xs text-gray-500">
                <span>Ops</span>
                <span>Logistics</span>
                <span>Support</span>
                <span>Retail</span>
                <span>Field</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>KPI Targets</CardTitle>
          <CardDescription>Targets and measured results for this cycle.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Metric</TableHead>
                <TableHead className="font-semibold text-gray-600">Target</TableHead>
                <TableHead className="font-semibold text-gray-600">Actual</TableHead>
                <TableHead className="font-semibold text-gray-600">Trend</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kpiTargets.map((kpi) => (
                <TableRow key={kpi.id}>
                  <TableCell className="text-gray-700 font-medium">{kpi.name}</TableCell>
                  <TableCell className="text-gray-600">{kpi.target}</TableCell>
                  <TableCell className="text-gray-600">{kpi.actual}</TableCell>
                  <TableCell>
                    <Badge className={trendClass(kpi.trend)}>{kpi.trend}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/analytics/kpi/${kpi.id}`} className="text-brand hover:text-brand-dark text-sm">
                      View
                    </Link>
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
