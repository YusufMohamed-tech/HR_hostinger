"use client";

import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { SalesReportTable } from "@/components/sales/SalesReportTable";
import { getSalesHistory, type SalesLog } from "@/lib/services/sales";
import { PageSkeleton } from "@/components/Skeletons";

export default function SalesHistoryPage() {
  const [logs, setLogs] = useState<SalesLog[]>([]);
  const [loading, setLoading] = useState(true);
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
        <p className="mt-2 text-gray-500">كل تسجيلاتك السابقة حسب الشركة والمنتجات المباعة.</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {logs.length > 0 ? (
            <SalesReportTable logs={logs} expanded />
          ) : (
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
