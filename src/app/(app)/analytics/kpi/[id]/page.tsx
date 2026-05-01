"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MiniLineChart } from "@/components/charts/MiniLineChart";
import { kpiTargets } from "@/data/mock";

export default function KpiDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const kpi = kpiTargets.find((item) => item.id === id);

  if (!kpi) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">KPI not found</h1>
        <Button asChild variant="outline">
          <Link href="/analytics">Back to analytics</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{kpi.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Target vs actual performance breakdown.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/analytics">Back to analytics</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Target</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-gray-900">{kpi.target}</p>
            <p className="text-xs text-gray-500">Monthly target</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Actual</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-gray-900">{kpi.actual}</p>
            <p className="text-xs text-gray-500">Latest measured value</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={kpi.trend.startsWith("-") ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}>
              {kpi.trend}
            </Badge>
            <p className="text-xs text-gray-500 mt-2">Benchmark {kpi.benchmark}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Weekly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <MiniLineChart values={kpi.series ?? [60, 62, 65, 67, 66, 68, 70]} />
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Recommended Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>1. Review staffing coverage for low-performing shifts.</p>
          <p>2. Schedule team coaching session for next sprint.</p>
          <p>3. Monitor KPI daily and alert team leaders on drift.</p>
        </CardContent>
      </Card>
    </div>
  );
}
