"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountingPageHeader, AccountingLoading } from "@/components/accounting/AccountingPrimitives";
import { getAllPermissions, grantPermission, revokePermission } from "@/lib/services/accounting";

const ROLES = [
  { key: "finance_manager", label: "مدير المالية" },
  { key: "accountant", label: "محاسب" },
  { key: "finance_viewer", label: "مشاهد مالي" },
  { key: "sales_manager", label: "مدير المبيعات" },
  { key: "sales", label: "مبيعات" },
];

const PERMISSIONS = [
  { key: "customers:view", label: "عرض العملاء" },
  { key: "customers:create", label: "إنشاء عميل" },
  { key: "customers:edit", label: "تعديل عميل" },
  { key: "customers:delete", label: "حذف عميل" },
  { key: "vendors:view", label: "عرض الموردين" },
  { key: "vendors:create", label: "إنشاء مورد" },
  { key: "vendors:edit", label: "تعديل مورد" },
  { key: "vendors:delete", label: "حذف مورد" },
];

export default function PermissionsPage() {
  const [permData, setPermData] = useState<Array<{ role: string; permission: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getAllPermissions();
    setPermData(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasPerm = (role: string, permission: string) =>
    permData.some((p) => p.role === role && p.permission === permission);

  const toggle = async (role: string, permission: string) => {
    if (hasPerm(role, permission)) {
      await revokePermission(role, permission);
    } else {
      await grantPermission(role, permission);
    }
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        title="صلاحيات العملاء والموردين"
        description="تحديد الأدوار التي يمكنها إنشاء وتعديل وحذف العملاء والموردين."
      />

      <Card className="border-none shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky right-0 bg-white">الدور</TableHead>
                {PERMISSIONS.map((p) => (
                  <TableHead key={p.key} className="text-center text-xs whitespace-nowrap">{p.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES.map((role) => (
                <TableRow key={role.key}>
                  <TableCell className="sticky right-0 bg-white font-medium">{role.label}</TableCell>
                  {PERMISSIONS.map((perm) => (
                    <TableCell key={perm.key} className="text-center">
                      <input
                        type="checkbox"
                        checked={hasPerm(role.key, perm.key)}
                        onChange={() => toggle(role.key, perm.key)}
                        className="h-4 w-4 accent-brand"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
