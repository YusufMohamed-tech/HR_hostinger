"use client";

import React, { useCallback, useEffect, useState } from "react";
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
import { useEmployees } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { acknowledgeFinancialBalance, createFinancialBalance, getFinancialBalances } from "@/lib/services/financial";

export default function BalancesPage() {
  const { currentUser } = useRoleContext();
  const { data: employees } = useEmployees();
  const [balances, setBalances] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUser?.role !== "Employee";

  const loadBalances = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = await getFinancialBalances(currentUser.orgId, isAdmin ? undefined : currentUser.employeeId);
    setBalances(data || []);
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
          <h1 className="text-2xl font-bold tracking-tight">Employee Balances</h1>
          <p className="text-sm text-gray-500">Track employee deficits, advances, loans, and acknowledgments.</p>
        </div>
        {isAdmin && <CreateBalanceDialog employees={employees} onSuccess={loadBalances} />}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Open Entries</p>
            <p className="text-2xl font-semibold">{balances.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Amount</p>
            <p className="text-2xl font-semibold">{total.toLocaleString()} SAR</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Pending Acknowledgment</p>
            <p className="text-2xl font-semibold">{balances.filter((row) => !row.acknowledgment_signature_url).length}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signature</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((balance) => {
                const employee = (balance.employee ?? null) as Record<string, unknown> | null;
                const status = typeof balance.status === "string" ? balance.status : "unpaid";
                return (
                  <TableRow key={String(balance.id)}>
                    <TableCell className="font-medium">{String(employee?.full_name || "Me")}</TableCell>
                    <TableCell>{String(balance.balance_type || "balance")}</TableCell>
                    <TableCell>{Number(balance.amount || 0).toLocaleString()} SAR</TableCell>
                    <TableCell>{String(balance.description || "-")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status === "acknowledged" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}>
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {balance.acknowledgment_signature_url ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700">Signed</Badge>
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
              <p className="text-sm font-medium text-gray-900">No balances recorded</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateBalanceDialog({ employees, onSuccess }: { employees: Record<string, unknown>[]; onSuccess: () => void }) {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employee_id: "", balance_type: "deficit", amount: "", description: "" });
  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!currentUser?.orgId || !form.employee_id || Number(form.amount) <= 0) {
      setError("Employee and positive amount are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: err } = await createFinancialBalance({
      org_id: currentUser.orgId,
      employee_id: form.employee_id,
      balance_type: form.balance_type,
      amount: Number(form.amount),
      description: form.description.trim() || undefined,
      status: "unpaid",
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOpen(false);
    setForm({ employee_id: "", balance_type: "deficit", amount: "", description: "" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand-dark text-white" />}>
        <Plus className="h-4 w-4 mr-2" /> Add Balance
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Balance Entry</DialogTitle>
          <DialogDescription>Record money owed, advances, loans, penalties, or reimbursements.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={form.employee_id} onValueChange={(value) => set("employee_id", value)}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={String(employee.id)} value={String(employee.id)}>
                    {String(employee.full_name || employee.name || "Employee")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.balance_type} onValueChange={(value) => set("balance_type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deficit">Deficit</SelectItem>
                  <SelectItem value="loan">Loan</SelectItem>
                  <SelectItem value="advance_payment">Advance</SelectItem>
                  <SelectItem value="reimbursement">Reimbursement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" value={form.amount} onChange={(event) => set("amount", event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(event) => set("description", event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
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
        <PenLine className="h-4 w-4 mr-2" /> Sign
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acknowledge Balance</DialogTitle>
          <DialogDescription>Type your name as an electronic signature.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label>Electronic Signature</Label>
          <Input value={signature} onChange={(event) => setSignature(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white"
            disabled={!signature.trim()}
            onClick={async () => {
              await acknowledgeFinancialBalance(balanceId, signature.trim());
              setOpen(false);
              setSignature("");
              onSuccess();
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
