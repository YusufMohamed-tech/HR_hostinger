"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { getPayslips, generatePayslip, updatePayslipStatus } from "@/lib/services/payroll";
import { useEmployees } from "@/hooks/use-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Download, Calculator, CheckCircle, Banknote } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد",
  paid: "مدفوع",
};

const statusColors: Record<string, string> = {
  draft: "bg-orange-50 text-orange-700 border-orange-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  paid: "bg-green-50 text-green-700 border-green-200",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-SA")} ريال`;
}

function exportPayrollPdf(input: {
  monthLabel: string;
  rows: Record<string, unknown>[];
  totalNet: number;
  totalDeductions: number;
  approvedCount: number;
}) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
  if (!popup) {
    return false;
  }

  const tableRows = input.rows.length
    ? input.rows.map((slip, index) => {
        const employee = (slip.employee ?? null) as Record<string, unknown> | null;
        const status = typeof slip.status === "string" ? slip.status : "draft";
        const statusLabel = statusLabels[status] || status;
        return `<tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(employee?.full_name || "غير معروف")}</strong><div class="muted">${escapeHtml(employee?.employee_code || "-")}</div></td>
          <td>${escapeHtml(formatMoney(slip.base_salary))}</td>
          <td>${escapeHtml(formatMoney(slip.total_allowances))}</td>
          <td>${escapeHtml(Number(slip.attendance_days || 0))}</td>
          <td>${escapeHtml(formatMoney(slip.total_deductions))}</td>
          <td>${escapeHtml(formatMoney(slip.net_salary))}</td>
          <td>${escapeHtml(statusLabel)}</td>
          <td>${escapeHtml(slip.payroll_notes || "-")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="9">لا توجد مسيرات رواتب لهذا الشهر.</td></tr>`;

  popup.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>مسير رواتب ${escapeHtml(input.monthLabel)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Tahoma, sans-serif; color: #111827; margin: 0; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0 0 6px; }
    .muted { color: #6b7280; font-size: 12px; margin-top: 3px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; background: #f9fafb; }
    .box span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
    .box strong { font-size: 15px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: right; vertical-align: top; font-size: 11px; word-break: break-word; }
    th { background: #eef2f7; font-weight: 700; }
    td:nth-child(1), th:nth-child(1) { width: 38px; text-align: center; }
    td:nth-child(9), th:nth-child(9) { width: 210px; }
    .footer { margin-top: 14px; color: #6b7280; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>مسير رواتب ${escapeHtml(input.monthLabel)}</h1>
      <div class="muted">تقرير مجدول يشمل بيانات الرواتب والحضور والخصومات والحالة.</div>
    </div>
    <div class="muted">تاريخ التصدير: ${escapeHtml(new Date().toLocaleString("ar-SA"))}</div>
  </div>
  <div class="summary">
    <div class="box"><span>إجمالي الموظفين</span><strong>${input.rows.length}</strong></div>
    <div class="box"><span>المعتمدون / الإجمالي</span><strong>${input.approvedCount} / ${input.rows.length}</strong></div>
    <div class="box"><span>إجمالي الخصومات</span><strong>${escapeHtml(formatMoney(input.totalDeductions))}</strong></div>
    <div class="box"><span>إجمالي صافي الرواتب</span><strong>${escapeHtml(formatMoney(input.totalNet))}</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الموظف</th>
        <th>الراتب الأساسي</th>
        <th>البدلات</th>
        <th>أيام الحضور</th>
        <th>الخصومات</th>
        <th>صافي الراتب</th>
        <th>الحالة</th>
        <th>ملاحظات الحساب</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">هذا التقرير صادر من نظام تطوير تالنت للموارد البشرية.</div>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

export default function PayrollPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [payslips, setPayslips] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const isAdmin = currentUser?.role !== "Employee";

  const monthParam = selectedMonth + "-01";

  const loadPayslips = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = await getPayslips(currentUser.orgId, monthParam);
    if (data) setPayslips(data);
    else setPayslips([]);
    setLoading(false);
  }, [currentUser?.orgId, monthParam]);

  useEffect(() => {
    loadPayslips();
  }, [loadPayslips]);

  const handleRunPayroll = async () => {
    if (!currentUser?.orgId) return;
    setGenerating(true);
    for (const emp of employees) {
      if (payslips.find((p) => p.employee_id === emp.id)) continue;
      await generatePayslip(currentUser.orgId, String(emp.id), monthParam);
    }
    await loadPayslips();
    setGenerating(false);
  };

  const handleStatusChange = async (payslipId: string, newStatus: "draft" | "approved" | "paid") => {
    await updatePayslipStatus(payslipId, newStatus);
    setPayslips((prev) =>
      prev.map((p) => (p.id === payslipId ? { ...p, status: newStatus } : p))
    );
  };

  // Summary totals
  const totalNet = payslips.reduce((sum, p) => sum + Number(p.net_salary || 0), 0);
  const totalDeductions = payslips.reduce((sum, p) => sum + Number(p.total_deductions || 0), 0);
  const approvedCount = payslips.filter((p) => p.status === "approved" || p.status === "paid").length;
  const monthLabel = new Date(monthParam).toLocaleDateString("ar-SA", { month: "long", year: "numeric" });

  const handleExportPayroll = () => {
    const exported = exportPayrollPdf({
      monthLabel,
      rows: payslips,
      totalNet,
      totalDeductions,
      approvedCount,
    });
    if (!exported) {
      setMessage("تعذر فتح نافذة التصدير. تأكد من السماح بالنوافذ المنبثقة ثم حاول مرة أخرى.");
    }
  };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">وحدة الرواتب</h1>
          <p className="text-sm text-gray-500">إدارة رواتب الموظفين والخصومات المبنية على الحضور ومسيرات الرواتب.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-40 text-center"
          />
          {isAdmin && (
            <>
              <Button variant="outline" onClick={handleExportPayroll}>
                <Download className="w-4 h-4 ml-2" /> تصدير PDF
              </Button>
              <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleRunPayroll} disabled={generating}>
                <Calculator className="w-4 h-4 ml-2" /> {generating ? "جار الحساب..." : "تشغيل رواتب الشهر"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">إجمالي صافي الرواتب</p>
            <p className="text-xl font-semibold text-green-600">{totalNet.toLocaleString()} ريال</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">إجمالي الخصومات</p>
            <p className="text-xl font-semibold text-red-600">{totalDeductions.toLocaleString()} ريال</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">المعتمدون / الإجمالي</p>
            <p className="text-xl font-semibold text-blue-600">{approvedCount} / {payslips.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            <CardTitle>
              {new Date(monthParam).toLocaleDateString("ar-SA", { month: "long", year: "numeric" })} — مسيرات الرواتب
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">جار تحميل بيانات الرواتب...</div>
          ) : payslips.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              لم يتم إنشاء مسيرات لهذا الشهر. شغّل الرواتب للبدء.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead>الموظف</TableHead>
                  <TableHead>الراتب الأساسي</TableHead>
                  <TableHead>أيام الحضور</TableHead>
                  <TableHead>الخصومات</TableHead>
                  <TableHead>صافي الراتب</TableHead>
                  <TableHead>الحالة</TableHead>
                  {isAdmin && <TableHead className="text-right">الإجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((slip) => {
                  const employee = (slip.employee ?? null) as Record<string, unknown> | null;
                  const status = typeof slip.status === "string" ? slip.status : "draft";
                  const slipId = String(slip.id);
                  return (
                    <TableRow key={slipId}>
                      <TableCell className="font-medium">
                        <div>
                          <p>{String(employee?.full_name || "غير معروف")}</p>
                          <p className="text-xs text-gray-500">{String(employee?.employee_code || "")}</p>
                        </div>
                      </TableCell>
                      <TableCell>{Number(slip.base_salary || 0).toLocaleString()} ريال</TableCell>
                      <TableCell>{Number(slip.attendance_days || 0)} يوم</TableCell>
                      <TableCell className="text-red-600">
                        -{Number(slip.total_deductions || 0).toLocaleString()} ريال
                      </TableCell>
                      <TableCell className="font-bold text-green-600">
                        {Number(slip.net_salary || 0).toLocaleString()} ريال
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[status] || "bg-gray-50 text-gray-700"}>
                          {statusLabels[status] || status}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {status === "draft" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleStatusChange(slipId, "approved")}
                              >
                                <CheckCircle className="h-4 w-4 ml-1" /> اعتماد
                              </Button>
                            )}
                            {status === "approved" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => handleStatusChange(slipId, "paid")}
                              >
                                <Banknote className="h-4 w-4 ml-1" /> تحديد مدفوع
                              </Button>
                            )}
                            {status === "paid" && (
                              <span className="text-xs text-gray-400">مكتمل</span>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

