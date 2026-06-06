"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PenLine, Plus, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import {
  acknowledgeFinancialBalance,
  createFinancialBalance,
  createAdvanceRequest,
  getFinancialBalances,
  getAdvanceRequests,
  reviewAdvanceRequest,
  updateFinancialBalance,
  uploadBalanceAttachment,
  uploadBalanceSignature,
} from "@/lib/services/financial";

export default function BalancesPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [balances, setBalances] = useState<Record<string, unknown>[]>([]);
  const [advanceRequests, setAdvanceRequests] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUser?.role !== "Employee";

  const loadBalances = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const [{ data }, requestsResult] = await Promise.all([
      getFinancialBalances(currentUser.orgId, isAdmin ? undefined : currentUser.employeeId),
      getAdvanceRequests(),
    ]);
    setBalances(data || []);
    setAdvanceRequests(requestsResult.data || []);
    setLoading(false);
  }, [currentUser?.employeeId, currentUser?.orgId, isAdmin]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const total = balances.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">أرصدة الموظفين والعهد</h1>
          <p className="text-sm text-gray-500">متابعة العجز والسلف والقروض والإقرارات الإلكترونية للموظفين.</p>
        </div>
        <div className="flex gap-2">
          {!isAdmin && <RequestAdvanceDialog onSuccess={loadBalances} />}
          {isAdmin && <CreateBalanceDialog employees={employees} onSuccess={loadBalances} />}
        </div>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">السجلات المفتوحة</p>
            <p className="text-2xl font-semibold">{balances.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">إجمالي المبلغ</p>
            <p className="text-2xl font-semibold">{total.toLocaleString()} ريال</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">بانتظار الإقرار</p>
            <p className="text-2xl font-semibold">{balances.filter((row) => !row.acknowledgment_signature_url).length}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">الأرصدة</TabsTrigger>
          <TabsTrigger value="advance-requests">طلبات السلف</TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead>الموظف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التوقيع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((balance) => {
                const employee = (balance.employee ?? null) as Record<string, unknown> | null;
                const status = typeof balance.status === "string" ? balance.status : "unpaid";
                return (
                  <TableRow key={String(balance.id)}>
                    <TableCell className="font-medium">{String(employee?.full_name || "أنا")}</TableCell>
                    <TableCell>{String(balance.balance_type || "balance")}</TableCell>
                    <TableCell>{Number(balance.amount || 0).toLocaleString()} ريال</TableCell>
                    <TableCell>{String(balance.description || "-")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status === "acknowledged" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}>
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {balance.acknowledgment_signature_url ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700">تم التوقيع</Badge>
                      ) : (
                        <AcknowledgeDialog balanceId={String(balance.id)} onSuccess={loadBalances} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!loading && balances.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <WalletCards className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">لا توجد أرصدة مسجلة</p>
            </div>
          )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advance-requests">
          <AdvanceRequestsTable requests={advanceRequests} isAdmin={isAdmin} onSuccess={loadBalances} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateBalanceDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [form, setForm] = useState({ employee_id: "", balance_type: "deficit", amount: "", description: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.employee_id || Number(form.amount) <= 0) {
      setError("الموظف والمبلغ الموجب مطلوبان.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { data, error: err } = await createFinancialBalance({
      org_id: currentUser.orgId,
      employee_id: form.employee_id,
      balance_type: form.balance_type,
      amount: Number(form.amount),
      description: form.description.trim() || undefined,
      status: "unpaid",
    });
    if (err) {
      setSubmitting(false);
      setError(err.message);
      return;
    }
    if (attachment && data?.id) {
      const { data: uploadData, error: uploadError } = await uploadBalanceAttachment(currentUser.orgId, String(data.id), attachment);
      if (uploadError) {
        setSubmitting(false);
        setError(uploadError.message);
        return;
      }
      if (uploadData?.path) {
        await updateFinancialBalance(String(data.id), { attachment_url: uploadData.path });
      }
    }
    setSubmitting(false);
    setOpen(false);
    setAttachment(null);
    setForm({ employee_id: "", balance_type: "deficit", amount: "", description: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="h-4 w-4 ml-2" /> إضافة رصيد
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة سجل رصيد</DialogTitle>
          <DialogDescription>تسجيل مبالغ مستحقة أو سلف أو قروض أو جزاءات أو تعويضات.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>الموظف</Label>
            <Select value={form.employee_id} onValueChange={(value) => set("employee_id", value)}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name || "الموظف")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={form.balance_type} onValueChange={(value) => set("balance_type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deficit">عجز</SelectItem>
                  <SelectItem value="loan">قرض</SelectItem>
                  <SelectItem value="advance_payment">سلفة</SelectItem>
                  <SelectItem value="reimbursement">تعويض</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <Input type="number" value={form.amount} onChange={(event) => set("amount", event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>الوصف</Label>
            <Input value={form.description} onChange={(event) => set("description", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>مرفق</Label>
            <Input type="file" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "جار الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcknowledgeDialog({ balanceId, onSuccess }: { balanceId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PenLine className="h-4 w-4 ml-2" /> توقيع
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إقرار الرصيد</DialogTitle>
          <DialogDescription>اكتب اسمك كتوقيع إلكتروني.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label>التوقيع الإلكتروني</Label>
          <Input value={signature} onChange={(event) => setSignature(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            disabled={!signature.trim()}
            onClick={async () => {
              const { data: uploadData, error: uploadError } = await uploadBalanceSignature(balanceId, signature.trim());
              if (uploadError || !uploadData?.path) return;
              await acknowledgeFinancialBalance(balanceId, uploadData.path);
              setOpen(false);
              setSignature("");
              onSuccess();
            }}
          >
            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const p = point(event);
    if (!canvas || !context || !p) return;
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(p.x, p.y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const p = point(event);
    if (!canvas || !context || !p) return;
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#1f2937";
    context.lineTo(p.x, p.y);
    context.stroke();
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={520}
        height={180}
        className="h-36 w-full touch-none rounded-lg border border-gray-300 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => { drawingRef.current = false; }}
        onPointerCancel={() => { drawingRef.current = false; }}
      />
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{value ? "تم التقاط التوقيع" : "وقّع داخل المربع قبل الإرسال"}</span>
        <Button type="button" variant="outline" size="sm" onClick={clear}>مسح</Button>
      </div>
    </div>
  );
}

function RequestAdvanceDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ requested_amount: "", reason: "" });
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    const amount = Number(form.requested_amount);
    if (amount <= 0) { setError("مبلغ السلفة مطلوب."); return; }
    if (!signature) { setError("التوقيع الإلكتروني مطلوب."); return; }
    setSubmitting(true);
    setError("");
    const result = await createAdvanceRequest({
      requested_amount: amount,
      reason: form.reason.trim() || undefined,
      employee_signature_data: signature,
    });
    setSubmitting(false);
    if (result.error) { setError(result.error.message); return; }
    setOpen(false);
    setForm({ requested_amount: "", reason: "" });
    setSignature("");
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="h-4 w-4 ml-2" /> طلب سلفة
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>طلب سلفة</DialogTitle>
          <DialogDescription>حدد المبلغ ووقّع إلكترونيًا لإرسال الطلب إلى الموارد البشرية.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>المبلغ المطلوب *</Label>
            <Input type="number" value={form.requested_amount} onChange={(event) => setForm((prev) => ({ ...prev, requested_amount: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>السبب</Label>
            <Input value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>التوقيع الإلكتروني *</Label>
            <SignaturePad value={signature} onChange={setSignature} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" disabled={submitting || !form.requested_amount || !signature} onClick={submit}>
            {submitting ? "جارٍ الإرسال..." : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceRequestsTable({ requests, isAdmin, onSuccess }: { requests: Record<string, unknown>[]; isAdmin: boolean; onSuccess: () => void }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
              <TableHead>الموظف</TableHead>
              <TableHead>المبلغ المطلوب</TableHead>
              <TableHead>المبلغ المعتمد</TableHead>
              <TableHead>السبب</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>التوقيع</TableHead>
              {isAdmin && <TableHead>الإجراءات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => {
              const employee = (request.employee ?? null) as Record<string, unknown> | null;
              const status = String(request.status || "pending");
              const signature = String(request.employee_signature_data || "");
              return (
                <TableRow key={String(request.id)}>
                  <TableCell className="font-medium">{String(employee?.full_name || "أنا")}</TableCell>
                  <TableCell>{Number(request.requested_amount || 0).toLocaleString()} ريال</TableCell>
                  <TableCell>{request.approved_amount ? `${Number(request.approved_amount).toLocaleString()} ريال` : "-"}</TableCell>
                  <TableCell>{String(request.reason || "-")}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={status === "pending" ? "bg-amber-50 text-amber-700" : status === "rejected" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}>
                      {status === "pending" ? "قيد المراجعة" : status === "rejected" ? "مرفوض" : status === "partial_approved" ? "موافقة جزئية" : "موافق عليه"}
                    </Badge>
                  </TableCell>
                  <TableCell>{signature ? <img src={signature} alt="signature" className="h-12 rounded border bg-white" /> : "-"}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      {status === "pending" ? <ReviewAdvanceDialog request={request} onSuccess={onSuccess} /> : <span className="text-xs text-gray-500">تمت المراجعة</span>}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {requests.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <WalletCards className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-900">لا توجد طلبات سلفة</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewAdvanceDialog({ request, onSuccess }: { request: Record<string, unknown>; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approvedAmount, setApprovedAmount] = useState(String(request.requested_amount || ""));
  const [hrNotes, setHrNotes] = useState("");
  const [error, setError] = useState("");

  const decide = async (status: "approved" | "partial_approved" | "rejected") => {
    setSubmitting(true);
    setError("");
    const result = await reviewAdvanceRequest({
      id: String(request.id),
      status,
      approved_amount: status === "rejected" ? undefined : Number(approvedAmount),
      hr_notes: hrNotes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) { setError(result.error.message); return; }
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>مراجعة</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>مراجعة طلب السلفة</DialogTitle>
          <DialogDescription>يمكن الموافقة الكاملة أو الجزئية أو الرفض.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>المبلغ المعتمد</Label>
            <Input type="number" value={approvedAmount} onChange={(event) => setApprovedAmount(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات HR</Label>
            <Input value={hrNotes} onChange={(event) => setHrNotes(event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button variant="outline" disabled={submitting} onClick={() => decide("rejected")}>رفض</Button>
          <Button variant="outline" disabled={submitting} onClick={() => decide("partial_approved")}>موافقة جزئية</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" disabled={submitting} onClick={() => decide("approved")}>موافقة كاملة</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
