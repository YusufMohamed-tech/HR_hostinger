"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SalesLog, SalesLogItem } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";

function itemsOf(log: SalesLog) {
  return Array.isArray(log.items) ? log.items : [];
}

function statusLabel(status: string) {
  return status === "reviewed" ? "تمت المراجعة" : "مرسل";
}

export function SalesReportTable({ logs, expanded = false }: { logs: SalesLog[]; expanded?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50/50">
          <TableHead>التاريخ</TableHead>
          <TableHead>الشركة</TableHead>
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
                <TableCell>
                  <div className="flex items-center gap-2">
                    {log.company?.brand_color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: log.company.brand_color }} />}
                    <span>{log.company?.name || "-"}</span>
                  </div>
                </TableCell>
                <TableCell>{log.agent?.full_name || log.agent?.email || "بائع"}</TableCell>
                <TableCell>{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} قطعة</TableCell>
                <TableCell className="text-red-600">{formatCurrency(log.total_discount)}</TableCell>
                <TableCell className="font-semibold text-brand-dark">{formatCurrency(log.grand_total)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={log.status === "reviewed" ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                    {statusLabel(log.status)}
                  </Badge>
                </TableCell>
              </TableRow>
              {expanded && items.length > 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-gray-50/50">
                    <div className="grid gap-2">
                      {items.map((item: SalesLogItem, index) => (
                        <div key={`${log.id}-${item.product_id}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm md:grid-cols-6">
                          <span className="font-medium md:col-span-2">{item.product_name}</span>
                          <span>الكمية: {item.quantity}</span>
                          <span>السعر: {formatCurrency(item.unit_price)}</span>
                          <span>الخصم: {item.discount_percent}%</span>
                          <span className="font-semibold">{formatCurrency(item.line_total)}</span>
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
