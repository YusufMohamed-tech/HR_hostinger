"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";

type ManualEntry = {
  id: string;
  employee_id: string;
  entry_type: "deduction" | "absence";
  amount: number | null;
  days: number | null;
  reason: string;
  entry_date: string;
  month: string;
  status: string;
  accounting_status: string;
  created_at: string;
  employees?: { full_name: string; employee_code: string };
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  onSuccess: () => void;
}

const todayString = () => new Date().toISOString().split("T")[0];
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export function ManualEntryDialog({ open, onOpenChange, employeeId, employeeName, onSuccess }: Props) {
  const { currentUser } = useRoleContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [form, setForm] = useState({
    entry_type: "deduction" as "deduction" | "absence",
    amount: "",
    days: "",
    reason: "",
    entry_date: todayString(),
    month: currentMonth(),
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!open || !employeeId) return;
    loadEntries();
  }, [open, employeeId]);

  const loadEntries = async () => {
    setLoadingEntries(true);
    try {
      const res = await fetch(`/api/manual-entries?employee_id=${employeeId}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    }
    setLoadingEntries(false);
  };

  const handleSubmit = async () => {
    setError("");
    if (!form.reason.trim() || form.reason.trim().length < 3) {
      setError("السبب مطلوب (3 أحرف على الأقل).");
      return;
    }
    if (form.entry_type === "deduction" && (!form.amount || Number(form.amount) <= 0)) {
      setError("مبلغ الخصم مطلوب.");
      return;
    }
    if (form.entry_type === "absence" && (!form.days || Number(form.days) <= 0)) {
      setError("عدد أيام الغياب مطلوب.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        employee_id: employeeId,
        entry_type: form.entry_type,
        reason: form.reason.trim(),
        entry_date: form.entry_date,
        month: form.month,
      };
      if (form.entry_type === "deduction") {
        payload.amount = Number(form.amount);
      } else {
        payload.days = Number(form.days);
      }

      const res = await fetch("/api/manual-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "فشل في الحفظ.");
        setSubmitting(false);
        return;
      }

      setForm({ entry_type: "deduction", amount: "", days: "", reason: "", entry_date: todayString(), month: currentMonth() });
      await loadEntries();
      onSuccess();
    } catch {
      setError("خطأ في الاتصال.");
    }
    setSubmitting(false);
  };

  const handleCancel = async (entryId: string) => {
    const res = await fetch(`/api/manual-entries/${entryId}`, { method: "DELETE" });
    if (res.ok) {
      await loadEntries();
      onSuccess();
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value == null) return "-";
    return `${Number(value).toLocaleString("ar-SA")} ر.س`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>إضافة خصم / غياب</DialogTitle>
          <DialogDescription>
            {employeeName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Entry Form */}
          <div className="grid grid-cols-1 gap-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={form.entry_type} onValueChange={(v) => set("entry_type", v || "deduction")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deduction">خصم مالي</SelectItem>
                  <SelectItem value="absence">غياب</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.entry_type === "deduction" ? (
              <div className="space-y-2">
                <Label>المبلغ (ر.س)</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>عدد الأيام</Label>
                <Input type="number" min="1" step="1" value={form.days} onChange={(e) => set("days", e.target.value)} placeholder="1" />
              </div>
            )}

            <div className="space-y-2">
              <Label>السبب</Label>
              <Textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="سبب الخصم أو الغياب..." rows={2} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>التاريخ</Label>
                <Input type="date" value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>شهر المسير</Label>
                <Input type="month" value={form.month.slice(0, 7)} onChange={(e) => set("month", e.target.value ? `${e.target.value}-01` : currentMonth())} />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? "جاري الحفظ..." : "إضافة"}
            </Button>
          </div>

          {/* History */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">السجل</h4>
            {loadingEntries ? (
              <p className="text-xs text-gray-400">جاري التحميل...</p>
            ) : entries.length === 0 ? (
              <p className="text-xs text-gray-400">لا توجد سجلات.</p>
            ) : (
              <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={entry.entry_type === "deduction" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                        {entry.entry_type === "deduction" ? "خصم" : "غياب"}
                      </Badge>
                      <span className="font-medium">
                        {entry.entry_type === "deduction" ? formatCurrency(entry.amount) : `${entry.days} يوم`}
                      </span>
                      <span className="text-gray-500 truncate">{entry.reason}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className={
                        entry.status === "pending" ? "bg-blue-50 text-blue-700 border-blue-200" :
                        entry.status === "applied" ? "bg-green-50 text-green-700 border-green-200" :
                        "bg-gray-50 text-gray-500 border-gray-200"
                      }>
                        {entry.status === "pending" ? "معلق" : entry.status === "applied" ? "مطبق" : "ملغي"}
                      </Badge>
                      {entry.accounting_status === "posted" && (
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">محاسبي</Badge>
                      )}
                      {entry.status === "pending" && (
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400 hover:text-red-600" onClick={() => handleCancel(entry.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
