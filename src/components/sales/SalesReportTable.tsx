"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SalesLog, SalesLogItem } from "@/lib/services/sales";

function formatMoney(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} جنيه`;
}

function itemsOf(log: SalesLog) {
  return Array.isArray(log.items) ? log.items : [];
}

export function SalesReportTable({ logs, expanded = false }: { logs: SalesLog[]; expanded?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50/50">
          <TableHead>التاريخ</TableHead>
          <TableHead>البائع</TableHead>
          <TableHead>المنتجات</TableHead>
          <TableHead>الخصم</TableHead>
          <TableHead>الإجمالي</TableHead>
          <TableHead>الحالة</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => {
          const items = itemsOf(log);
          return (
            <React.Fragment key={log.id}>
              <TableRow>
                <TableCell>{log.log_date}</TableCell>
                <TableCell>{log.agent?.full_name || log.agent?.email || "بائع"}</TableCell>
                <TableCell>{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} عنصر</TableCell>
                <TableCell className="text-red-600">{formatMoney(log.total_discount)}</TableCell>
                <TableCell className="font-semibold text-brand-dark">{formatMoney(log.grand_total)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={log.status === "reviewed" ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                    {log.status === "reviewed" ? "تمت المراجعة" : "مرسل"}
                  </Badge>
                </TableCell>
              </TableRow>
              {expanded && items.length > 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="bg-gray-50/50">
                    <div className="grid gap-2">
                      {items.map((item: SalesLogItem, index) => (
                        <div key={`${log.id}-${item.product_id}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm md:grid-cols-6">
                          <span className="font-medium md:col-span-2">{item.product_name}</span>
                          <span>الكمية: {item.quantity}</span>
                          <span>السعر: {formatMoney(item.unit_price)}</span>
                          <span>الخصم: {item.discount_percent}%</span>
                          <span className="font-semibold">{formatMoney(item.line_total)}</span>
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
  );
}
