"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SalesLog, SalesLogEditRequest, SalesLogItem } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";

function itemsOf(log: SalesLog) {
  return Array.isArray(log.items) ? log.items : [];
}

function editRequestsOf(log: SalesLog): SalesLogEditRequest[] {
  return Array.isArray(log.edit_requests) ? log.edit_requests : [];
}

function statusLabel(status: string) {
  return status === "reviewed" ? "تمت المراجعة" : "مرسل";
}

function editRequestStatusLabel(status: string) {
  if (status === "pending") return "طلب تعديل قيد المراجعة";
  if (status === "applied") return "تم تطبيق التعديل";
  if (status === "rejected") return "تم رفض التعديل";
  return status || "طلب تعديل";
}

export function SalesReportTable({
  logs,
  expanded = false,
  onRequestEdit,
  onResolveEditRequest,
}: {
  logs: SalesLog[];
  expanded?: boolean;
  onRequestEdit?: (log: SalesLog) => void;
  onResolveEditRequest?: (log: SalesLog, request: SalesLogEditRequest) => void;
}) {
  const hasActions = Boolean(onRequestEdit);

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
          {hasActions && <TableHead>الإجراءات</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => {
          const items = itemsOf(log);
          const editRequests = editRequestsOf(log);
          const hasPendingEditRequest = editRequests.some((request) => request.status === "pending");

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
                {hasActions && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRequestEdit?.(log)}
                      disabled={hasPendingEditRequest}
                    >
                      {hasPendingEditRequest ? "طلب تعديل مرسل" : "طلب تعديل"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
              {expanded && (items.length > 0 || editRequests.length > 0) && (
                <TableRow>
                  <TableCell colSpan={hasActions ? 8 : 7} className="bg-gray-50/50">
                    <div className="grid gap-3">
                      {items.map((item: SalesLogItem, index) => (
                        <div key={`${log.id}-${item.product_id}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm md:grid-cols-6">
                          <span className="font-medium md:col-span-2">{item.product_name}</span>
                          <span>الكمية: {item.quantity}</span>
                          <span>السعر: {formatCurrency(item.unit_price)}</span>
                          <span>الخصم: {item.discount_percent}%</span>
                          <span className="font-semibold">{formatCurrency(item.line_total)}</span>
                        </div>
                      ))}
                      {editRequests.map((request) => (
                        <div key={request.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-amber-300 bg-white text-amber-700">
                              {editRequestStatusLabel(request.status)}
                            </Badge>
                            <span className="text-xs text-amber-700">{request.created_at?.slice(0, 16).replace("T", " ")}</span>
                          </div>
                          <p className="leading-6">{request.requested_changes}</p>
                          {request.status === "pending" && onResolveEditRequest && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3 bg-white"
                              onClick={() => onResolveEditRequest(log, request)}
                            >
                              مراجعة الطلب
                            </Button>
                          )}
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
