"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiInsights } from "@/data/mock";

const impactClass = (impact: string) => {
  if (impact === "High") return "bg-red-50 text-red-700 border-red-200";
  if (impact === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-green-50 text-green-700 border-green-200";
};

export default function AiInsightsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Insights</h1>
        <p className="text-gray-500 text-sm mt-1">
          Intelligent signals based on attendance, KPI drift, and anomalies.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {aiInsights.map((insight) => (
          <Card key={insight.id} className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">{insight.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge className={impactClass(insight.impact)}>{insight.impact} Impact</Badge>
              <p className="text-sm text-gray-600">{insight.summary}</p>
              <p className="text-xs text-gray-400">Recommended action: notify team lead and schedule review.</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Suggested Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] rounded-xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-sm text-gray-400">
            Action board placeholder
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
