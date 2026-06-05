"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { SalesReportTable } from "@/components/sales/SalesReportTable";
import { getSalesReports, type SalesAgent, type SalesLog, type SalesProduct } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} جنيه`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function SalesReportsPage() {
  const [logs, setLogs] = useState<SalesLog[]>([]);
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ agent: "", product: "", status: "", date_from: "", date_to: "" });

  const load = async (nextFilters = filters) => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const result = await getSalesReports(params);
    if (result.error || !result.data) setMessage(result.error || "تعذر تحميل التقارير.");
    else {
      setLogs(result.data.logs);
      setAgents(result.data.agents);
      setProducts(result.data.products);
    }
    setLoading(false);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const initial = {
      agent: url.searchParams.get("agent") || "",
      product: url.searchParams.get("product") || "",
      status: url.searchParams.get("status") || "",
      date_from: url.searchParams.get("date_from") || url.searchParams.get("date") || "",
      date_to: url.searchParams.get("date_to") || url.searchParams.get("date") || "",
    };
    setFilters(initial);
    load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const totalRevenue = logs.reduce((sum, log) => sum + Number(log.grand_total || 0), 0);
    const totalDiscount = logs.reduce((sum, log) => sum + Number(log.total_discount || 0), 0);
    const productTotals = new Map<string, { name: string; total: number; quantity: number }>();
    logs.forEach((log) => {
      (Array.isArray(log.items) ? log.items : []).forEach((item) => {
        const key = item.product_id || item.product_name;
        const current = productTotals.get(key) || { name: item.product_name, total: 0, quantity: 0 };
        current.total += Number(item.line_total || 0);
        current.quantity += Number(item.quantity || 0);
        productTotals.set(key, current);
      });
    });
    const topProduct = Array.from(productTotals.values()).sort((a, b) => b.total - a.total)[0];
    return { totalRevenue, totalDiscount, topProduct, transactions: logs.length };
  }, [logs]);

  const exportPdf = () => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
    if (!popup) {
      setMessage("تم حظر النافذة المنبثقة. يرجى السماح للموقع بفتح نوافذ جديدة من إعدادات المتصفح.");
      return;
    }

    const rows = logs.flatMap((log) => {
      const agentName = log.agent?.full_name || log.agent?.email || "بائع";
      return (Array.isArray(log.items) ? log.items : []).map((item) => `
        <tr>
          <td>${escapeHtml(log.log_date)}</td>
          <td>${escapeHtml(agentName)}</td>
          <td>${escapeHtml(item.product_name)}</td>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${escapeHtml(formatMoney(item.unit_price))}</td>
          <td>${escapeHtml(formatMoney(item.discount_amount))}</td>
          <td>${escapeHtml(formatMoney(item.line_total))}</td>
        </tr>
      `);
    }).join("");

    popup.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>تقرير المبيعات</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, Tahoma, sans-serif; color: #111827; margin: 0; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .muted { color: #6b7280; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
    .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; background: #f9fafb; }
    .box span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: right; font-size: 11px; }
    th { background: #eef2f7; }
    .actions { margin-bottom: 12px; }
    button { background: #58B145; color: white; border: 0; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
    @media print { .actions { display: none; } }
  </style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">طباعة / تنزيل PDF</button></div>
  <h1>تقرير المبيعات</h1>
  <div class="muted">الشركة: تطوير تالنت | الفترة: ${escapeHtml(filters.date_from || "البداية")} إلى ${escapeHtml(filters.date_to || "اليوم")} | تاريخ التصدير: ${escapeHtml(new Date().toLocaleString("ar-EG"))}</div>
  <div class="summary">
    <div class="box"><span>إجمالي الإيراد</span><strong>${escapeHtml(formatMoney(summary.totalRevenue))}</strong></div>
    <div class="box"><span>إجمالي الخصومات</span><strong>${escapeHtml(formatMoney(summary.totalDiscount))}</strong></div>
    <div class="box"><span>عدد التقارير</span><strong>${summary.transactions}</strong></div>
    <div class="box"><span>أفضل منتج</span><strong>${escapeHtml(summary.topProduct?.name || "-")}</strong></div>
  </div>
  <table>
    <thead><tr><th>التاريخ</th><th>البائع</th><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">لا توجد بيانات.</td></tr>'}</tbody>
    <tfoot><tr><th colspan="5">الإجماليات</th><th>${escapeHtml(formatMoney(summary.totalDiscount))}</th><th>${escapeHtml(formatMoney(summary.totalRevenue))}</th></tr></tfoot>
  </table>
</body>
</html>`);
    popup.document.close();
    popup.focus();
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">تقارير المبيعات</h1>
          <p className="mt-2 text-gray-500">عرض وتحليل كل تقارير فريق المبيعات.</p>
        </div>
        <Button variant="outline" onClick={exportPdf}>
          <Download className="ml-2 h-4 w-4" />
          تصدير PDF
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="grid gap-4 p-5 md:grid-cols-5">
          <Filter className="hidden h-5 w-5 self-end text-gray-400 md:block" />
          <div className="space-y-2">
            <Label>البائع</Label>
            <select className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm" value={filters.agent} onChange={(e) => setFilters((p) => ({ ...p, agent: e.target.value }))}>
              <option value="">الكل</option>
              {agents.filter((agent) => agent.role === "sales").map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.full_name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>المنتج</Label>
            <select className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm" value={filters.product} onChange={(e) => setFilters((p) => ({ ...p, product: e.target.value }))}>
              <option value="">الكل</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>من تاريخ</Label>
            <Input type="date" value={filters.date_from} onChange={(e) => setFilters((p) => ({ ...p, date_from: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>إلى تاريخ</Label>
            <Input type="date" value={filters.date_to} onChange={(e) => setFilters((p) => ({ ...p, date_to: e.target.value }))} />
          </div>
          <Button className="self-end bg-brand text-white hover:bg-brand-dark" onClick={() => load(filters)}>
            تطبيق
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="إجمالي الإيراد" value={formatMoney(summary.totalRevenue)} />
        <Summary title="إجمالي الخصومات" value={formatMoney(summary.totalDiscount)} />
        <Summary title="عدد التقارير" value={String(summary.transactions)} />
        <Summary title="أفضل منتج" value={summary.topProduct?.name || "-"} />
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <SalesReportTable logs={logs} expanded />
          {logs.length === 0 && <div className="py-10 text-center text-sm text-gray-500">لا توجد تقارير مطابقة للفلاتر الحالية.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs text-gray-500">{title}</p>
        <p className="mt-2 font-bold text-gray-950">{value}</p>
      </CardContent>
    </Card>
  );
}
