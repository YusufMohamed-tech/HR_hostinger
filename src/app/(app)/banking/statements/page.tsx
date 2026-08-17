"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Archive, FileUp, Pencil, RotateCcw, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountingPageHeader, AccountingLoading, AccountingEmptyState, AccountingStatusBadge, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { useRoleContext } from "@/providers/RoleProvider";
import { getBankStatementActionCapabilities } from "@/lib/banking/statement-actions";
import {
  getBankAccounts,
  getBankStatement,
  getBankStatements,
  getStatementLines,
  importStatement,
  autoMatchStatement,
  unmatchLine,
  excludeLine,
  updateBankStatement,
  recallBankStatement,
  cancelBankStatement,
  submitStatement,
  approveStatement,
  archiveStatement,
  type BankAccount,
  type BankStatement,
  type StatementLine,
} from "@/lib/services/banking";

function parseCSVLines(csvText: string): Array<Record<string, unknown>> {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, unknown> = {};
    headers.forEach((header, i) => { row[header] = values[i]?.trim() || ""; });
    row.transaction_date = row.date || row.transaction_date || row.value_date || "";
    row.amount = Number(row.amount || row.debit || 0) - Number(row.credit || 0);
    row.description = row.description || row.narrative || row.details || "";
    row.reference = row.reference || row.ref || row.check_no || "";
    return row;
  });
}

export default function StatementsPage() {
  const { currentUser } = useRoleContext();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<BankStatement | null>(null);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ bank_account_id: "", statement_date: "", period_start: "", period_end: "", opening_balance: "0", closing_balance: "0" });
  const [csvData, setCsvData] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");
  const [editStatement, setEditStatement] = useState<BankStatement | null>(null);
  const [editForm, setEditForm] = useState({ bank_account_id: "", statement_date: "", period_start: "", period_end: "", opening_balance: "0", closing_balance: "0", file_name: "" });
  const [lifecycleAction, setLifecycleAction] = useState<"recall" | "cancel" | null>(null);
  const [actionStatement, setActionStatement] = useState<BankStatement | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const role = currentUser?.orgMembershipRole || currentUser?.role || "";
  const canManage = ["finance_manager", "accountant"].includes(String(role).toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    const [a, s] = await Promise.all([getBankAccounts(), getBankStatements()]);
    setBankAccounts((a.data || []).filter((acc) => acc.is_active));
    setStatements(s.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openStatement = async (stmt: BankStatement) => {
    const [statementResult, linesResult] = await Promise.all([
      getBankStatement(stmt.id),
      getStatementLines(stmt.id),
    ]);
    if (statementResult.error || linesResult.error || !statementResult.data) {
      setMessage(statementResult.error || linesResult.error || "تعذر تحديث كشف الحساب.");
      return;
    }
    setSelectedStatement(statementResult.data);
    setLines(linesResult.data || []);
  };

  const openEdit = (statement: BankStatement) => {
    setEditStatement(statement);
    setEditForm({
      bank_account_id: statement.bank_account_id,
      statement_date: statement.statement_date,
      period_start: statement.period_start,
      period_end: statement.period_end,
      opening_balance: String(statement.opening_balance),
      closing_balance: String(statement.closing_balance),
      file_name: statement.file_name || "",
    });
  };

  const submitEdit = async () => {
    if (!editStatement) return;
    setActionLoading(true);
    const result = await updateBankStatement(editStatement.id, editStatement.version, {
      ...editForm,
      opening_balance: Number(editForm.opening_balance),
      closing_balance: Number(editForm.closing_balance),
      file_name: editForm.file_name || null,
    });
    setActionLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setEditStatement(null);
    await load();
  };

  const openLifecycle = (statement: BankStatement, action: "recall" | "cancel") => {
    setActionStatement(statement);
    setLifecycleAction(action);
    setActionReason("");
  };

  const submitLifecycle = async () => {
    if (!actionStatement || !lifecycleAction || !actionReason.trim()) return;
    setActionLoading(true);
    const result = lifecycleAction === "recall"
      ? await recallBankStatement(actionStatement.id, actionStatement.version, actionReason)
      : await cancelBankStatement(actionStatement.id, actionStatement.version, actionReason);
    setActionLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setLifecycleAction(null);
    setActionStatement(null);
    await load();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSVLines(text);
      setCsvData(parsed);
    };
    reader.readAsText(file);
  };

  const submitImport = async () => {
    if (!importForm.bank_account_id || csvData.length === 0) return;
    const r = await importStatement({
      ...importForm,
      opening_balance: Number(importForm.opening_balance || 0),
      closing_balance: Number(importForm.closing_balance || 0),
      lines: csvData,
      import_format: "csv",
    });
    if (!r.error) { setImportOpen(false); setCsvData([]); load(); }
  };

  const handleAutoMatch = async () => {
    if (!selectedStatement) return;
    const result = await autoMatchStatement(selectedStatement.id);
    if (result.error) setMessage(result.error);
    else await openStatement(selectedStatement);
  };

  const handleExclude = async (lineId: string) => {
    if (!selectedStatement) return;
    const result = await excludeLine(selectedStatement.id, lineId);
    if (result.error) setMessage(result.error);
    else await openStatement(selectedStatement);
  };

  const handleUnmatch = async (lineId: string) => {
    if (!selectedStatement) return;
    const result = await unmatchLine(selectedStatement.id, lineId);
    if (result.error) setMessage(result.error);
    else await openStatement(selectedStatement);
  };

  if (loading) return <AccountingLoading />;

  if (selectedStatement) {
    const unmatchedCount = lines.filter((l) => l.match_status === "unmatched").length;
    const matchedCount = lines.filter((l) => ["matched", "manually_matched"].includes(l.match_status)).length;
    return (
      <div className="space-y-6">
        <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
        <AccountingPageHeader
          title={`كشف ${selectedStatement.statement_date}`}
          description={`${selectedStatement.bank_account?.bank_name} - ${selectedStatement.bank_account?.name_ar}`}
          actions={<>
            <Button variant="outline" onClick={() => { setSelectedStatement(null); setLines([]); }}>رجوع</Button>
            {canManage ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleAutoMatch}><Wand2 className="ml-2 h-4 w-4" />مطابقة تلقائية</Button> : null}
          </>}
        />
        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="border-none shadow-sm"><CardContent className="p-4 text-center"><p className="text-xs text-gray-500">إجمالي العمليات</p><p className="text-lg font-bold">{lines.length}</p></CardContent></Card>
          <Card className="border-none shadow-sm"><CardContent className="p-4 text-center"><p className="text-xs text-gray-500">تمت المطابقة</p><p className="text-lg font-bold text-green-600">{matchedCount}</p></CardContent></Card>
          <Card className="border-none shadow-sm"><CardContent className="p-4 text-center"><p className="text-xs text-gray-500">غير مطابق</p><p className="text-lg font-bold text-amber-600">{unmatchedCount}</p></CardContent></Card>
          <Card className="border-none shadow-sm"><CardContent className="p-4 text-center"><p className="text-xs text-gray-500">الرصيد الختامي</p><p className="text-lg font-bold"><MoneyAmount value={selectedStatement.closing_balance} /></p></CardContent></Card>
        </div>
        <Card className="border-none shadow-sm"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الوصف</TableHead>
              <TableHead>المرجع</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-left">الإجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id} className={line.match_status === "excluded" ? "opacity-40" : ""}>
                  <TableCell className="text-sm">{line.transaction_date}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">{line.description}</TableCell>
                  <TableCell className="font-mono text-xs">{line.reference || "—"}</TableCell>
                  <TableCell className={Number(line.amount) >= 0 ? "text-green-700" : "text-red-700"}>
                    <MoneyAmount value={line.amount} />
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      line.match_status === "unmatched" ? "bg-amber-100 text-amber-700" :
                      line.match_status === "excluded" ? "bg-gray-100 text-gray-500" :
                      "bg-green-100 text-green-700"
                    }`}>
                      {line.match_status === "unmatched" ? "غير مطابق" : line.match_status === "excluded" ? "مستثنى" : "مطابق"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canManage && ["matched", "manually_matched"].includes(line.match_status) && (
                        <Button variant="ghost" size="sm" onClick={() => handleUnmatch(line.id)}>إلغاء</Button>
                      )}
                      {canManage && line.match_status === "unmatched" && (
                        <Button variant="ghost" size="sm" onClick={() => handleExclude(line.id)}>استثناء</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <AccountingPageHeader title="كشوف الحساب" description="استيراد كشوف البنك ومطابقتها مع قيود النظام" actions={
        canManage ? <Button className="bg-brand text-white hover:bg-brand-dark" onClick={() => setImportOpen(true)}><FileUp className="ml-2 h-4 w-4" />استيراد كشف</Button> : null
      } />

      {statements.length === 0 ? (
        <AccountingEmptyState title="لا توجد كشوف مستوردة" description="استورد كشف حساب بنكي لبدء المطابقة." />
      ) : (
        <Card className="border-none shadow-sm"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>تاريخ الكشف</TableHead>
              <TableHead>الحساب البنكي</TableHead>
              <TableHead>عدد العمليات</TableHead>
              <TableHead>المطابقة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-left">الإجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {statements.map((stmt) => (
                <TableRow key={stmt.id}>
                  <TableCell>{stmt.statement_date}</TableCell>
                  <TableCell>{stmt.bank_account?.name_ar} ({stmt.bank_account?.bank_name})</TableCell>
                  <TableCell>{stmt.transaction_count}</TableCell>
                  <TableCell>{stmt.matched_count}/{stmt.transaction_count}</TableCell>
                  <TableCell><AccountingStatusBadge status={stmt.status} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openStatement(stmt)}>عرض</Button>
                      {getBankStatementActionCapabilities(stmt, role).canEdit ? (
                        <Button variant="ghost" size="sm" aria-label="تعديل الكشف" onClick={() => openEdit(stmt)}><Pencil className="h-4 w-4" /></Button>
                      ) : null}
                      {getBankStatementActionCapabilities(stmt, role).canSubmit ? (
                        <Button variant="ghost" size="sm" className="text-blue-700 hover:bg-blue-50" aria-label="إرسال للمراجعة" onClick={async () => { const r = await submitStatement(stmt.id); if (r.error) setMessage(r.error); else load(); }}><Send className="h-4 w-4" /></Button>
                      ) : null}
                      {getBankStatementActionCapabilities(stmt, role).canRecall ? (
                        <Button variant="ghost" size="sm" aria-label="استرجاع الكشف" onClick={() => openLifecycle(stmt, "recall")}><RotateCcw className="h-4 w-4" /></Button>
                      ) : null}
                      {getBankStatementActionCapabilities(stmt, role).canCancel ? (
                        <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" aria-label="إلغاء الكشف" onClick={() => openLifecycle(stmt, "cancel")}><Archive className="h-4 w-4" /></Button>
                      ) : null}
                      {String(role).toLowerCase() === "finance_manager" && stmt.status === "in_progress" ? (
                        <Button variant="ghost" size="sm" className="text-green-700 hover:bg-green-50" aria-label="اعتماد الكشف" onClick={async () => { const r = await approveStatement(stmt.id); if (r.error) setMessage(r.error); else load(); }}>اعتماد</Button>
                      ) : null}
                      {String(role).toLowerCase() === "finance_manager" && stmt.status === "approved" ? (
                        <Button variant="ghost" size="sm" className="text-gray-600 hover:bg-gray-100" aria-label="أرشفة الكشف" onClick={async () => { const r = await archiveStatement(stmt.id); if (r.error) setMessage(r.error); else load(); }}>أرشفة</Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>استيراد كشف حساب</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>الحساب البنكي</Label>
              <select value={importForm.bank_account_id} onChange={(e) => setImportForm((p) => ({ ...p, bank_account_id: e.target.value }))} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="">اختر الحساب</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name_ar} - {a.bank_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>تاريخ الكشف</Label><Input type="date" value={importForm.statement_date} onChange={(e) => setImportForm((p) => ({ ...p, statement_date: e.target.value }))} /></div>
              <div className="space-y-2"><Label>من</Label><Input type="date" value={importForm.period_start} onChange={(e) => setImportForm((p) => ({ ...p, period_start: e.target.value }))} /></div>
              <div className="space-y-2"><Label>إلى</Label><Input type="date" value={importForm.period_end} onChange={(e) => setImportForm((p) => ({ ...p, period_end: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>الرصيد الافتتاحي</Label><Input type="number" value={importForm.opening_balance} onChange={(e) => setImportForm((p) => ({ ...p, opening_balance: e.target.value }))} /></div>
              <div className="space-y-2"><Label>الرصيد الختامي</Label><Input type="number" value={importForm.closing_balance} onChange={(e) => setImportForm((p) => ({ ...p, closing_balance: e.target.value }))} /></div>
            </div>
            <div className="space-y-2">
              <Label>ملف CSV</Label>
              <Input type="file" accept=".csv" onChange={handleFileUpload} />
              {csvData.length > 0 && <p className="text-xs text-green-600">تم قراءة {csvData.length} عملية من الملف</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>إلغاء</Button>
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={submitImport} disabled={!importForm.bank_account_id || csvData.length === 0}>استيراد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editStatement)} onOpenChange={(open) => !open && setEditStatement(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>تعديل بيانات كشف الحساب</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>الحساب البنكي</Label>
              <select value={editForm.bank_account_id} onChange={(event) => setEditForm((previous) => ({ ...previous, bank_account_id: event.target.value }))} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="">اختر الحساب</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name_ar} - {account.bank_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>تاريخ الكشف</Label><Input type="date" value={editForm.statement_date} onChange={(event) => setEditForm((previous) => ({ ...previous, statement_date: event.target.value }))} /></div>
              <div className="space-y-2"><Label>من</Label><Input type="date" value={editForm.period_start} onChange={(event) => setEditForm((previous) => ({ ...previous, period_start: event.target.value }))} /></div>
              <div className="space-y-2"><Label>إلى</Label><Input type="date" value={editForm.period_end} onChange={(event) => setEditForm((previous) => ({ ...previous, period_end: event.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>الرصيد الافتتاحي</Label><Input type="number" value={editForm.opening_balance} onChange={(event) => setEditForm((previous) => ({ ...previous, opening_balance: event.target.value }))} /></div>
              <div className="space-y-2"><Label>الرصيد الختامي</Label><Input type="number" value={editForm.closing_balance} onChange={(event) => setEditForm((previous) => ({ ...previous, closing_balance: event.target.value }))} /></div>
            </div>
            <div className="space-y-2"><Label>اسم الملف</Label><Input value={editForm.file_name} onChange={(event) => setEditForm((previous) => ({ ...previous, file_name: event.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStatement(null)} disabled={actionLoading}>إلغاء</Button>
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={submitEdit} disabled={actionLoading}>{actionLoading ? "جاري الحفظ..." : "حفظ التعديل"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lifecycleAction)} onOpenChange={(open) => !open && setLifecycleAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{lifecycleAction === "recall" ? "استرجاع كشف الحساب" : "حذف كشف الحساب"}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-4">
            <p className="text-sm text-gray-600">{lifecycleAction === "recall" ? "سيتم إلغاء كل المطابقات والاستثناءات وإعادة الكشف إلى حالة مستورد." : "سيتم إخفاء الكشف مع الاحتفاظ بالملف والعمليات وسجل التدقيق."}</p>
            <Label htmlFor="statement-action-reason">السبب *</Label>
            <Input id="statement-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="اكتب سبب الإجراء" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLifecycleAction(null)} disabled={actionLoading}>إلغاء</Button>
            <Button className={lifecycleAction === "cancel" ? "bg-red-600 text-white hover:bg-red-700" : "bg-brand text-white hover:bg-brand-dark"} onClick={submitLifecycle} disabled={actionLoading || !actionReason.trim()}>{actionLoading ? "جاري التنفيذ..." : "تأكيد"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
