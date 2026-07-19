"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRoleContext } from "@/providers/RoleProvider";
import { getPayslips, recalculatePayslip, runPayroll, transitionPayrollRun, type ManualAdjustment, type PayrollRun } from "@/lib/services/payroll";
import { createPayrollDraftEntry, getPayrollAccountingStatus, postJournalEntry, recordPayrollPayment } from "@/lib/services/accounting";
import type { PayrollAccountingStatus } from "@/types/accounting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils/currency";
import { printHtmlReport } from "@/lib/utils/print-report";
import { Calendar, Download, Calculator, CheckCircle, RefreshCw, Plus, ChevronDown, ChevronUp, Trash2, AlertTriangle } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد",
  paid: "مدفوع",
  void: "ملغى",
};

const statusColors: Record<string, string> = {
  draft: "bg-orange-50 text-orange-700 border-orange-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  void: "bg-gray-100 text-gray-700 border-gray-200",
};

const accountingStatusLabels: Record<string, string> = {
  not_generated: "لم ينشأ",
  draft_created: "مسودة جاهزة",
  posted: "مرحل",
  paid: "مدفوع",
};

const accountingStatusColors: Record<string, string> = {
  not_generated: "bg-gray-50 text-gray-700 border-gray-200",
  draft_created: "bg-orange-50 text-orange-700 border-orange-200",
  posted: "bg-blue-50 text-blue-700 border-blue-200",
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
  return formatCurrency(value);
}

function exportPayrollPdf(input: {
  monthLabel: string;
  rows: Record<string, unknown>[];
  totalNet: number;
  totalDeductions: number;
  approvedCount: number;
}) {
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

  const html = `<!doctype html>
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
</html>`;

  return printHtmlReport(html, `payroll-${input.monthLabel}`);
}

type AdjustForm = { type: "bonus" | "deduction"; amount: string; reason: string };

export default function PayrollPage() {
  const { currentUser } = useRoleContext();
  const [payslips, setPayslips] = useState<Record<string, unknown>[]>([]);
  const [payrollRun, setPayrollRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [accountingStatus, setAccountingStatus] = useState<PayrollAccountingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [recalculating, setRecalculating] = useState<string | null>(null);
  const [adjustDialog, setAdjustDialog] = useState<{ payslipId: string; employeeName: string } | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({ type: "bonus", amount: "", reason: "" });
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [adjustError, setAdjustError] = useState("");

  const role = String(currentUser?.role || "");
  const canRunPayroll = ["Admin", "HR_Admin"].includes(role);
  const canViewAccountingStatus = ["Admin", "HR_Admin", "Finance_Manager", "Accountant", "Finance_Viewer", "Superadmin"].includes(role);
  const canGenerateAccountingDraft = ["Finance_Manager", "Accountant"].includes(role);
  const canPostPayrollAccounting = role === "Finance_Manager";

  const monthParam = selectedMonth + "-01";

  const loadPayslips = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const [payslipsResult, accountingResult] = await Promise.all([
      getPayslips(currentUser.orgId, monthParam),
      canViewAccountingStatus ? getPayrollAccountingStatus(monthParam) : Promise.resolve({ data: null, error: null }),
    ]);
    setPayslips(payslipsResult.data || []);
    setPayrollRun(payslipsResult.run || null);
    if (accountingResult.data) setAccountingStatus(accountingResult.data);
    else setAccountingStatus(null);
    setLoading(false);
  }, [currentUser?.orgId, monthParam, canViewAccountingStatus]);

  useEffect(() => { loadPayslips(); }, [loadPayslips]);

  const handleRunPayroll = async () => {
    if (!currentUser?.orgId) return;
    setGenerating(true);
    const result = await runPayroll(monthParam);
    if (result.error) setMessage(result.error.message);
    else await loadPayslips();
    setGenerating(false);
  };

  const handleRecalculate = async (slip: Record<string, unknown>) => {
    const slipId = String(slip.id);
    setRecalculating(slipId);
    const result = await recalculatePayslip(String(slip.employee_id), monthParam);
    if (result.error) setMessage(result.error.message);
    else await loadPayslips();
    setRecalculating(null);
  };

  const handleApproveRun = async () => {
    if (!payrollRun) return;
    const result = await transitionPayrollRun({
      payrollRunId: payrollRun.id,
      expectedVersion: Number(payrollRun.version),
      targetStatus: "approved",
    });
    if (result.error) setMessage(result.error.message);
    else await loadPayslips();
  };

  const openAdjustDialog = (slip: Record<string, unknown>) => {
    const employee = (slip.employee ?? {}) as Record<string, unknown>;
    setAdjustDialog({ payslipId: String(slip.id), employeeName: String(employee.full_name || "الموظف") });
    setAdjustForm({ type: "bonus", amount: "", reason: "" });
    setAdjustError("");
  };

  const handleAddAdjustment = async () => {
    if (!adjustDialog) return;
    const amount = Number(adjustForm.amount);
    if (!amount || amount <= 0) { setAdjustError("أدخل مبلغاً صحيحاً."); return; }
    if (!adjustForm.reason.trim()) { setAdjustError("السبب مطلوب."); return; }
    setAdjustSubmitting(true);
    setAdjustError("");
    const res = await fetch("/api/payroll/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payslip_id: adjustDialog.payslipId, command_id: crypto.randomUUID(), type: adjustForm.type, amount, reason: adjustForm.reason }),
    });
    const json = await res.json();
    setAdjustSubmitting(false);
    if (!res.ok) { setAdjustError(json.message || "فشل إضافة التسوية."); return; }
    await loadPayslips();
    setAdjustDialog(null);
  };

  const handleRemoveAdjustment = async (payslipId: string, adjustmentId: string) => {
    const commandId = crypto.randomUUID();
    const res = await fetch(`/api/payroll/adjust/${adjustmentId}?payslipId=${payslipId}&commandId=${commandId}`, { method: "DELETE" });
    if (res.ok) await loadPayslips();
    else { const json = await res.json(); setMessage(json.message || "فشل حذف التسوية."); }
  };

  const handleGenerateAccountingDraft = async () => {
    setAccountingBusy(true);
    const result = await createPayrollDraftEntry(monthParam);
    if (result.error) setMessage(result.error);
    else setMessage("تم إنشاء مسودة قيد الرواتب.");
    await loadPayslips();
    setAccountingBusy(false);
  };

  const handlePostAccountingJournal = async () => {
    if (!accountingStatus?.journal_entry_id) return;
    setAccountingBusy(true);
    const result = await postJournalEntry(accountingStatus.journal_entry_id);
    if (result.error) setMessage(result.error);
    else setMessage("تم ترحيل قيد الرواتب.");
    await loadPayslips();
    setAccountingBusy(false);
  };

  const handleRecordPayrollPayment = async () => {
    setAccountingBusy(true);
    const result = await recordPayrollPayment({ month: monthParam, amount: accountingStatus?.total_net || totalNet, payment_date: new Date().toISOString().slice(0, 10) });
    if (result.error) setMessage(result.error);
    else setMessage("تم تسجيل سداد الرواتب وترحيل قيده.");
    await loadPayslips();
    setAccountingBusy(false);
  };

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => { const next = new Set(prev); if (next.has(id)) { next.delete(id); } else { next.add(id); } return next; });

  const totalNet = payslips.reduce((sum, p) => sum + Number(p.net_salary || 0), 0);
  const totalDeductions = payslips.reduce((sum, p) => sum + Number(p.total_deductions || 0), 0);
  const totalEmployerGosi = payslips.reduce((sum, p) => sum + Number(p.employer_gosi || 0), 0);
  const approvedCount = payslips.filter((p) => p.status === "approved" || p.status === "paid").length;
  const monthLabel = new Date(monthParam).toLocaleDateString("ar-SA", { month: "long", year: "numeric" });

  const handleExportPayroll = () => {
    const exported = exportPayrollPdf({ monthLabel, rows: payslips, totalNet, totalDeductions, approvedCount });
    if (!exported) setMessage("تعذر فتح نافذة الطباعة. افتح الملف من التنزيلات ثم اختر طباعة / حفظ PDF.");
  };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />

      {/* Manual Adjustment Dialog */}
      <Dialog open={Boolean(adjustDialog)} onOpenChange={(open) => !open && setAdjustDialog(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>إضافة تسوية يدوية</DialogTitle>
            <DialogDescription>{adjustDialog?.employeeName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={adjustForm.type} onValueChange={(v) => setAdjustForm((f) => ({ ...f, type: v as "bonus" | "deduction" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bonus">مكافأة / إضافة</SelectItem>
                  <SelectItem value="deduction">خصم يدوي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>المبلغ (ر.س)</Label>
              <Input type="number" min={0} step="0.01" value={adjustForm.amount} onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>السبب</Label>
              <Input value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} placeholder="مثال: مكافأة أداء Q2" />
            </div>
            {adjustError && <p className="text-sm text-red-600">{adjustError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialog(null)} disabled={adjustSubmitting}>إلغاء</Button>
            <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleAddAdjustment} disabled={adjustSubmitting}>
              {adjustSubmitting ? "جار الحفظ..." : "إضافة التسوية"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">وحدة الرواتب</h1>
          <p className="text-sm text-gray-500">إدارة رواتب الموظفين والخصومات المبنية على الحضور ومسيرات الرواتب.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-40 text-center" />
          {canRunPayroll && (
            <>
              <Button variant="outline" onClick={handleExportPayroll}><Download className="w-4 h-4 ml-2" /> تصدير PDF</Button>
              {payrollRun?.status === "draft" && payslips.length > 0 && (
                <Button variant="outline" onClick={handleApproveRun} disabled={generating}>
                  <CheckCircle className="w-4 h-4 ml-2" /> اعتماد المسير بالكامل
                </Button>
              )}
              <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleRunPayroll} disabled={generating || Boolean(payrollRun && payrollRun.status !== "draft")}>
                <Calculator className="w-4 h-4 ml-2" /> {generating ? "جار الحساب..." : "تشغيل رواتب الشهر"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">صافي الرواتب الإجمالي</p>
            <p className="text-xl font-semibold text-green-600">{formatCurrency(totalNet)}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">إجمالي الخصومات</p>
            <p className="text-xl font-semibold text-red-600">{formatCurrency(totalDeductions)}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500">التأمينات (صاحب العمل)</p>
            <p className="text-xl font-semibold text-amber-600">{formatCurrency(totalEmployerGosi)}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="py-4">
              <p className="text-xs text-gray-500">المعتمدون / الإجمالي</p>
              <p className="text-xl font-semibold text-blue-600">{approvedCount} / {payslips.length}</p>
              {payrollRun && <p className="mt-1 text-xs text-gray-400">المسير: {statusLabels[payrollRun.status] || payrollRun.status} · {payrollRun.formula_version}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Accounting status bar */}
      {canViewAccountingStatus && (
        <Card className="border-none shadow-sm">
          <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs text-gray-500">الحالة المحاسبية للرواتب</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={accountingStatusColors[accountingStatus?.status || "not_generated"] || "bg-gray-50 text-gray-700 border-gray-200"}>
                  {accountingStatusLabels[accountingStatus?.status || "not_generated"] || accountingStatus?.status || "not_generated"}
                </Badge>
                {accountingStatus?.journal_entry_no && <span className="text-sm text-gray-600">قيد: {accountingStatus.journal_entry_no}</span>}
                {accountingStatus?.payment_no && <span className="text-sm text-gray-600">دفعة: {accountingStatus.payment_no}</span>}
                {Number(accountingStatus?.advance_deductions || 0) > 0 && <span className="text-sm text-gray-600">خصومات السلف: {formatCurrency(accountingStatus?.advance_deductions)}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {accountingStatus?.journal_entry_id && (
                <Button asChild variant="outline" size="sm"><Link href={`/accounting/journal-entries/${accountingStatus.journal_entry_id}`}>عرض قيد الرواتب</Link></Button>
              )}
              {accountingStatus?.payment_journal_entry_id && (
                <Button asChild variant="outline" size="sm"><Link href={`/accounting/journal-entries/${accountingStatus.payment_journal_entry_id}`}>عرض قيد السداد</Link></Button>
              )}
              {canGenerateAccountingDraft && payrollRun?.status === "approved" && accountingStatus?.status === "not_generated" && Number(accountingStatus?.payslip_count || 0) > 0 && (
                <Button variant="outline" size="sm" onClick={handleGenerateAccountingDraft} disabled={accountingBusy}>إنشاء مسودة محاسبية</Button>
              )}
              {canPostPayrollAccounting && accountingStatus?.status === "draft_created" && (
                <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={handlePostAccountingJournal} disabled={accountingBusy}>ترحيل قيد الرواتب</Button>
              )}
              {canPostPayrollAccounting && accountingStatus?.status === "posted" && (
                <Button variant="outline" size="sm" onClick={handleRecordPayrollPayment} disabled={accountingBusy}>تسجيل سداد الرواتب</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payroll table */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            <CardTitle>{monthLabel} — مسيرات الرواتب</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">جار تحميل بيانات الرواتب...</div>
          ) : payslips.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">لم يتم إنشاء مسيرات لهذا الشهر. شغّل الرواتب للبدء.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الراتب الأساسي</TableHead>
                  <TableHead>الحضور</TableHead>
                  <TableHead>خصم التأخر</TableHead>
                  <TableHead>خصم الغياب</TableHead>
                  <TableHead>تسويات</TableHead>
                  <TableHead>صافي الراتب</TableHead>
                  <TableHead>الحالة</TableHead>
                  {canRunPayroll && <TableHead className="text-right">الإجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((slip) => {
                  const employee = (slip.employee ?? {}) as Record<string, unknown>;
                  const status = String(slip.status || "draft");
                  const slipId = String(slip.id);
                  const isExpanded = expandedRows.has(slipId);
                  const isFrozen = status !== "draft";
                  const isRecalculating = recalculating === slipId;
                  const adjustments = Array.isArray(slip.manual_adjustments) ? (slip.manual_adjustments as ManualAdjustment[]) : [];
                  const manualTotal = Number(slip.manual_adjustments_total || 0);

                  return (
                    <React.Fragment key={slipId}>
                      <TableRow className="hover:bg-gray-50/50">
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleRow(slipId)}>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          <p>{String(employee.full_name || "غير معروف")}</p>
                          <p className="text-xs text-gray-400">{String(employee.employee_code || "")}</p>
                          {Boolean(slip.snapshot_group_name) && (
                            <p className="text-xs text-blue-500">{String(slip.snapshot_group_name)}</p>
                          )}
                        </TableCell>
                        <TableCell>{formatCurrency(slip.base_salary)}</TableCell>
                        <TableCell>
                          <span className="text-sm">{Number(slip.attendance_days || 0)} يوم</span>
                          {(Number(slip.late_minutes || 0) > 0) && (
                            <p className="text-xs text-amber-600">{Number(slip.late_minutes)} د. تأخر</p>
                          )}
                        </TableCell>
                        <TableCell className="text-amber-600">{Number(slip.late_deduction || 0) > 0 ? `-${formatCurrency(slip.late_deduction)}` : "—"}</TableCell>
                        <TableCell>
                          {Number(slip.unapproved_absent_days || 0) > 0 && (
                            <p className="text-xs text-red-600 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />{Number(slip.unapproved_absent_days)} غير مبرر
                            </p>
                          )}
                          {Number(slip.approved_absent_days || 0) > 0 && (
                            <p className="text-xs text-gray-500">{Number(slip.approved_absent_days)} معتمد</p>
                          )}
                          {Number(slip.absence_deduction || 0) > 0 ? (
                            <p className="text-sm text-red-600">-{formatCurrency(slip.absence_deduction)}</p>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {manualTotal !== 0 ? (
                            <span className={manualTotal > 0 ? "text-green-600 text-sm" : "text-red-600 text-sm"}>
                              {manualTotal > 0 ? "+" : ""}{formatCurrency(manualTotal)}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="font-bold text-green-600">{formatCurrency(slip.net_salary)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[status] || "bg-gray-50 text-gray-700"}>
                            {statusLabels[status] || status}
                          </Badge>
                        </TableCell>
                        {canRunPayroll && (
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end flex-wrap">
                              {!isFrozen && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500" title="إعادة الحساب"
                                  onClick={() => handleRecalculate(slip)} disabled={isRecalculating}>
                                  <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? "animate-spin" : ""}`} />
                                </Button>
                              )}
                              {!isFrozen && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500" title="إضافة تسوية"
                                  onClick={() => openAdjustDialog(slip)}>
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {isFrozen && <span className="text-xs text-gray-400">مقفل ضمن المسير</span>}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>

                      {/* Expanded breakdown row */}
                      {isExpanded && (
                        <TableRow className="bg-gray-50/30 hover:bg-gray-50/30">
                          <TableCell />
                          <TableCell colSpan={canRunPayroll ? 9 : 8} className="py-3">
                            <div className="grid md:grid-cols-2 gap-4 text-sm">
                              {/* Policy snapshot */}
                              {Boolean(slip.snapshot_group_name) && (
                                <div className="space-y-1">
                                  <p className="font-semibold text-gray-600 text-xs uppercase tracking-wide">سياسة الخصم المطبقة</p>
                                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5 space-y-1 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-600">المجموعة</span><span className="font-medium">{String(slip.snapshot_group_name)}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">مهلة التأخر</span><span>{Number(slip.snapshot_late_grace_minutes || 0)} دقيقة</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">خصم التأخر / ساعة</span><span>{formatCurrency(slip.snapshot_deduction_per_late_hour)}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">أيام غياب مسموحة</span><span>{Number(slip.snapshot_allowed_absent_days || 0)} يوم</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">خصم غياب غير مبرر</span><span>{formatCurrency(slip.snapshot_deduction_per_absent_day)} / يوم</span></div>
                                    <div className="flex justify-between"><span className="text-gray-600">خصم تجاوز الإجازة</span><span>{formatCurrency(slip.snapshot_deduction_per_excess_approved_day)} / يوم</span></div>
                                  </div>
                                </div>
                              )}

                              {/* Manual adjustments */}
                              <div className="space-y-1">
                                <p className="font-semibold text-gray-600 text-xs uppercase tracking-wide">التسويات اليدوية</p>
                                {adjustments.length === 0 ? (
                                  <p className="text-xs text-gray-400 py-2">لا توجد تسويات يدوية.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {adjustments.map((adj) => (
                                      <div key={adj.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-xs gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <Badge variant="outline" className={adj.type === "bonus" ? "bg-green-50 text-green-700 border-green-200 text-xs" : "bg-red-50 text-red-700 border-red-200 text-xs"}>
                                            {adj.type === "bonus" ? "مكافأة" : "خصم"}
                                          </Badge>
                                          <span className="font-medium">{formatCurrency(adj.amount)}</span>
                                          <span className="text-gray-500 truncate">{adj.reason}</span>
                                        </div>
                                        {!isFrozen && canRunPayroll && (
                                          <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                                            onClick={() => handleRemoveAdjustment(slipId, adj.id)}>
                                            <Trash2 className="w-3 h-3" />
                                          </Button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* GOSI + notes footer */}
                            <div className="mt-3 pt-2 border-t border-gray-100 flex flex-wrap gap-4 text-xs text-gray-500">
                              <span>تأمينات الموظف: <strong>{formatCurrency(slip.employee_gosi)}</strong></span>
                              <span>تأمينات صاحب العمل: <strong>{formatCurrency(slip.employer_gosi)}</strong></span>
                              {Boolean(slip.payroll_notes) && <span className="text-gray-400">{String(slip.payroll_notes)}</span>}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
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
