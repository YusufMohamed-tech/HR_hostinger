"use client";

import React, { useEffect, useState } from "react";
import { Pencil, Plus, UserRound, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSalesAgent, getSalesTeam, updateSalesAgent, type SalesAgent } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";

export default function SalesTeamPage() {
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const result = await getSalesTeam();
    if (result.error || !result.data) setMessage(result.error || "تعذر تحميل فريق المبيعات.");
    else setAgents(result.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">فريق المبيعات</h1>
          <p className="mt-2 text-gray-500">إدارة حسابات البائعين داخل المنظمة.</p>
        </div>
        <AgentDialog onDone={load} onMessage={setMessage} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>البائع</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>رقم الهوية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const active = String(agent.status || "").toLowerCase() === "active";
                return (
                  <TableRow key={agent.user_id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-950">{agent.full_name}</p>
                        <p className="text-xs text-gray-500">{agent.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{agent.role === "sales_manager" ? "مدير مبيعات" : "بائع"}</TableCell>
                    <TableCell>{agent.phone || "-"}</TableCell>
                    <TableCell>{agent.national_id || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                        {active ? "نشط" : "غير نشط"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <AgentDialog agent={agent} onDone={load} onMessage={setMessage} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className={active ? "text-red-600 hover:bg-red-50" : "text-brand hover:text-brand-dark"}
                          onClick={async () => {
                            const result = await updateSalesAgent({ user_id: agent.user_id, status: active ? "inactive" : "active" });
                            if (result.error) setMessage(result.error);
                            else load();
                          }}
                        >
                          <UserX className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {agents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UserRound className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-900">لا يوجد بائعون بعد</p>
              <p className="mt-1 text-sm text-gray-500">أضف بائعًا ليبدأ تسجيل المبيعات اليومية.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentDialog({ agent, onDone, onMessage }: { agent?: SalesAgent; onDone: () => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ full_name: string; email: string; password: string; phone: string; national_id: string; role: "sales" | "sales_manager" }>({
    full_name: "",
    email: "",
    password: "",
    phone: "",
    national_id: "",
    role: "sales",
  });

  useEffect(() => {
    if (!open) return;
    setForm(agent ? {
      full_name: agent.full_name || "",
      email: agent.email || "",
      password: "",
      phone: agent.phone || "",
      national_id: agent.national_id || "",
      role: agent.role === "sales_manager" ? "sales_manager" : "sales",
    } : { full_name: "", email: "", password: "", phone: "", national_id: "", role: "sales" });
  }, [agent, open]);

  const save = async () => {
    if (form.full_name.trim().length < 2) {
      onMessage("اسم البائع مطلوب.");
      return;
    }
    if (!agent && (!form.email.includes("@") || form.password.length < 8)) {
      onMessage("البريد الإلكتروني وكلمة مرور من 8 أحرف مطلوبة.");
      return;
    }
    setSaving(true);
    const result = agent
      ? await updateSalesAgent({
          user_id: agent.user_id,
          full_name: form.full_name,
          phone: form.phone,
          national_id: form.national_id,
          role: form.role,
        })
      : await createSalesAgent(form);
    setSaving(false);
    if (result.error) {
      onMessage(result.error);
      return;
    }
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={agent ? "ghost" : "default"} size={agent ? "sm" : "default"} className={agent ? "text-brand hover:text-brand-dark" : "bg-brand text-white hover:bg-brand-dark"} />}>
        {agent ? <Pencil className="h-4 w-4" /> : <><Plus className="ml-2 h-4 w-4" /> إضافة حساب مبيعات</>}
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{agent ? "تعديل حساب مبيعات" : "إضافة حساب مبيعات"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>نوع الحساب *</Label>
            <Select value={form.role} onValueChange={(value) => setForm((prev) => ({ ...prev, role: value === "sales_manager" ? "sales_manager" : "sales" }))}>
              <SelectTrigger>
                <SelectValue placeholder="اختر نوع الحساب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">بائع</SelectItem>
                <SelectItem value="sales_manager">مدير مبيعات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الاسم *</Label>
            <Input value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>البريد الإلكتروني *</Label>
              <Input disabled={Boolean(agent)} value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
            </div>
            {!agent && (
              <div className="space-y-2">
                <Label>كلمة المرور *</Label>
                <Input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>الجوال</Label>
              <Input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>رقم الهوية</Label>
              <Input value={form.national_id} onChange={(event) => setForm((prev) => ({ ...prev, national_id: event.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save} disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
