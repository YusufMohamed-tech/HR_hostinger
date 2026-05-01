"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteContract } from "@/lib/services/contracts";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useContracts } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddContractDialog } from "@/components/forms/AddContractDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function ContractsPage() {
  const { currentUser } = useRoleContext();
  const { data: contracts, loading, refetch } = useContracts();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
          <p className="text-gray-500 text-sm mt-1">
            Track employee agreements, expirations, and salary terms.
          </p>
        </div>

        {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
          <AddContractDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Role</TableHead>
                <TableHead className="font-semibold text-gray-600">Start</TableHead>
                <TableHead className="font-semibold text-gray-600">End</TableHead>
                <TableHead className="font-semibold text-gray-600">Salary</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{contract.employee}</span>
                      <span className="text-xs text-gray-400">{contract.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600">{contract.role}</TableCell>
                  <TableCell className="text-gray-600">{contract.start}</TableCell>
                  <TableCell className="text-gray-600">{contract.end}</TableCell>
                  <TableCell className="text-gray-600">{contract.salary}</TableCell>
                  <TableCell>
                    <Badge className={contract.status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {contract.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={async () => { if (!confirm(`Delete contract?`)) return; await deleteContract(contract.id, currentUser?.orgId || "", currentUser?.id); refetch(); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
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
