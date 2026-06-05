"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { getSalesHistory, type SalesLog } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} جنيه`;
}

export default function SalesHistoryPage() {
  const [logs, setLogs] = useState<SalesLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string>("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getSalesHistory().then((result) => {
      if (result.error || !result.data) setMessage(result.error || "تعذر تحميل سجل المبيعات.");
      else setLogs(result.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-950">سجل المبيعات</h1>
        <p className="mt-2 text-gray-500">تقاريرك اليومية السابقة وتفاصيل المنتجات المباعة.</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>التاريخ</TableHead>
                <TableHead>عدد العناصر</TableHead>
                <TableHead>الخصم</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const items = Array.isArray(log.items) ? log.items : [];
                const isOpen = expanded === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <TableRow>
                      <TableCell>{log.log_date}</TableCell>
                      <TableCell>{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</TableCell>
                      <TableCell className="text-red-600">{formatMoney(log.total_discount)}</TableCell>
                      <TableCell className="font-semibold text-brand-dark">{formatMoney(log.grand_total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={log.status === "reviewed" ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                          {log.status === "reviewed" ? "تمت المراجعة" : "مرسل"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? "" : log.id)}>
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-gray-50">
                          <div className="grid gap-2 md:grid-cols-2">
                            {items.map((item, index) => (
                              <div key={`${item.product_id}-${index}`} className="rounded-lg bg-white p-3 text-sm">
                                <p className="font-semibold">{item.product_name}</p>
                                <p className="mt-1 text-gray-500">
                                  {item.quantity} × {formatMoney(item.unit_price)} | خصم {item.discount_percent}%
                                </p>
                                <p className="mt-1 font-semibold text-brand-dark">{formatMoney(item.line_total)}</p>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
          {logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-900">لا توجد تقارير مبيعات بعد</p>
              <p className="mt-1 text-sm text-gray-500">عند إرسال تقرير يومي سيظهر هنا.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
