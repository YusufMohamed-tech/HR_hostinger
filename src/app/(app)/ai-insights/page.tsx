"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAiInsights } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";
import { Sparkles, BellRing, TrendingUp, AlertTriangle } from "lucide-react";

const impactClass = (impact: string) => {
  if (impact === "High") return "bg-red-50 text-red-700 border-red-200";
  if (impact === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-green-50 text-green-700 border-green-200";
};

const impactIcon = (impact: string) => {
  if (impact === "High") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (impact === "Medium") return <TrendingUp className="h-4 w-4 text-amber-500" />;
  return <Sparkles className="h-4 w-4 text-green-500" />;
};

export default function AiInsightsPage() {
  const { data: aiInsights, loading } = useAiInsights();

  if (loading) {
    return <PageSkeleton />;
  }
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
              <div className="flex items-center gap-2">
                {impactIcon(insight.impact)}
                <CardTitle className="text-lg">{insight.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="outline" className={impactClass(insight.impact)}>{insight.impact} Impact</Badge>
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
          <div className="h-[220px] rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
              <BellRing className="h-6 w-6 text-brand" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">Action board coming soon</p>
              <p className="text-xs text-gray-400 mt-1">AI-generated action items will appear here</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
