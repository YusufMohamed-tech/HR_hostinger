"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileUp, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/Skeletons";
import { createPersonnelFile } from "@/lib/services/personnel";
import {
  createOnboardingRequirement,
  getOnboardingWorkspace,
  updateOnboardingItem,
  type OnboardingEmployee,
  type OnboardingItem,
  type OnboardingWorkspace,
} from "@/lib/services/onboarding";

const statusLabels: Record<string, string> = {
  not_started: "لم يبدأ",
  in_progress: "قيد الاستكمال",
  missing: "ناقص",
  requested: "مطلوب من الموظف",
  submitted: "تم الرفع",
  under_review: "تحت المراجعة",
  verified: "مكتمل",
  rejected: "مرفوض",
  waived: "تم التجاوز",
  not_applicable: "غير منطبق",
  overdue: "متأخر",
  complete: "مكتمل",
};

const capabilityLabels: Record<string, string> = {
  general: "الدخول والعمل",
  payroll: "احتساب الرواتب",
  payroll_payment: "صرف الراتب",
  attendance: "الحضور",
  inventory: "المخزون",
  sales: "المبيعات",
  accounting: "المحاسبة",
};

const completeStatuses = new Set(["verified", "waived", "not_applicable"]);

function statusClass(status: string) {
  if (completeStatuses.has(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "overdue" || status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "submitted" || status === "under_review") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function OnboardingPage() {
  const [workspace, setWorkspace] = useState<OnboardingWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getOnboardingWorkspace();
    setWorkspace(result.data);
    setError(result.error?.message || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!workspace || !query) return workspace?.employees || [];
    return workspace.employees.filter((employee) =>
      employee.full_name.toLowerCase().includes(query)
      || String(employee.employee_code || "").toLowerCase().includes(query)
      || String(employee.email || "").toLowerCase().includes(query)
    );
  }, [search, workspace]);

  const runAction = async (
    item: OnboardingItem,
    action: "request" | "review" | "verify" | "reject" | "waive" | "not_applicable" | "reopen" | "set_due"
  ) => {
    let reason: string | null = null;
    let dueAt: string | null = null;
    if (["reject", "waive", "not_applicable"].includes(action)) {
      reason = window.prompt("اكتب سبب القرار (مطلوب للتدقيق):")?.trim() || null;
      if (!reason) return;
    }
    if (action === "set_due") {
      dueAt = window.prompt("أدخل تاريخ الاستحقاق بصيغة YYYY-MM-DD:", item.due_at || "")?.trim() || null;
      if (!dueAt) return;
    }
    setBusyItem(item.id);
    setError("");
    const result = await updateOnboardingItem({
      item_id: item.id,
      action,
      reason,
      due_at: dueAt,
    });
    if (result.error) setError(result.error.message);
    else await load();
    setBusyItem("");
  };

  const uploadItem = async (item: OnboardingItem, employee: OnboardingEmployee, file?: File) => {
    if (!file) return;
    setBusyItem(item.id);
    setError("");
    const result = await createPersonnelFile({
      employee_id: employee.id,
      category: item.requirement_code === "official_id" ? "official" : "onboarding",
      onboarding_item_id: item.id,
      notes: item.label_ar,
    }, file);
    if (result.error) setError(result.error.message);
    else await load();
    setBusyItem("");
  };

  const addRequirement = async (employee: OnboardingEmployee) => {
    const label = window.prompt(`اسم الملف أو المتطلب المطلوب من ${employee.full_name}:`)?.trim();
    if (!label) return;
    const dueAt = window.prompt("تاريخ الاستحقاق بصيغة YYYY-MM-DD (يمكن تركه فارغًا):")?.trim() || null;
    setError("");
    const result = await createOnboardingRequirement({
      employee_id: employee.id,
      label_ar: label,
      evidence_kind: "document",
      category: "other",
      severity: "required",
      due_at: dueAt,
      employee_can_submit: true,
    });
    if (result.error) setError(result.error.message);
    else await load();
  };

  if (loading && !workspace) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {workspace?.canManage ? "استكمال ملفات الموظفين" : "استكمال ملفي"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            الموظف وحسابه يظلان نشطين. هذه القائمة تتابع النواقص ومواعيدها والجاهزية التشغيلية فقط.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`ml-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          تحديث الجاهزية
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {workspace?.canManage && (
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            className="pr-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم أو الرقم أو البريد..."
          />
        </div>
      )}

      <div className="grid gap-4">
        {employees.map((employee) => {
          const items = (workspace?.items || []).filter((item) => item.employee_id === employee.id);
          const capabilities = (workspace?.capabilities || []).filter((item) => item.employee_id === employee.id);
          return (
            <Card key={employee.id} className="overflow-hidden">
              <CardHeader className="border-b bg-slate-50/70 pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="text-lg">{employee.full_name}</CardTitle>
                    <p className="mt-1 text-xs text-gray-500">
                      {employee.employee_code || "بدون رقم"} · {employee.email || "بدون بريد"}
                    </p>
                  </div>
                  <div className="flex min-w-56 flex-col gap-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>{statusLabels[employee.onboarding_status] || employee.onboarding_status}</span>
                      <span>{Number(employee.onboarding_progress || 0).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, Number(employee.onboarding_progress || 0)))}%` }}
                      />
                    </div>
                    {workspace?.canManage && (
                      <Button size="sm" variant="outline" onClick={() => void addRequirement(employee)}>
                        إضافة ملف أو متطلب خاص
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {capabilities.map((capability) => (
                    <Badge
                      key={capability.capability}
                      variant="outline"
                      className={capability.is_ready && capability.account_and_employment_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"}
                      title={(capability.blocking_requirements || []).join(", ")}
                    >
                      {capability.is_ready && capability.account_and_employment_active
                        ? <ShieldCheck className="ml-1 h-3 w-3" />
                        : <Clock3 className="ml-1 h-3 w-3" />}
                      {capabilityLabels[capability.capability] || capability.capability}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {items.map((item) => {
                  const completed = completeStatuses.has(item.status);
                  return (
                    <div key={item.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">{item.label_ar}</span>
                          <Badge variant="outline" className={statusClass(item.status)}>
                            {completed && <CheckCircle2 className="ml-1 h-3 w-3" />}
                            {statusLabels[item.status] || item.status}
                          </Badge>
                          <Badge variant="outline">{item.severity}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          الاستحقاق: {item.due_at || "غير محدد"}
                          {item.capability ? ` · يؤثر على ${capabilityLabels[item.capability] || item.capability}` : ""}
                          {item.decision_reason ? ` · السبب: ${item.decision_reason}` : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {item.evidence_kind === "document"
                          && !completed
                          && (
                            workspace?.canManage
                            || (item.employee_can_submit && ["requested", "rejected"].includes(item.status))
                          ) && (
                          <label className="inline-flex cursor-pointer items-center rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark">
                            <FileUp className="ml-1 h-4 w-4" />
                            {item.status === "submitted" ? "استبدال الملف" : "رفع ملف"}
                            <input
                              className="sr-only"
                              type="file"
                              accept=".pdf,.docx,.jpg,.jpeg,.png"
                              disabled={busyItem === item.id}
                              onChange={(event) => void uploadItem(item, employee, event.target.files?.[0])}
                            />
                          </label>
                        )}
                        {workspace?.canManage && !completed && (
                          <>
                            {["missing", "overdue", "rejected"].includes(item.status) && (
                              <Button size="sm" variant="outline" disabled={busyItem === item.id} onClick={() => void runAction(item, "request")}>
                                طلب الاستكمال
                              </Button>
                            )}
                            {item.status === "submitted" && (
                              <Button size="sm" variant="outline" disabled={busyItem === item.id} onClick={() => void runAction(item, "review")}>
                                بدء المراجعة
                              </Button>
                            )}
                            <Button size="sm" disabled={busyItem === item.id} onClick={() => void runAction(item, "verify")}>
                              اعتماد
                            </Button>
                            <Button size="sm" variant="outline" disabled={busyItem === item.id} onClick={() => void runAction(item, "reject")}>
                              رفض
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busyItem === item.id} onClick={() => void runAction(item, "waive")}>
                              تجاوز
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busyItem === item.id} onClick={() => void runAction(item, "set_due")}>
                              تعديل الموعد
                            </Button>
                          </>
                        )}
                        {workspace?.canManage && completed && (
                          <Button size="sm" variant="outline" disabled={busyItem === item.id} onClick={() => void runAction(item, "reopen")}>
                            إعادة فتح
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="p-6 text-center text-sm text-gray-500">لا توجد متطلبات استكمال لهذا الموظف.</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {employees.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-gray-500">
          لا توجد ملفات موظفين مطابقة.
        </div>
      )}
    </div>
  );
}
