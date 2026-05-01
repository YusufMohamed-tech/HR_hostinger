"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditLogs } from "@/data/mock";

export default function AuditLogDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const log = auditLogs.find((item) => item.id === id);

  if (!log) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Audit log not found</h1>
        <Button asChild variant="outline">
          <Link href="/audit-logs">Back to audit logs</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit {log.id}</h1>
          <p className="text-gray-500 text-sm mt-1">Detailed record of system actions.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/audit-logs">Back to audit logs</Link>
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Log Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-gray-500">Actor</p>
            <p className="font-medium text-gray-900">{log.actor}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Action</p>
            <p className="font-medium text-gray-900">{log.action}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Entity</p>
            <p className="font-medium text-gray-900">{log.entity}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Time</p>
            <p className="font-medium text-gray-900">{log.time}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Status</p>
            <Badge className="bg-green-50 text-green-700 border-green-200">{log.status}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Old vs New Values</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-600">
            Mock payload diff will appear here once audit pipeline is connected.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
