"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuditLogs } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";

export default function AuditLogsPage() {
  const { data: auditLogs, loading } = useAuditLogs();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-gray-500 text-sm mt-1">
          Full history of actions across the organization.
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Actor</TableHead>
                <TableHead className="font-semibold text-gray-600">Action</TableHead>
                <TableHead className="font-semibold text-gray-600">Entity</TableHead>
                <TableHead className="font-semibold text-gray-600">Time</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium text-gray-900">{log.actor}</TableCell>
                  <TableCell className="text-gray-600">{log.action}</TableCell>
                  <TableCell className="text-gray-600">{log.entity}</TableCell>
                  <TableCell className="text-gray-600">{log.time}</TableCell>
                  <TableCell>
                    <Badge className="bg-green-50 text-green-700 border-green-200">{log.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/audit-logs/${log.id}`} className="text-brand hover:text-brand-dark text-sm">
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
