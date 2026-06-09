"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bell, Download, Eye, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  createEmployeeContract,
  createPersonnelFile,
  getEmployeeContracts,
  getPersonnelFileUrl,
  getPersonnelFiles,
  getSocialInsurance,
  uploadPersonnelFile,
  upsertSocialInsurance,
} from "@/lib/services/personnel";
import { createNotification } from "@/lib/services/notifications";
import { printHtmlReport } from "@/lib/utils/print-report";

type PersonnelTab = "files" | "insurance" | "contracts";

const personnelTabs: { value: PersonnelTab; label: string }[] = [
  { value: "files", label: "???????" },
  { value: "insurance", label: "?????????" },
  { value: "contracts", label: "??????" },
];

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exportTableAsPdf(title: string, headers: string[], rows: unknown[][]) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowsHtml = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">لا توجد بيانات للتصدير.</td></tr>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 24px; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: right; font-size: 13px; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body>
</html>`;

  printHtmlReport(html, String(title || "personnel-report"));
}

export default function PersonnelPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [files, setFiles] = useState<Record<string, unknown>[]>([]);
  const [insurance, setInsurance] = useState<Record<string, unknown>[]>([]);
  const [contracts, setContracts] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderSent, setReminderSent] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<PersonnelTab>("files");
  const isAdmin = currentUser?.role !== "Employee";

  const loadPersonnel = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const employeeId = isAdmin ? undefined : currentUser.employeeId;
    const [fileResult, insuranceResult, contractResult] = await Promise.all([
      getPersonnelFiles(currentUser.orgId, employeeId),
      getSocialInsurance(currentUser.orgId, employeeId),
      getEmployeeContracts(currentUser.orgId, employeeId),
    ]);
    setFiles(fileResult.data || []);
    setInsurance(insuranceResult.data || []);
    setContracts(contractResult.data || []);
    setLoading(false);
  }, [currentUser?.employeeId, currentUser?.orgId, isAdmin]);

  useEffect(() => {
    loadPersonnel();
  }, [loadPersonnel]);

  const expiringFiles = files.filter((file) => {
    if (typeof file.expiry_date !== "string") return false;
    const diff = new Date(file.expiry_date).getTime() - Date.now();
    return diff >= 0 && diff <= 30 * 86400000;
  });

  const handleSendReminders = async () => {
    if (!currentUser?.orgId || !currentUser?.id) return;
    for (const file of expiringFiles) {
      const employee = (file.employee ?? null) as Record<string, unknown> | null;
      const daysLeft = Math.ceil((new Date(String(file.expiry_date)).getTime() - Date.now()) / 86400000);
      await createNotification({
        org_id: currentUser.orgId,
        user_id: currentUser.id,
        title: "تنبيه: مستند يقترب من الانتهاء",
        body: `مستند "${String(file.category || "ملف")}" للموظف ${String(employee?.full_name || "غير معروف")} سينتهي خلال ${daysLeft} يوم.`,
        type: "expiry_alert",
        link: "/personnel",
      });
    }
    setReminderSent(true);
    window.setTimeout(() => setReminderSent(false), 5000);
  };

  const openStoredFile = async (pathValue: unknown) => {
    const filePath = String(pathValue || "");
    if (!filePath) return;
    if (filePath.startsWith("http")) {
      window.open(filePath, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await getPersonnelFileUrl(filePath);
    if (error || !data?.signedUrl) {
      setMessage(error?.message || "تعذر فتح الملف.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleExport = () => {
    if (activeTab === "files") {
      exportTableAsPdf(
        "ملفات الموظفين الرسمية",
        ["الموظف", "التصنيف", "اسم الملف", "تاريخ الانتهاء", "موثق"],
        files.map((file) => {
          const employee = (file.employee ?? null) as Record<string, unknown> | null;
          return [
            employee?.full_name || "الموظف",
            file.category || "-",
            file.file_name || "-",
            file.expiry_date || "-",
            file.is_verified ? "نعم" : "لا",
          ];
        }),
      );
      return;
    }

    if (activeTab === "insurance") {
      exportTableAsPdf(
        "التأمينات الاجتماعية",
        ["الموظف", "رقم التأمينات", "النسبة", "الحالة"],
        insurance.map((item) => {
          const employee = (item.employee ?? null) as Record<string, unknown> | null;
          return [
            employee?.full_name || "الموظف",
            item.gosi_number || "-",
            `${Number(item.contribution_rate || 0)}%`,
            item.status || "active",
          ];
        }),
      );
      return;
    }

    exportTableAsPdf(
      "عقود الموظفين",
      ["الموظف", "نوع العقد", "البداية", "النهاية", "الحالة"],
      contracts.map((contract) => {
        const employee = (contract.employee ?? null) as Record<string, unknown> | null;
        return [
          employee?.full_name || "الموظف",
          contract.contract_type || "permanent",
          contract.start_date || "-",
          contract.end_date || "-",
          contract.status || "active",
        ];
      }),
    );
  };

  const tabCount = (tab: PersonnelTab) => {
    if (tab === "files") return files.length;
    if (tab === "insurance") return insurance.length;
    return contracts.length;
  };

  return (
    <div className="space-y-6">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ملفات الموظفين</h1>
          <p className="text-sm text-gray-500">إدارة العقود والملفات الرسمية وسجلات التأمينات الاجتماعية.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {expiringFiles.length > 0 && (
              <Button
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={handleSendReminders}
                disabled={reminderSent}
              >
                <Bell className="h-4 w-4 ml-2" />
                {reminderSent ? "تم الإرسال!" : `إرسال تذكيرات (${expiringFiles.length})`}
              </Button>
            )}
            <AddFileDialog employees={employees} onSuccess={loadPersonnel} />
            <AddInsuranceDialog employees={employees} onSuccess={loadPersonnel} />
            <AddContractDialog employees={employees} onSuccess={loadPersonnel} />
          </div>
        )}
      </div>

      {/* Expiry alert banner */}
      {expiringFiles.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-orange-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-orange-800">
              {expiringFiles.length} مستند{expiringFiles.length > 1 ? "ات" : ""} تنتهي خلال 30 يومًا
            </p>
            <p className="text-xs text-orange-600">
              {expiringFiles.map((f) => {
                const emp = (f.employee ?? null) as Record<string, unknown> | null;
                return String(emp?.full_name || "موظف");
              }).join("، ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">الملفات</p><p className="text-2xl font-semibold">{files.length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">العقود</p><p className="text-2xl font-semibold">{contracts.length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">تنتهي قريبًا</p><p className="text-2xl font-semibold">{expiringFiles.length}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {personnelTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={activeTab === tab.value ? "default" : "outline"}
              className={activeTab === tab.value ? "bg-brand text-white hover:bg-brand-dark" : ""}
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
              <Badge variant="outline" className="mr-2 bg-white/80 text-slate-700">
                {tabCount(tab.value)}
              </Badge>
            </Button>
          ))}
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 ml-2" />
          تصدير PDF
        </Button>
      </div>

      {activeTab === "files" && (
      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-brand" /> الملفات الرسمية</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>التصنيف</TableHead><TableHead>الملف</TableHead><TableHead>تاريخ الانتهاء</TableHead><TableHead>موثق</TableHead></TableRow></TableHeader>
            <TableBody>
              {files.map((file) => {
                const employee = (file.employee ?? null) as Record<string, unknown> | null;
                const isExpiringSoon = expiringFiles.some((f) => f.id === file.id);
                return (
                  <TableRow key={String(file.id)} className={isExpiringSoon ? "bg-orange-50/50" : undefined}>
                    <TableCell>{String(employee?.full_name || "الموظف")}</TableCell>
                    <TableCell>{String(file.category || "other")}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openStoredFile(file.file_path || file.file_url)}
                      >
                        <Eye className="h-4 w-4 ml-1" />
                        {String(file.file_name || "عرض")}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {isExpiringSoon ? (
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                          {String(file.expiry_date)} ⚠
                        </Badge>
                      ) : (
                        String(file.expiry_date || "-")
                      )}
                    </TableCell>
                    <TableCell>{file.is_verified ? <ShieldCheck className="h-4 w-4 text-green-600" /> : "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!loading && files.length === 0 && <EmptyState text="لا توجد ملفات موظفين حتى الآن." />}
        </CardContent>
      </Card>

      )}

      {activeTab === "insurance" && (
        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle>التأمينات الاجتماعية</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>رقم التأمينات</TableHead><TableHead>النسبة</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>
                {insurance.map((item) => {
                  const employee = (item.employee ?? null) as Record<string, unknown> | null;
                  return (
                    <TableRow key={String(item.id)}>
                      <TableCell>{String(employee?.full_name || "الموظف")}</TableCell>
                      <TableCell>{String(item.gosi_number || "-")}</TableCell>
                      <TableCell>{Number(item.contribution_rate || 0)}%</TableCell>
                      <TableCell><Badge variant="outline">{String(item.status || "active")}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      )}

      {activeTab === "contracts" && (
        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle>العقود</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>النوع</TableHead><TableHead>البداية</TableHead><TableHead>الحالة</TableHead><TableHead>الإجراءات</TableHead></TableRow></TableHeader>
              <TableBody>
                {contracts.map((contract) => {
                  const employee = (contract.employee ?? null) as Record<string, unknown> | null;
                  return (
                    <TableRow key={String(contract.id)}>
                      <TableCell>{String(employee?.full_name || "الموظف")}</TableCell>
                      <TableCell>{String(contract.contract_type || "permanent")}</TableCell>
                      <TableCell>{String(contract.start_date || "-")}</TableCell>
                      <TableCell><Badge variant="outline">{String(contract.status || "active")}</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openStoredFile(contract.file_path)}>
                          <Eye className="h-4 w-4 ml-1" />
                          عرض
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-gray-500">{text}</div>;
}

function EmployeeSelect({ employees, value, onChange }: { employees: Record<string, unknown>[]; value: string; onChange: (value: string | null) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
      <SelectContent>
        {employees.map((employee) => (
          <SelectItem key={String(employee.id)} value={String(employee.id)}>
            {String(employee.full_name || employee.name || "الموظف")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddFileDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", category: "other", expiry_date: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>إضافة ملف</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة ملف</DialogTitle><DialogDescription>تسجيل مستند رسمي للموظف.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <EmployeeSelect employees={employees} value={form.employee_id} onChange={(value) => set("employee_id", value)} />
          <Input placeholder="التصنيف" value={form.category} onChange={(event) => set("category", event.target.value)} />
          <Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Input type="date" value={form.expiry_date} onChange={(event) => set("expiry_date", event.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            if (!currentUser?.orgId || !form.employee_id || !file) {
              setError("الموظف والملف مطلوبان.");
              return;
            }
            const { data: uploadData, error: uploadError } = await uploadPersonnelFile(currentUser.orgId, form.employee_id, file);
            if (uploadError || !uploadData?.path) {
              setError(uploadError?.message || "تعذر رفع الملف.");
              return;
            }
            await createPersonnelFile({
              org_id: currentUser.orgId,
              employee_id: form.employee_id,
              category: form.category || "other",
              file_name: file.name,
              file_path: uploadData.path,
              file_size: file.size,
              expiry_date: form.expiry_date || undefined,
            });
            setOpen(false);
            setFile(null);
            setError("");
            onSuccess();
          }}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddInsuranceDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", gosi_number: "", contribution_rate: "9.75", status: "active" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>إضافة تأمينات</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>التأمينات الاجتماعية</DialogTitle><DialogDescription>تحديث بيانات التأمينات الاجتماعية.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <EmployeeSelect employees={employees} value={form.employee_id} onChange={(value) => set("employee_id", value)} />
          <Input placeholder="رقم التأمينات" value={form.gosi_number} onChange={(event) => set("gosi_number", event.target.value)} />
          <Input type="number" value={form.contribution_rate} onChange={(event) => set("contribution_rate", event.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            if (!currentUser?.orgId || !form.employee_id) return;
            await upsertSocialInsurance({ org_id: currentUser.orgId, employee_id: form.employee_id, gosi_number: form.gosi_number || undefined, contribution_rate: Number(form.contribution_rate || 0), status: form.status });
            setOpen(false);
            onSuccess();
          }}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddContractDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", contract_type: "permanent", start_date: "", end_date: "", salary_at_signing: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>إضافة عقد</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة عقد</DialogTitle><DialogDescription>تسجيل عقد موظف.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <EmployeeSelect employees={employees} value={form.employee_id} onChange={(value) => set("employee_id", value)} />
          <Input placeholder="نوع العقد" value={form.contract_type} onChange={(event) => set("contract_type", event.target.value)} />
          <Input type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} />
          <Input type="date" value={form.end_date} onChange={(event) => set("end_date", event.target.value)} />
          <Input type="number" placeholder="الراتب عند التوقيع" value={form.salary_at_signing} onChange={(event) => set("salary_at_signing", event.target.value)} />
          <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            if (!currentUser?.orgId || !form.employee_id || !form.start_date || !file) {
              setError("الموظف وتاريخ بداية العقد وملف العقد مطلوبة.");
              return;
            }
            const { data: uploadData, error: uploadError } = await uploadPersonnelFile(currentUser.orgId, form.employee_id, file);
            if (uploadError || !uploadData?.path) {
              setError(uploadError?.message || "تعذر رفع ملف العقد.");
              return;
            }
            await createEmployeeContract({ org_id: currentUser.orgId, ...form, end_date: form.end_date || undefined, salary_at_signing: form.salary_at_signing ? Number(form.salary_at_signing) : undefined, file_path: uploadData.path });
            setOpen(false);
            setFile(null);
            setError("");
            onSuccess();
          }}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
