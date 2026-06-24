"use client";

import React from "react";
import { CircleDollarSign, FileSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";

export function MoneyAmount({ value, className }: { value: unknown; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatCurrency(value)}</span>;
}

export function AccountingPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-950">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AccountingStatCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  helper?: string;
  tone?: "default" | "green" | "red" | "blue" | "amber";
}) {
  const tones = {
    default: "text-gray-950",
    green: "text-green-700",
    red: "text-red-700",
    blue: "text-blue-700",
    amber: "text-amber-700",
  };
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <div className={cn("mt-2 text-xl font-bold", tones[tone])}>{value}</div>
        {helper ? <p className="mt-1 text-xs text-gray-400">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AccountingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "مسودة", className: "bg-gray-50 text-gray-700 border-gray-200" },
    pending_approval: { label: "بانتظار الاعتماد", className: "bg-amber-50 text-amber-700 border-amber-200" },
    posted: { label: "مرحل", className: "bg-green-50 text-green-700 border-green-200" },
    reversed: { label: "معكوس", className: "bg-purple-50 text-purple-700 border-purple-200" },
    cancelled: { label: "ملغي", className: "bg-red-50 text-red-700 border-red-200" },
    approved: { label: "معتمد", className: "bg-blue-50 text-blue-700 border-blue-200" },
    rejected: { label: "مرفوض", className: "bg-red-50 text-red-700 border-red-200" },
    paid: { label: "مدفوع", className: "bg-green-50 text-green-700 border-green-200" },
    issued: { label: "مصدرة", className: "bg-blue-50 text-blue-700 border-blue-200" },
    partially_paid: { label: "مدفوعة جزئيا", className: "bg-amber-50 text-amber-700 border-amber-200" },
    unpaid: { label: "غير مدفوع", className: "bg-amber-50 text-amber-700 border-amber-200" },
    active: { label: "نشط", className: "bg-green-50 text-green-700 border-green-200" },
    inactive: { label: "غير نشط", className: "bg-gray-50 text-gray-700 border-gray-200" },
  };
  const item = map[status] || { label: status || "-", className: "bg-gray-50 text-gray-700 border-gray-200" };
  return <Badge variant="outline" className={item.className}>{item.label}</Badge>;
}

export function AccountingEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
        <FileSearch className="h-6 w-6" />
      </div>
      <p className="font-semibold text-gray-950">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function AccountingLoading() {
  return (
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="h-64 animate-pulse rounded-lg bg-white shadow-sm" />
    </div>
  );
}

export function ExportCsvButton({
  rows,
  filename,
}: {
  rows: Record<string, unknown>[];
  filename: string;
}) {
  const exportCsv = () => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
      <CircleDollarSign className="ml-2 h-4 w-4" />
      تصدير CSV
    </Button>
  );
}
