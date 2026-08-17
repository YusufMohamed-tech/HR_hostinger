"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountingPageHeader, AccountingLoading, AccountingEmptyState } from "@/components/accounting/AccountingPrimitives";
import { getJournalTypes, saveJournalType, deactivateJournalType, type JournalType } from "@/lib/services/accounting";

const SEQUENCE_LABELS: Record<string, string> = { never: "بدون إعادة تعيين", yearly: "سنوي", monthly: "شهري" };
const FORMAT_TOKENS = ["{PREFIX}", "{YYYY}", "{YY}", "{MM}", "{DD}", "{SEQ}"];

function previewNumber(format: string, prefix: string): string {
  const now = new Date();
  let result = format;
  result = result.replace("{PREFIX}", prefix || "JV");
  result = result.replace("{YYYY}", String(now.getFullYear()));
  result = result.replace("{YY}", String(now.getFullYear() % 100).padStart(2, "0"));
  result = result.replace("{MM}", String(now.getMonth() + 1).padStart(2, "0"));
  result = result.replace("{DD}", String(now.getDate()).padStart(2, "0"));
  result = result.replace("{SEQ}", "0001");
  return result;
}

export default function JournalTypesPage() {
  const [types, setTypes] = useState<JournalType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name_ar: "",
    name_en: "",
    prefix: "",
    number_format: "{PREFIX}-{YYYY}{MM}-{SEQ}",
    sequence_reset: "monthly",
    requires_approval: false,
    auto_post: false,
    is_default: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJournalTypes();
    setTypes(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditId(null);
    setForm({ code: "", name_ar: "", name_en: "", prefix: "", number_format: "{PREFIX}-{YYYY}{MM}-{SEQ}", sequence_reset: "monthly", requires_approval: false, auto_post: false, is_default: false });
    setDialogOpen(true);
  };

  const openEdit = (jt: JournalType) => {
    setEditId(jt.id);
    setForm({
      code: jt.code,
      name_ar: jt.name_ar,
      name_en: jt.name_en || "",
      prefix: jt.prefix,
      number_format: jt.number_format,
      sequence_reset: jt.sequence_reset,
      requires_approval: jt.requires_approval,
      auto_post: jt.auto_post,
      is_default: jt.is_default,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const r = await saveJournalType(form, editId || undefined);
    if (!r.error) {
      setDialogOpen(false);
      load();
    }
  };

  const deactivate = async (id: string) => {
    await deactivateJournalType(id);
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="أنواع القيود"
        description="إعداد أنواع القيود (عام، مبيعات، مشتريات...) مع ترقيم مستقل لكل نوع."
        actions={
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={openNew}>
            <Plus className="ml-2 h-4 w-4" />نوع جديد
          </Button>
        }
      />

      {types.length === 0 ? (
        <AccountingEmptyState title="لا توجد أنواع قيود" description="أنشئ نوعا جديدا لبدء استخدام الترقيم المستقل." />
      ) : (
        <Card className="border-none shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرمز</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>البادئة</TableHead>
                  <TableHead>صيغة الترقيم</TableHead>
                  <TableHead>إعادة التعيين</TableHead>
                  <TableHead>التسلسل الحالي</TableHead>
                  <TableHead>افتراضي</TableHead>
                  <TableHead className="text-left">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((jt) => (
                  <TableRow key={jt.id} className={jt.is_active ? "" : "opacity-50"}>
                    <TableCell className="font-mono">{jt.code}</TableCell>
                    <TableCell>{jt.name_ar}</TableCell>
                    <TableCell className="font-mono">{jt.prefix}</TableCell>
                    <TableCell className="text-xs text-gray-500">{previewNumber(jt.number_format, jt.prefix)}</TableCell>
                    <TableCell>{SEQUENCE_LABELS[jt.sequence_reset]}</TableCell>
                    <TableCell>{jt.current_sequence}</TableCell>
                    <TableCell>{jt.is_default ? "✓" : ""}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(jt)}>تعديل</Button>
                        {jt.is_active && !jt.is_default && (
                          <Button variant="outline" size="sm" onClick={() => deactivate(jt.id)}>تعطيل</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "تعديل نوع القيد" : "نوع قيد جديد"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>الرمز</Label>
                <Input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="GJ" />
              </div>
              <div className="space-y-2">
                <Label>البادئة</Label>
                <Input value={form.prefix} onChange={(e) => setForm((p) => ({ ...p, prefix: e.target.value.toUpperCase() }))} placeholder="JV" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>الاسم (عربي)</Label>
              <Input value={form.name_ar} onChange={(e) => setForm((p) => ({ ...p, name_ar: e.target.value }))} placeholder="قيد يومية عام" />
            </div>
            <div className="space-y-2">
              <Label>الاسم (إنجليزي)</Label>
              <Input value={form.name_en} onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))} placeholder="General Journal" />
            </div>
            <div className="space-y-2">
              <Label>صيغة الترقيم</Label>
              <Input value={form.number_format} onChange={(e) => setForm((p) => ({ ...p, number_format: e.target.value }))} />
              <div className="flex flex-wrap gap-1">
                {FORMAT_TOKENS.map((token) => (
                  <button key={token} type="button" onClick={() => setForm((p) => ({ ...p, number_format: p.number_format + token }))} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">{token}</button>
                ))}
              </div>
              <p className="text-xs text-gray-400">معاينة: {previewNumber(form.number_format, form.prefix)}</p>
            </div>
            <div className="space-y-2">
              <Label>إعادة تعيين التسلسل</Label>
              <select value={form.sequence_reset} onChange={(e) => setForm((p) => ({ ...p, sequence_reset: e.target.value }))} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">
                <option value="monthly">شهري</option>
                <option value="yearly">سنوي</option>
                <option value="never">بدون إعادة تعيين</option>
              </select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.requires_approval} onChange={(e) => setForm((p) => ({ ...p, requires_approval: e.target.checked }))} />
                يتطلب اعتماد
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
                افتراضي
              </label>
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
