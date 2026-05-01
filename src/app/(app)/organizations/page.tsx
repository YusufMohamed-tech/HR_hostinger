"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteOrganization } from "@/lib/services/organizations";
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
import { useOrganizations } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddOrganizationDialog } from "@/components/forms/AddOrganizationDialog";

export default function OrganizationsPage() {
  const { currentUser } = useRoleContext();
  const { data: organizations, loading, refetch } = useOrganizations();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading organizations...</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-gray-500 text-sm mt-1">
            Multi-tenant workspace setup and company provisioning.
          </p>
        </div>

        {currentUser?.role === "Super Admin" && (
          <AddOrganizationDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Organization</TableHead>
                <TableHead className="font-semibold text-gray-600">Plan</TableHead>
                <TableHead className="font-semibold text-gray-600">Users</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{org.name}</span>
                      <span className="text-xs text-gray-400">{org.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600">{org.plan}</TableCell>
                  <TableCell className="text-gray-600">{org.users}</TableCell>
                  <TableCell>
                    <Badge className={org.status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {org.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark">Manage</Button>
                      {currentUser?.role === "Super Admin" && (
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={async () => { if (!confirm(`Delete ${org.name}?`)) return; await deleteOrganization(org.id); refetch(); }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
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
