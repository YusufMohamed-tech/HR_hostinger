"use client";

import React, { useEffect, useState } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShieldAlert, Clock, Calendar, AlertTriangle } from "lucide-react";

type DeductionRuleGroup = {
  id: string;
  name: string;
  late_grace_minutes: number;
  deduction_per_late_hour: number;
  allowed_absent_days: number;
  deduction_per_absent_day: number;
  deduction_per_excess_approved_day: number;
};

const emptyForm = {
  name: "",
  late_grace_minutes: 0,
  deduction_per_late_hour: 0,
  allowed_absent_days: 0,
  deduction_per_absent_day: 0,
  deduction_per_excess_approved_day: 0,
};

const adminRoles = ["Admin", "HR_Admin"];

export default function DeductionRulesPage() {
  const { currentUser } = useRoleContext();
  const [groups, setGroups] = useState<DeductionRuleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeductionRuleGroup | null>(null);
  const [deleting, setDeleting] = useState<DeductionRuleGroup | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const isAdmin = adminRoles.includes(currentUser?.role || "");

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/deduction-rule-groups");
    const json = await res.json();
    setGroups(json.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (group: DeductionRuleGroup) => {
    setEditing(group);
    setForm({
      name: group.name,
      late_grace_minutes: group.late_grace_minutes,
      deduction_per_late_hour: group.deduction_per_late_hour,
      allowed_absent_days: group.allowed_absent_days,
      deduction_per_absent_day: group.deduction_per_absent_day,
      deduction_per_excess_approved_day: group.deduction_per_excess_approved_day,
    });
    setError("");
    setDialogOpen(true);
  };

  const openDelete = (group: DeductionRuleGroup) => {
    setDeleting(group);
    setDeleteError("");
    setDeleteDialogOpen(true);
  };

  const set = (key: string, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("اسم المجموعة مطلوب."); return; }
    setSubmitting(true);
    setError("");

    const url = editing ? `/api/deduction-rule-groups/${editing.id}` : "/api/deduction-rule-groups";
    const method = editing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) { setError(json.message || "حدث خطأ."); return; }

    await load();
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    setDeleteError("");

    const res = await fetch(`/api/deduction-rule-groups/${deleting.id}`, { method: "DELETE" });
    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) { setDeleteError(json.message || "فشل الحذف."); return; }

    await load();
    setDeleteDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مجموعات قواعد الخصم</h1>
          <p className="text-gray-500 text-sm mt-1">
            تحديد سياسات الخصم للتأخر والغياب وتخصيصها للموظفين.
          </p>
        </div>
        {isAdmin && (
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            مجموعة جديدة
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">جار التحميل...</div>
      ) : groups.length === 0 ? (
        <Card className="border-none shadow-sm">
          <CardContent className="py-16 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">لا توجد مجموعات خصم بعد.</p>
            {isAdmin && (
              <Button className="mt-4 bg-brand hover:bg-brand-dark text-white" onClick={openCreate}>
                إنشاء أول مجموعة
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="border-none shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{group.name}</CardTitle>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(group)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => openDelete(group)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <Clock className="w-3.5 h-3.5" />
                    مهلة التأخر
                  </span>
                  <Badge variant="outline">{group.late_grace_minutes} دقيقة</Badge>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <Clock className="w-3.5 h-3.5" />
                    خصم لكل ساعة تأخر
                  </span>
                  <Badge variant="outline">{group.deduction_per_late_hour} ر.س</Badge>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <Calendar className="w-3.5 h-3.5" />
                    أيام غياب مسموحة
                  </span>
                  <Badge variant="outline">{group.allowed_absent_days} يوم</Badge>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    خصم غياب غير مبرر
                  </span>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{group.deduction_per_absent_day} ر.س/يوم</Badge>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    خصم تجاوز الإجازة المسموحة
                  </span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{group.deduction_per_excess_approved_day} ر.س/يوم</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مجموعة الخصم" : "إنشاء مجموعة خصم جديدة"}</DialogTitle>
            <DialogDescription>
              تحديد قواعد التأخر والغياب المطبقة على الموظفين المُعيَّنين لهذه المجموعة.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>اسم المجموعة</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: موظفو المكتب، الإدارة" />
            </div>

            <div className="rounded-lg bg-gray-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">قواعد التأخر</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">مهلة التأخر (دقيقة)</Label>
                  <Input type="number" min={0} value={form.late_grace_minutes}
                    onChange={(e) => set("late_grace_minutes", Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">خصم لكل ساعة تأخر (ر.س)</Label>
                  <Input type="number" min={0} step="0.01" value={form.deduction_per_late_hour}
                    onChange={(e) => set("deduction_per_late_hour", Number(e.target.value))} />
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">قواعد الغياب</p>
              <div className="space-y-1.5">
                <Label className="text-xs">عدد أيام الغياب المسموحة (إجازة معتمدة)</Label>
                <Input type="number" min={0} value={form.allowed_absent_days}
                  onChange={(e) => set("allowed_absent_days", Number(e.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">خصم الغياب غير المبرر (ر.س/يوم)</Label>
                  <Input type="number" min={0} step="0.01" value={form.deduction_per_absent_day}
                    onChange={(e) => set("deduction_per_absent_day", Number(e.target.value))} />
                  <p className="text-xs text-gray-400">يُطبَّق دائماً بغض النظر عن العدد المسموح</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">خصم تجاوز الإجازة المعتمدة (ر.س/يوم)</Label>
                  <Input type="number" min={0} step="0.01" value={form.deduction_per_excess_approved_day}
                    onChange={(e) => set("deduction_per_excess_approved_day", Number(e.target.value))} />
                  <p className="text-xs text-gray-400">يُطبَّق على الأيام التي تتجاوز الحد المسموح</p>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave} disabled={submitting}>
              {submitting ? "جار الحفظ..." : editing ? "حفظ التعديلات" : "إنشاء المجموعة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              حذف المجموعة
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف مجموعة <strong>{deleting?.name}</strong>؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? "جار الحذف..." : "تأكيد الحذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
