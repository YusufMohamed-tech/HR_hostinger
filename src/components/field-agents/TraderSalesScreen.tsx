"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BadgePercent, CreditCard, RefreshCcw, Search, Smartphone, Store, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getTraderSales } from "@/lib/services/merchants";
import type { TraderSaleRecord } from "@/types/merchants";

type Message = { tone: "success" | "error"; text: string } | null;

function rows<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "0"} ر.س`;
}

function MessageBanner({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        message.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {message.text}
    </div>
  );
}

function Detail({ label, value, dir }: { label: string; value: unknown; dir?: "rtl" | "ltr" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950" dir={dir}>
        {value ? String(value) : "-"}
      </p>
    </div>
  );
}

export function TraderSalesScreen() {
  const [sales, setSales] = useState<TraderSaleRecord[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    setMessage(null);
    getTraderSales().then((result) => {
      if (result.error) setMessage({ tone: "error", text: result.error.message });
      else setSales(rows(result.data));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((sale) =>
      [
        sale.customer_name,
        sale.customer_national_id,
        sale.customer_absher_mobile,
        sale.customer_email,
        sale.sim_iccid,
        sale.device_serial,
        sale.package_reference,
        sale.package_name,
        sale.merchant_name,
        sale.agent_name,
        sale.city_district,
        sale.national_address,
        sale.supervisor_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [sales, search]);

  const totals = useMemo(
    () => ({
      count: sales.length,
      value: sales.reduce((sum, sale) => sum + Number(sale.sale_price || 0), 0),
      merchantCommission: sales.reduce((sum, sale) => sum + Number(sale.merchant_commission_amount || 0), 0),
      agentCommission: sales.reduce((sum, sale) => sum + Number(sale.agent_commission_amount || 0), 0),
    }),
    [sales]
  );

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">بيانات مبيعات التجار</h1>
          <p className="mt-1 text-sm text-slate-500">كل بيانات العميل والتفعيل التي يدخلها التاجر قبل إتمام البيع.</p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCcw className="ml-2 h-4 w-4" />
          تحديث
        </Button>
      </div>

      <MessageBanner message={message} />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-slate-500"><Smartphone className="h-4 w-4" />عدد المبيعات</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{totals.count}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-slate-500"><CreditCard className="h-4 w-4" />قيمة المبيعات</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{formatMoney(totals.value)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-slate-500"><BadgePercent className="h-4 w-4" />عمولات التجار</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{formatMoney(totals.merchantCommission)}</p>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-slate-500"><BadgePercent className="h-4 w-4" />عمولات المناديب</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{formatMoney(totals.agentCommission)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث باسم العميل، الهوية، ICCID، الجهاز، الباقة، التاجر، أو المشرف"
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="p-6 text-center text-sm text-slate-400">لا توجد مبيعات مطابقة.</CardContent>
          </Card>
        ) : (
          filtered.map((sale) => (
            <Card key={sale.id} className="border border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{sale.customer_name || "عميل بدون اسم"}</CardTitle>
                      <Badge className="border-0 bg-emerald-100 text-emerald-700">{formatMoney(sale.sale_price)}</Badge>
                    </div>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" />{sale.merchant_name || "-"}</span>
                      <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{sale.agent_name || "-"}</span>
                      <span dir="ltr">{new Date(sale.sold_at).toLocaleString("ar-SA")}</span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {sale.package_name || sale.package_reference || "باقة"} · <span dir="ltr">{sale.sim_iccid || "-"}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Detail label="هوية العميل" value={sale.customer_national_id} dir="ltr" />
                  <Detail label="جوال أبشر" value={sale.customer_absher_mobile} dir="ltr" />
                  <Detail label="الإيميل" value={sale.customer_email} dir="ltr" />
                  <Detail label="تاريخ الميلاد" value={sale.customer_birth_date_hijri} dir="ltr" />
                  <Detail label="تاريخ انتهاء الهوية" value={sale.customer_id_expiry_hijri} dir="ltr" />
                  <Detail label="الجنسية" value={sale.customer_nationality} />
                  <Detail label="الباقة / المرجع" value={sale.package_reference || sale.package_name} />
                  <Detail label="سيريال الشريحة" value={sale.sim_iccid} dir="ltr" />
                  <Detail label="سيريال الجهاز" value={sale.device_serial} dir="ltr" />
                  <Detail label="المدينة / الحي" value={sale.city_district} />
                  <Detail label="العنوان الوطني" value={sale.national_address} dir="ltr" />
                  <Detail label="المشرف" value={sale.supervisor_name} />
                  <Detail label="اسم المسوق" value={sale.marketer_name} />
                  <Detail label="عمولة التاجر" value={formatMoney(sale.merchant_commission_amount)} />
                  <Detail label="عمولة المندوب" value={formatMoney(sale.agent_commission_amount)} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
