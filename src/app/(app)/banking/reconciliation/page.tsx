"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountingPageHeader, AccountingLoading, AccountingEmptyState, AccountingStatusBadge, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import {
  getBankAccounts,
  getReconciliations,
  saveReconciliation,
  completeReconciliation,
  approveReconciliation,
  type BankAccount,
  type BankReconciliation,
} from "@/lib/services/banking";

export default function ReconciliationPage() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ bank_account_id: "", reconciliation_date: "", statement_balance: "0", ledger_balance: "0", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [a, r] = await Promise.all([getBankAccounts(), getReconciliations()]);
    setBankAccounts((a.data || []).filter((acc) => acc.is_active));
    setReconciliations(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm({ bank_account_id: "", reconciliation_date: new Date().toISOString().slice(0, 10), statement_balance: "0", ledger_balance: "0", notes: "" });
    setDialogOpen(true);
  };

  const save = async () => {
    const r = await saveReconciliation({
      ...form,
      statement_balance: Number(form.statement_balance || 0),
      ledger_balance: Number(form.ledger_balance || 0),
    });
    if (!r.error) { setDialogOpen(false); load(); }
  };

  const complete = async (id: string) => {
    await completeReconciliation(id);
    load();
  };

  const approve = async (id: string) => {
    await approveReconciliation(id);
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-6">
      <AccountingPageHeader title="المطابقة البنكية" description="إعداد واعتماد تقارير مطابقة الحسابات البنكية" actions={
        <Button className="bg-brand text-white hover:bg-brand-dark" onClick={openNew}><Plus className="ml-2 h-4 w-4" />مطابقة جديدة</Button>
      } />

      {reconciliations.length === 0 ? (
        <AccountingEmptyState title="لا توجد عمليات مطابقة" description="أنشئ مطابقة بنكية جديدة لمقارنة رصيد الكشف مع رصيد الأستاذ." />
      ) : (
        <Card className="border-none shadow-sm"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الحساب البنكي</TableHead>
              <TableHead>رصيد الكشف</TableHead>
              <TableHead>رصيد الأستاذ</TableHead>
              <TableHead>الفرق</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-left">الإجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {reconciliations.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell>{rec.reconciliation_date}</TableCell>
                  <TableCell>{rec.bank_account?.name_ar} ({rec.bank_account?.bank_name})</TableCell>
                  <TableCell><MoneyAmount value={rec.statement_balance} /></TableCell>
                  <TableCell><MoneyAmount value={rec.ledger_balance} /></TableCell>
                  <TableCell className={rec.difference === 0 ? "text-green-700" : "text-red-700"}>
                    <MoneyAmount value={rec.difference} />
                  </TableCell>
                  <TableCell><AccountingStatusBadge status={rec.status} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {rec.status === "draft" && (
                        <Button size="sm" variant="outline" onClick={() => complete(rec.id)}>
                          <CheckCircle className="ml-1 h-4 w-4" />إكمال
                        </Button>
                      )}
                      {rec.status === "completed" && (
                        <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => approve(rec.id)}>اعتماد</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>مطابقة بنكية جديدة</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>الحساب البنكي</Label>
              <select value={form.bank_account_id} onChange={(e) => setForm((p) => ({ ...p, bank_account_id: e.target.value }))} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="">اختر الحساب</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name_ar} - {a.bank_name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>تاريخ المطابقة</Label>
              <Input type="date" value={form.reconciliation_date} onChange={(e) => setForm((p) => ({ ...p, reconciliation_date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>رصيد كشف البنك</Label><Input type="number" value={form.statement_balance} onChange={(e) => setForm((p) => ({ ...p, statement_balance: e.target.value }))} /></div>
              <div className="space-y-2"><Label>رصيد دفتر الأستاذ</Label><Input type="number" value={form.ledger_balance} onChange={(e) => setForm((p) => ({ ...p, ledger_balance: e.target.value }))} /></div>
            </div>
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            {form.statement_balance && form.ledger_balance && (
              <div className={`rounded-lg p-3 text-center text-sm ${Number(form.statement_balance) === Number(form.ledger_balance) ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                الفرق: <MoneyAmount value={Number(form.statement_balance || 0) - Number(form.ledger_balance || 0)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
