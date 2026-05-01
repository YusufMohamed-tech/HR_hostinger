"use client";

import React from "react";
import { Button } from "@/components/ui/button";
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

export default function DepartmentsPage() {
  const { currentUser } = useRoleContext();
  const { data: departments, loading, refetch } = useDepartments();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading departments...</div>;
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
                    <Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark">
                      View
                    </Button>
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
