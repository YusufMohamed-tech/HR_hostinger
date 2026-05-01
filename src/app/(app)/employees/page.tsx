"use client";

import React from "react";
import Link from "next/link";
import { Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useRoleContext } from "@/providers/RoleProvider";
import { useEmployees } from "@/hooks/use-data";
import { AddEmployeeDialog } from "@/components/forms/AddEmployeeDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function EmployeesPage() {
  const { currentUser } = useRoleContext();
  const { data: employees, loading, refetch } = useEmployees();

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage your workforce, roles, and departmental assignments.
          </p>
        </div>

        {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
          <AddEmployeeDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row p-4 border-b gap-4 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input
                type="search"
                placeholder="Search employees..."
                className="pl-9 bg-gray-50 border-gray-200 focus-visible:ring-brand"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto text-gray-600">
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Employee Details</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="font-semibold text-gray-600">Role</TableHead>
                <TableHead className="font-semibold text-gray-600">Department</TableHead>
                <TableHead className="font-semibold text-gray-600">Primary Location</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{emp.name}</span>
                      <span className="text-xs text-gray-500">{emp.email}</span>
                      <span className="text-xs text-gray-400 mt-0.5">{emp.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        emp.status === "Active"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }
                    >
                      {emp.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600">{emp.role}</TableCell>
                  <TableCell className="text-gray-600">{emp.department}</TableCell>
                  <TableCell className="text-gray-600">{emp.location}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm" className="text-brand hover:text-brand-dark">
                      <Link href={`/employees/${emp.id}`}>View</Link>
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
