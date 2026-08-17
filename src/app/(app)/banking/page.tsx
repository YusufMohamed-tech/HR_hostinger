"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, FileText, GitCompare } from "lucide-react";
import { AccountingPageHeader, AccountingLoading, AccountingStatCard } from "@/components/accounting/AccountingPrimitives";
import { getBankAccounts, getBankStatements, type BankAccount, type BankStatement } from "@/lib/services/banking";

export default function BankingDashboardPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getBankAccounts(), getBankStatements()]).then(([a, s]) => {
      setAccounts(a.data || []);
      setStatements(s.data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <AccountingLoading />;

  const activeAccounts = accounts.filter((a) => a.is_active);
  const pendingStatements = statements.filter((s) => s.status !== "reconciled");

  return (
    <div className="space-y-6">
      <AccountingPageHeader title="الخدمات البنكية" description="إدارة الحسابات البنكية، استيراد الكشوف، والمطابقة." />

      <div className="grid gap-4 sm:grid-cols-3">
        <AccountingStatCard label="حسابات بنكية نشطة" value={String(activeAccounts.length)} />
        <AccountingStatCard label="كشوف مستوردة" value={String(statements.length)} />
        <AccountingStatCard label="كشوف بحاجة مطابقة" value={String(pendingStatements.length)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link href="/banking/accounts" className="rounded-lg bg-white p-5 shadow-sm transition hover:shadow-md">
          <Building2 className="mb-3 h-6 w-6 text-brand" />
          <p className="font-semibold text-gray-950">الحسابات البنكية</p>
          <p className="mt-1 text-sm text-gray-500">إنشاء وإدارة الحسابات البنكية وربطها بدليل الحسابات</p>
        </Link>
        <Link href="/banking/statements" className="rounded-lg bg-white p-5 shadow-sm transition hover:shadow-md">
          <FileText className="mb-3 h-6 w-6 text-brand" />
          <p className="font-semibold text-gray-950">كشوف الحساب</p>
          <p className="mt-1 text-sm text-gray-500">استيراد كشوف البنك ومطابقتها مع القيود</p>
        </Link>
        <Link href="/banking/reconciliation" className="rounded-lg bg-white p-5 shadow-sm transition hover:shadow-md">
          <GitCompare className="mb-3 h-6 w-6 text-brand" />
          <p className="font-semibold text-gray-950">المطابقة البنكية</p>
          <p className="mt-1 text-sm text-gray-500">إعداد واعتماد تقارير المطابقة البنكية</p>
        </Link>
      </div>
    </div>
  );
}
