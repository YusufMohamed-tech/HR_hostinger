"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, UserRound, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createSalesAgent,
  getSalesCompanies,
  getSalesTeam,
  updateSalesAgent,
  type SalesAgent,
  type SalesCompany,
} from "@/lib/services/sales";
import { useLocations, useShifts } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";
import { cn } from "@/lib/utils";

type AssignmentForm = Record<string, {
  role: "none" | "sales" | "manager";
  start_date: string;
  end_date: string;
  daily_target: string;
  target_notes: string;
}>;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function roleLabel(role: string) {
  if (role === "sales_manager") return "مدير مبيعات";
  return "بائع";
}

function statusActive(status: string) {
  return String(status || "").toLowerCase() === "active";
}

export default function SalesTeamPage() {
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [companies, setCompanies] = useState<SalesCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const { data: locations, loading: loadingLocations } = useLocations();
  const { data: shifts, loading: loadingShifts } = useShifts();

  const load = async () => {
    setLoading(true);
    const [teamResult, companiesResult] = await Promise.all([getSalesTeam(), getSalesCompanies()]);
    if (teamResult.error || !teamResult.data) setMessage(teamResult.error || "تعذر تحميل فريق المبيعات.");
    else setAgents(teamResult.data);
    if (companiesResult.error || !companiesResult.data) setMessage(companiesResult.error || "تعذر تحميل شركات المبيعات.");
    else setCompanies(companiesResult.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading || loadingLocations || loadingShifts) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">فريق المبيعات</h1>
          <p className="mt-2 text-gray-500">إنشاء حسابات المبيعات وربط كل شخص بشركة أو أكثر.</p>
        </div>
        <AgentDialog companies={companies} locations={locations} shifts={shifts} onDone={load} onMessage={setMessage} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>البائع</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الشركات المسندة</TableHead>
                <TableHead>موقع الحضور</TableHead>
                <TableHead>الوردية</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>رقم الهوية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const active = statusActive(agent.status);
                return (
                  <TableRow key={agent.user_id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-950">{agent.full_name}</p>
                        <p className="text-xs text-gray-500">{agent.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{roleLabel(agent.role)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {(agent.company_assignments || []).length > 0 ? agent.company_assignments?.map((assignment) => (
                          <Badge key={`${agent.user_id}-${assignment.company_id}-${assignment.assignment_role}`} variant="outline" className="gap-1 bg-white">
                            {assignment.company?.brand_color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: assignment.company.brand_color }} />}
                            {assignment.company?.name || "شركة"}
                            <span className="text-gray-400">/</span>
                            {assignment.assignment_role === "manager" ? "مدير" : "بائع"}
                          </Badge>
                        )) : <span className="text-sm text-gray-400">غير مسند</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{agent.location?.name || "-"}</p>
                        {agent.location?.city && <p className="text-xs text-gray-500">{agent.location.city}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{agent.shift?.name || "-"}</p>
                        {(agent.shift?.start_time || agent.shift?.end_time) && (
                          <p className="text-xs text-gray-500">{agent.shift?.start_time || "--"} - {agent.shift?.end_time || "--"}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{agent.phone || "-"}</TableCell>
                    <TableCell>{agent.national_id || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                        {active ? "نشط" : "غير نشط"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <AgentDialog agent={agent} companies={companies} locations={locations} shifts={shifts} onDone={load} onMessage={setMessage} />
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
              <p className="mt-1 text-sm text-gray-500">أضف بائعاً أو مدير مبيعات ثم اسنده للشركات المناسبة.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentDialog({
  agent,
  companies,
  locations,
  shifts,
  onDone,
  onMessage,
}: {
  agent?: SalesAgent;
  companies: SalesCompany[];
  locations: Record<string, unknown>[];
  shifts: Record<string, unknown>[];
  onDone: () => void;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ full_name: string; email: string; password: string; phone: string; national_id: string; role: "sales" | "sales_manager"; location_id: string; shift_id: string }>({
    full_name: "",
    email: "",
    password: "",
    phone: "",
    national_id: "",
    role: "sales",
    location_id: "",
    shift_id: "",
  });
  const [assignments, setAssignments] = useState<AssignmentForm>({});

  const selectedCount = useMemo(() => Object.values(assignments).filter((assignment) => assignment.role !== "none").length, [assignments]);

  useEffect(() => {
    if (!open) return;
    const baseAssignments: AssignmentForm = {};
    companies.forEach((company) => {
      baseAssignments[company.id] = { role: "none", start_date: todayIso(), end_date: "", daily_target: "", target_notes: "" };
    });
    (agent?.company_assignments || []).forEach((assignment) => {
      if (!assignment.company_id) return;
      baseAssignments[assignment.company_id] = {
        role: assignment.assignment_role === "manager" ? "manager" : "sales",
        start_date: assignment.start_date || todayIso(),
        end_date: assignment.end_date || "",
        daily_target: assignment.daily_target ? String(assignment.daily_target) : "",
        target_notes: assignment.target_notes || "",
      };
    });

    setAssignments(baseAssignments);
    setForm(agent ? {
      full_name: agent.full_name || "",
      email: agent.email || "",
      password: "",
      phone: agent.phone || "",
      national_id: agent.national_id || "",
      role: agent.role === "sales_manager" ? "sales_manager" : "sales",
      location_id: agent.location_id || "",
      shift_id: agent.shift_id || "",
    } : { full_name: "", email: "", password: "", phone: "", national_id: "", role: "sales", location_id: "", shift_id: "" });
  }, [agent, companies, open]);

  const updateAssignment = (companyId: string, patch: Partial<AssignmentForm[string]>) => {
    setAssignments((prev) => ({
      ...prev,
      [companyId]: {
        role: prev[companyId]?.role || "none",
        start_date: prev[companyId]?.start_date || todayIso(),
        end_date: prev[companyId]?.end_date || "",
        daily_target: prev[companyId]?.daily_target || "",
        target_notes: prev[companyId]?.target_notes || "",
        ...patch,
      },
    }));
  };

  const save = async () => {
    if (form.full_name.trim().length < 2) {
      onMessage("اسم البائع مطلوب.");
      return;
    }
    if (!agent && (!form.email.includes("@") || form.password.length < 8)) {
      onMessage("البريد الإلكتروني وكلمة مرور من 8 أحرف مطلوبة.");
      return;
    }
    const companyAssignments = Object.entries(assignments)
      .filter(([, assignment]) => assignment.role !== "none")
      .map(([companyId, assignment]) => ({
        company_id: companyId,
        assignment_role: assignment.role as "sales" | "manager",
        start_date: assignment.start_date || todayIso(),
        end_date: assignment.end_date || null,
        daily_target: Number(assignment.daily_target || 0),
        target_notes: assignment.target_notes.trim() || null,
      }));

    if (companyAssignments.length === 0) {
      onMessage("اختر شركة واحدة على الأقل.");
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
          location_id: form.location_id || null,
          shift_id: form.shift_id || null,
          company_assignments: companyAssignments,
        })
      : await createSalesAgent({ ...form, location_id: form.location_id || null, shift_id: form.shift_id || null, company_assignments: companyAssignments });
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
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{agent ? "تعديل حساب مبيعات" : "إضافة حساب مبيعات"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>نوع الحساب *</Label>
              <Select value={form.role} onValueChange={(value) => setForm((prev) => ({ ...prev, role: String(value || "") === "sales_manager" ? "sales_manager" : "sales" }))}>
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

          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
            <div>
              <h3 className="font-bold text-gray-950">الحضور والوردية</h3>
              <p className="mt-1 text-sm text-gray-500">حدد موقع الحضور والوردية حتى يتم حساب التأخير والانصراف تلقائيًا.</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>موقع الحضور</Label>
                <Select
                  value={form.location_id || "none"}
                  onValueChange={(value) => {
                    const selected = String(value || "");
                    setForm((prev) => ({ ...prev, location_id: selected === "none" ? "" : selected }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر موقع الحضور" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون موقع</SelectItem>
                    {locations.map((location) => (
                      <SelectItem key={String(location.id)} value={String(location.id)}>
                        {String(location.name || "موقع")} {location.city ? `- ${String(location.city)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الوردية</Label>
                <Select
                  value={form.shift_id || "none"}
                  onValueChange={(value) => {
                    const selected = String(value || "");
                    setForm((prev) => ({ ...prev, shift_id: selected === "none" ? "" : selected }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الوردية" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون وردية</SelectItem>
                    {shifts.map((shift) => (
                      <SelectItem key={String(shift.id)} value={String(shift.id)}>
                        {String(shift.name || "وردية")} · {String(shift.start_time || "--")} - {String(shift.end_time || "--")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-950">إسناد الشركات</h3>
                <p className="mt-1 text-sm text-gray-500">يمكن إسناد الشخص لأكثر من شركة، وتغيير الإسناد أسبوعياً بتاريخ بداية ونهاية.</p>
              </div>
              <Badge variant="outline" className="bg-white">{selectedCount} شركة</Badge>
            </div>
            <div className="mt-4 grid gap-3">
              {companies.map((company) => {
                const assignment = assignments[company.id] || { role: "none", start_date: todayIso(), end_date: "", daily_target: "", target_notes: "" };
                return (
                  <div key={company.id} className={cn("grid gap-3 rounded-lg border bg-white p-3 md:grid-cols-[1fr_150px_128px_128px_140px]", assignment.role !== "none" ? "border-brand/40" : "border-gray-100")}>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-400" />
                      {company.brand_color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: company.brand_color }} />}
                      <span className="font-semibold text-gray-950">{company.name}</span>
                    </div>
                    <Select value={assignment.role} onValueChange={(value) => {
                      const nextValue = String(value || "");
                      updateAssignment(company.id, { role: nextValue === "manager" ? "manager" : nextValue === "sales" ? "sales" : "none" });
                    }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">غير مسند</SelectItem>
                        <SelectItem value="sales">بائع</SelectItem>
                        <SelectItem value="manager">مدير شركة</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="date" value={assignment.start_date} onChange={(event) => updateAssignment(company.id, { start_date: event.target.value })} />
                    <Input type="date" value={assignment.end_date} onChange={(event) => updateAssignment(company.id, { end_date: event.target.value })} />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={assignment.daily_target}
                      onChange={(event) => updateAssignment(company.id, { daily_target: event.target.value })}
                      placeholder="هدف اليوم"
                    />
                    {assignment.role !== "none" && (
                      <Input
                        className="md:col-span-5"
                        value={assignment.target_notes}
                        onChange={(event) => updateAssignment(company.id, { target_notes: event.target.value })}
                        placeholder="ملاحظة اختيارية عن الهدف أو المنطقة"
                      />
                    )}
                  </div>
                );
              })}
              {companies.length === 0 && <p className="text-sm text-gray-500">لا توجد شركات متاحة لهذا الحساب.</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={save} disabled={saving || companies.length === 0}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
