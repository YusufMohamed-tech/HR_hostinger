"use client";

import React, { useState, useEffect } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { getPayslips, generatePayslip } from "@/lib/services/payroll";
import { useEmployees } from "@/hooks/use-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Download, Calculator } from "lucide-react";

export default function PayrollPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [payslips, setPayslips] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const currentMonth = new Date().toISOString().substring(0, 7) + "-01";

  useEffect(() => {
    if (!currentUser?.orgId) return;
    async function load() {
      setLoading(true);
      const { data } = await getPayslips(currentUser?.orgId as string, currentMonth);
      if (data) setPayslips(data);
      setLoading(false);
    }
    load();
  }, [currentUser?.orgId, currentMonth]);

  const handleRunPayroll = async () => {
    if (!currentUser?.orgId) return;
    setGenerating(true);
    for (const emp of employees) {
      // Basic safeguard to avoid duplicates
      if (payslips.find((p) => p.employee_id === emp.id)) continue;
      await generatePayslip(currentUser.orgId, String(emp.id), currentMonth);
    }
    const { data } = await getPayslips(currentUser.orgId, currentMonth);
    if (data) setPayslips(data);
    setGenerating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Payroll Module</h1>
          <p className="text-sm text-gray-500">Manage employee salaries, attendance-based deductions, and payslips.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Download className="w-4 h-4 mr-2" /> Export WPS</Button>
          {currentUser?.role !== "Employee" && (
            <Button className="bg-brand hover:bg-brand-dark" onClick={handleRunPayroll} disabled={generating}>
              <Calculator className="w-4 h-4 mr-2" /> {generating ? "Calculating..." : "Run Payroll for Month"}
            </Button>
          )}
        </div>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            <CardTitle>{new Date(currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} Payslips</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading payroll data...</div>
          ) : payslips.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">No payslips generated for this month. Run payroll to begin.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Base Salary</TableHead>
                    <TableHead>Attendance (Days)</TableHead>
                    <TableHead>Deductions</TableHead>
                    <TableHead>Net Salary</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((slip) => {
                    const employee = (slip.employee ?? null) as Record<string, unknown> | null;
                    const status = typeof slip.status === "string" ? slip.status : "draft";
                    return (
                    <TableRow key={String(slip.id)}>
                      <TableCell className="font-medium">
                        {String(employee?.full_name || "Unknown")}
                        <div className="text-xs text-gray-500">{String(employee?.employee_code || "")}</div>
                      </TableCell>
                      <TableCell>{Number(slip.base_salary || 0).toLocaleString()} SAR</TableCell>
                      <TableCell>{Number(slip.attendance_days || 0)}</TableCell>
                      <TableCell className="text-red-600">-{Number(slip.total_deductions || 0).toLocaleString()} SAR</TableCell>
                      <TableCell className="font-bold text-green-600">{Number(slip.net_salary || 0).toLocaleString()} SAR</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}>
                          {status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
