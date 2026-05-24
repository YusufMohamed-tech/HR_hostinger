"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  getPersonnelFiles,
  getSocialInsurance,
  uploadPersonnelFile,
  upsertSocialInsurance,
} from "@/lib/services/personnel";

export default function PersonnelPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [files, setFiles] = useState<Record<string, unknown>[]>([]);
  const [insurance, setInsurance] = useState<Record<string, unknown>[]>([]);
  const [contracts, setContracts] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ملفات الموظفين</h1>
          <p className="text-sm text-gray-500">إدارة العقود والملفات الرسمية وسجلات التأمينات الاجتماعية.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <AddFileDialog employees={employees} onSuccess={loadPersonnel} />
            <AddInsuranceDialog employees={employees} onSuccess={loadPersonnel} />
            <AddContractDialog employees={employees} onSuccess={loadPersonnel} />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">الملفات</p><p className="text-2xl font-semibold">{files.length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">العقود</p><p className="text-2xl font-semibold">{contracts.length}</p></CardContent></Card>
        <Card className="border-none shadow-sm"><CardContent className="py-4"><p className="text-xs text-gray-500">تنتهي قريبًا</p><p className="text-2xl font-semibold">{expiringFiles.length}</p></CardContent></Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-brand" /> الملفات الرسمية</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>التصنيف</TableHead><TableHead>الملف</TableHead><TableHead>تاريخ الانتهاء</TableHead><TableHead>موثق</TableHead></TableRow></TableHeader>
            <TableBody>
              {files.map((file) => {
                const employee = (file.employee ?? null) as Record<string, unknown> | null;
                return (
                  <TableRow key={String(file.id)}>
                    <TableCell>{String(employee?.full_name || "الموظف")}</TableCell>
                    <TableCell>{String(file.category || "other")}</TableCell>
                    <TableCell>{String(file.file_name || "-")}</TableCell>
                    <TableCell>{String(file.expiry_date || "-")}</TableCell>
                    <TableCell>{file.is_verified ? <ShieldCheck className="h-4 w-4 text-green-600" /> : "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!loading && files.length === 0 && <EmptyState text="لا توجد ملفات موظفين حتى الآن." />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle>العقود</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>النوع</TableHead><TableHead>البداية</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>
                {contracts.map((contract) => {
                  const employee = (contract.employee ?? null) as Record<string, unknown> | null;
                  return (
                    <TableRow key={String(contract.id)}>
                      <TableCell>{String(employee?.full_name || "الموظف")}</TableCell>
                      <TableCell>{String(contract.contract_type || "permanent")}</TableCell>
                      <TableCell>{String(contract.start_date || "-")}</TableCell>
                      <TableCell><Badge variant="outline">{String(contract.status || "active")}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
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
      <DialogTrigger render={<Button variant="outline" />}>ملف</DialogTrigger>
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
      <DialogTrigger render={<Button variant="outline" />}>التأمينات</DialogTrigger>
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
  const [form, setForm] = useState({ employee_id: "", contract_type: "permanent", start_date: "", end_date: "", salary_at_signing: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>عقد</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة عقد</DialogTitle><DialogDescription>تسجيل عقد موظف.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <EmployeeSelect employees={employees} value={form.employee_id} onChange={(value) => set("employee_id", value)} />
          <Input placeholder="نوع العقد" value={form.contract_type} onChange={(event) => set("contract_type", event.target.value)} />
          <Input type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} />
          <Input type="date" value={form.end_date} onChange={(event) => set("end_date", event.target.value)} />
          <Input type="number" placeholder="الراتب عند التوقيع" value={form.salary_at_signing} onChange={(event) => set("salary_at_signing", event.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={async () => {
            if (!currentUser?.orgId || !form.employee_id || !form.start_date) return;
            await createEmployeeContract({ org_id: currentUser.orgId, ...form, end_date: form.end_date || undefined, salary_at_signing: form.salary_at_signing ? Number(form.salary_at_signing) : undefined });
            setOpen(false);
            onSuccess();
          }}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
