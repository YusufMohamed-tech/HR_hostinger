"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmployees, useEvents } from "@/hooks/use-data";

export default function EmployeeDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: employees } = useEmployees();
  const { data: events } = useEvents();
  const employee = employees.find((item: Record<string, unknown>) => item.id === id);
  const employeeEvents = events.filter((event: Record<string, unknown>) => event.employee === (employee as Record<string, unknown>)?.name).slice(0, 3);

  if (!employee) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Employee not found</h1>
        <Button asChild variant="outline">
          <Link href="/employees">Back to employees</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Employee profile and performance summary.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/employees">Back to employees</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="font-medium text-gray-900">{employee.email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="font-medium text-gray-900">{employee.phone}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <Badge variant="outline" className={employee.status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                {employee.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Role</p>
              <p className="font-medium text-gray-900">{employee.role}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Department</p>
              <p className="font-medium text-gray-900">{employee.department}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Location</p>
              <p className="font-medium text-gray-900">{employee.location}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs text-gray-500">Manager</p>
              <p className="font-medium text-gray-900">{employee.manager}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Hire Date</p>
              <p className="font-medium text-gray-900">{employee.hireDate}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Contract</p>
              <p className="font-medium text-gray-900">{employee.contract}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {employeeEvents.length === 0 && (
            <p className="text-sm text-gray-500">No events recorded for this employee.</p>
          )}
          {employeeEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{event.type}</p>
                <p className="text-xs text-gray-500">{event.location}</p>
              </div>
              <div className="text-xs text-gray-400">{event.time}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
