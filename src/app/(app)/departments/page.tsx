"use client";

import React from "react";
import { Trash2, Layers as LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteDepartment } from "@/lib/services/departments";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDepartments } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddDepartmentDialog } from "@/components/forms/AddDepartmentDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function DepartmentsPage() {
  const { currentUser } = useRoleContext();
  const { data: departments, loading, refetch } = useDepartments();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
          <p className="text-gray-500 text-sm mt-1">
            Define teams, leadership, and coverage needs.
          </p>
        </div>

        {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
          <AddDepartmentDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Department</TableHead>
                <TableHead className="font-semibold text-gray-600">Department Head</TableHead>
                <TableHead className="font-semibold text-gray-600">Headcount</TableHead>
                <TableHead className="font-semibold text-gray-600">Locations</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{dept.name}</span>
                      <span className="text-xs text-gray-400">{dept.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600">{dept.head}</TableCell>
                  <TableCell className="text-gray-600">{dept.headcount}</TableCell>
                  <TableCell className="text-gray-600">{dept.locations}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark">View</Button>
                      {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={async () => { if (!confirm(`Delete ${dept.name}?`)) return; await deleteDepartment(dept.id, currentUser?.orgId || "", currentUser?.id); refetch(); }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {departments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <LayersIcon className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No departments yet</p>
              <p className="text-xs text-gray-500 mt-1">Create your first department to organize teams.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
