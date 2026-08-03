"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountingPageHeader, AccountingLoading, AccountingEmptyState, MoneyAmount } from "@/components/accounting/AccountingPrimitives";
import { getBankAccounts, saveBankAccount, deactivateBankAccount, type BankAccount } from "@/lib/services/banking";
import { getAccountingAccounts } from "@/lib/services/accounting";
import type { AccountingAccount } from "@/types/accounting";

export default function BankAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<AccountingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name_ar: "", name_en: "", bank_name: "", account_number: "", iban: "", swift_code: "",
    currency: "SAR", linked_account_id: "", opening_balance: "0", opening_balance_date: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [r, la] = await Promise.all([getBankAccounts(), getAccountingAccounts()]);
    setAccounts(r.data || []);
    setLedgerAccounts((la.data || []).filter((a) => a.is_active && a.type === "asset"));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditId(null);
    setForm({ name_ar: "", name_en: "", bank_name: "", account_number: "", iban: "", swift_code: "", currency: "SAR", linked_account_id: "", opening_balance: "0", opening_balance_date: "" });
    setDialogOpen(true);
  };

  const openEdit = (acc: BankAccount) => {
    setEditId(acc.id);
    setForm({
      name_ar: acc.name_ar, name_en: acc.name_en || "", bank_name: acc.bank_name,
      account_number: acc.account_number, iban: acc.iban || "", swift_code: acc.swift_code || "",
      currency: acc.currency, linked_account_id: acc.linked_account_id || "",
      opening_balance: String(acc.opening_balance), opening_balance_date: acc.opening_balance_date || "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const r = await saveBankAccount({ ...form, opening_balance: Number(form.opening_balance || 0) }, editId || undefined);
    if (!r.error) { setDialogOpen(false); load(); }
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-6">
      <AccountingPageHeader title="الحسابات البنكية" description="إدارة الحسابات البنكية للمنشأة" actions={
        <Button className="bg-brand text-white hover:bg-brand-dark" onClick={openNew}><Plus className="ml-2 h-4 w-4" />حساب جديد</Button>
      } />

      {accounts.length === 0 ? (
        <AccountingEmptyState title="لا توجد حسابات بنكية" description="أنشئ حسابا بنكيا لبدء استيراد الكشوف." />
      ) : (
        <Card className="border-none shadow-sm"><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>اسم الحساب</TableHead>
              <TableHead>البنك</TableHead>
              <TableHead>رقم الحساب</TableHead>
              <TableHead>IBAN</TableHead>
              <TableHead>العملة</TableHead>
              <TableHead>الرصيد الافتتاحي</TableHead>
              <TableHead className="text-left">الإجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id} className={acc.is_active ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{acc.name_ar}</TableCell>
                  <TableCell>{acc.bank_name}</TableCell>
                  <TableCell className="font-mono text-sm">{acc.account_number}</TableCell>
                  <TableCell className="font-mono text-xs">{acc.iban || "—"}</TableCell>
                  <TableCell>{acc.currency}</TableCell>
                  <TableCell><MoneyAmount value={acc.opening_balance} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(acc)}>تعديل</Button>
                      {acc.is_active && <Button variant="outline" size="sm" onClick={() => { deactivateBankAccount(acc.id).then(load); }}>تعطيل</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editId ? "تعديل حساب بنكي" : "حساب بنكي جديد"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>الاسم (عربي)</Label><Input value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} /></div>
              <div className="space-y-2"><Label>الاسم (إنجليزي)</Label><Input value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>اسم البنك</Label><Input value={form.bank_name} onChange={(e) => setForm((p) => ({ ...p, bank_name: e.target.value }))} /></div>
              <div className="space-y-2"><Label>رقم الحساب</Label><Input value={form.account_number} onChange={(e) => setForm((p) => ({ ...p, account_number: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>IBAN</Label><Input value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} /></div>
              <div className="space-y-2"><Label>SWIFT Code</Label><Input value={form.swift_code} onChange={(e) => setForm((p) => ({ ...p, swift_code: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>العملة</Label><Input value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} /></div>
              <div className="space-y-2">
                <Label>حساب الأستاذ المرتبط</Label>
                <select value={form.linked_account_id} onChange={(e) => setForm((p) => ({ ...p, linked_account_id: e.target.value }))} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                  <option value="">— اختياري —</option>
                  {ledgerAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>الرصيد الافتتاحي</Label><Input type="number" value={form.opening_balance} onChange={(e) => setForm((p) => ({ ...p, opening_balance: e.target.value }))} /></div>
              <div className="space-y-2"><Label>تاريخ الرصيد الافتتاحي</Label><Input type="date" value={form.opening_balance_date} onChange={(e) => setForm((p) => ({ ...p, opening_balance_date: e.target.value }))} /></div>
            </div>
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
