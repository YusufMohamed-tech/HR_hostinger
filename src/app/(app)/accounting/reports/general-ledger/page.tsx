"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AccountingEmptyState,
  AccountingLoading,
  AccountingPageHeader,
  AccountingStatCard,
  ExportCsvButton,
  MoneyAmount,
} from "@/components/accounting/AccountingPrimitives";
import { getAccountingAccounts, getCostCenters, getAccountingReport } from "@/lib/services/accounting";
import type { AccountingAccount, AccountingCostCenter } from "@/types/accounting";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface GLRow {
  id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  description: string;
  account_id: string;
  account_code: string;
  account_name: string;
  cost_center_code: string | null;
  cost_center_name: string | null;
  debit: number;
  credit: number;
  running_balance: number;
}

interface GLData {
  openingBalance: number;
  rows: GLRow[];
  closingBalance: number;
}

export default function GeneralLedgerPage() {
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [accountId, setAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [costCenters, setCostCenters] = useState<AccountingCostCenter[]>([]);
  const [data, setData] = useState<GLData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAccountingAccounts().then((r) => setAccounts(r.data || []));
    getCostCenters().then((r) => setCostCenters(r.data || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string | undefined> = { date_from: dateFrom, date_to: dateTo };
    if (accountId) params.account_id = accountId;
    if (costCenterId) params.cost_center_id = costCenterId;
    const result = await getAccountingReport("general-ledger", params);
    setData(result.data as GLData | null);
    setLoading(false);
  }, [dateFrom, dateTo, accountId, costCenterId]);

  useEffect(() => { load(); }, [load]);

  const csvRows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.map((r) => ({
      entry_no: r.entry_no,
      entry_date: r.entry_date,
      description: r.description,
      account_code: r.account_code,
      account_name: r.account_name,
      cost_center: r.cost_center_code ? `${r.cost_center_code} - ${r.cost_center_name}` : "",
      debit: r.debit,
      credit: r.credit,
      running_balance: r.running_balance,
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="دفتر الأستاذ العام"
        description="عرض حركات القيود المرحلة مع مركز التكلفة"
        actions={<ExportCsvButton rows={csvRows} filename="general-ledger" />}
      />

      <Card className="border-none shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">من تاريخ</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">إلى تاريخ</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">الحساب</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 w-48 rounded-lg border border-gray-200 bg-white px-3 text-sm">
              <option value="">جميع الحسابات</option>
              {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">مركز التكلفة</label>
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className="h-10 w-48 rounded-lg border border-gray-200 bg-white px-3 text-sm">
              <option value="">جميع المراكز</option>
              {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.code} - {cc.name_ar}</option>)}
            </select>
          </div>
          <Button variant="outline" onClick={load}>تحديث</Button>
        </CardContent>
      </Card>

      {loading ? (
        <AccountingLoading />
      ) : !data?.rows?.length ? (
        <AccountingEmptyState title="لا توجد حركات في الفترة المحددة" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <AccountingStatCard label="الرصيد الافتتاحي" value={<MoneyAmount value={data.openingBalance} />} />
            <AccountingStatCard label="عدد الحركات" value={String(data.rows.length)} />
            <AccountingStatCard label="الرصيد الختامي" value={<MoneyAmount value={data.closingBalance} />} />
          </div>

          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم القيد</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead>الحساب</TableHead>
                    <TableHead>مركز التكلفة</TableHead>
                    <TableHead>مدين</TableHead>
                    <TableHead>دائن</TableHead>
                    <TableHead>الرصيد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.entry_no}</TableCell>
                      <TableCell className="text-sm">{row.entry_date}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{row.description}</TableCell>
                      <TableCell className="text-sm">{row.account_code} - {row.account_name}</TableCell>
                      <TableCell className="text-sm text-gray-600">{row.cost_center_code ? `${row.cost_center_code} - ${row.cost_center_name}` : "—"}</TableCell>
                      <TableCell><MoneyAmount value={row.debit} /></TableCell>
                      <TableCell><MoneyAmount value={row.credit} /></TableCell>
                      <TableCell><MoneyAmount value={row.running_balance} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
