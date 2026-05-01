"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePayrollRuns, usePayrollPreview } from "@/hooks/use-data";

export default function PayrollRunDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: payrollRuns } = usePayrollRuns();
  const { data: payrollPreview } = usePayrollPreview();
  const run = payrollRuns.find((item: Record<string, unknown>) => item.id === id);

  if (!run) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Payroll run not found</h1>
        <Button asChild variant="outline">
          <Link href="/payroll">Back to payroll</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll Run {run.id}</h1>
          <p className="text-gray-500 text-sm mt-1">Review totals, approvals, and payouts.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/payroll">Back to payroll</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Period</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-gray-900">{run.period}</p>
            <p className="text-xs text-gray-500">Pay cycle</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-gray-900">{run.employees}</p>
            <p className="text-xs text-gray-500">Included in run</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={run.status === "Completed" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
              {run.status}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Payroll Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <span>Base salaries</span>
            <span>1,560,000 SAR</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Bonuses</span>
            <span>190,000 SAR</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Deductions</span>
            <span>-30,000 SAR</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-gray-900">
            <span>Total</span>
            <span>{run.total}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Sample Payroll Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {payrollPreview.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{row.name}</p>
                <p className="text-xs text-gray-500">Base {row.base} SAR • Bonus {row.bonus} SAR</p>
              </div>
              <p className="text-sm font-semibold text-gray-900">{row.total} SAR</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
