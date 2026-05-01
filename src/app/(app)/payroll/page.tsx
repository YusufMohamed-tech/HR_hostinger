"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePayrollRuns, usePayrollPreview } from "@/hooks/use-data";

export default function PayrollPage() {
  const { data: payrollRuns, loading: loadingRuns } = usePayrollRuns();
  const { data: payrollPreview, loading: loadingPreview } = usePayrollPreview();

  if (loadingRuns || loadingPreview) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading payroll...</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
          <p className="text-gray-500 text-sm mt-1">
            Review payroll cycles, bonuses, and KPI based payouts.
          </p>
        </div>
        <Button className="bg-brand hover:bg-brand-dark text-white">Run Payroll</Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Payroll Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Run ID</TableHead>
                <TableHead className="font-semibold text-gray-600">Period</TableHead>
                <TableHead className="font-semibold text-gray-600">Employees</TableHead>
                <TableHead className="font-semibold text-gray-600">Total</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium text-gray-900">{run.id}</TableCell>
                  <TableCell className="text-gray-600">{run.period}</TableCell>
                  <TableCell className="text-gray-600">{run.employees}</TableCell>
                  <TableCell className="text-gray-600">{run.total}</TableCell>
                  <TableCell>
                    <Badge className={run.status === "Completed" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/payroll/${run.id}`} className="text-brand hover:text-brand-dark text-sm">
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Payroll Preview</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Base</TableHead>
                <TableHead className="font-semibold text-gray-600">Bonus</TableHead>
                <TableHead className="font-semibold text-gray-600">Deductions</TableHead>
                <TableHead className="font-semibold text-gray-600">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollPreview.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-gray-700 font-medium">{row.name}</TableCell>
                  <TableCell className="text-gray-600">{row.base} SAR</TableCell>
                  <TableCell className="text-gray-600">{row.bonus} SAR</TableCell>
                  <TableCell className="text-gray-600">{row.deductions} SAR</TableCell>
                  <TableCell className="text-gray-900 font-semibold">{row.total} SAR</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
