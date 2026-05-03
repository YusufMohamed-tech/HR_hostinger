"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { CalendarIcon, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleContext } from "@/providers/RoleProvider";
import { useSchedule, useEmployees } from "@/hooks/use-data";
import { AddShiftDialog } from "@/components/forms/AddShiftDialog";
import { PageSkeleton } from "@/components/Skeletons";

function getWeekDates(offset: number) {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);

  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI"];

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateISO(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function SchedulePage() {
  const { currentUser } = useRoleContext();
  const { data: shifts, loading, refetch } = useSchedule();
  const { data: employees } = useEmployees();
  const [view, setView] = useState("Weekly");
  const [weekOffset, setWeekOffset] = useState(0);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Build employee-to-shift grid from real shift data
  const scheduleGrid = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employeeMap = new Map<string, any>();

    // First, add employees from shift assignments
    for (const shift of shifts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assignments = (shift as any).shift_assignments || [];
      const shiftDate = (shift as Record<string, unknown>).shift_date as string;

      for (const assignment of assignments) {
        const empName = assignment.employee?.full_name || "Unknown";
        const empRole = assignment.employee?.role || "Employee";
        const empId = assignment.employee_id;

        if (!employeeMap.has(empId)) {
          employeeMap.set(empId, { id: empId, name: empName, role: empRole, shifts: {} });
        }

        const startTime = (shift as Record<string, unknown>).start_time as string;
        const endTime = (shift as Record<string, unknown>).end_time as string;
        const startHour = startTime ? new Date(startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
        const endHour = endTime ? new Date(endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";

        employeeMap.get(empId).shifts[shiftDate] = `${startHour} - ${endHour}`;
      }
    }

    // If no real data, show employees from the employees list with empty shifts
    if (employeeMap.size === 0 && employees.length > 0) {
      for (const emp of employees.slice(0, 5)) {
        employeeMap.set(emp.id, {
          id: emp.id,
          name: emp.name || emp.full_name,
          role: emp.role || "Employee",
          shifts: {},
        });
      }
    }

    return Array.from(employeeMap.values());
  }, [shifts, employees]);

  const isAdmin = ["Super Admin", "Admin", "Team Leader"].includes(currentUser?.role ?? "");

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roster & Scheduling</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assign shifts, monitor availability, and prevent conflicts.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button asChild variant="outline">
              <Link href="/schedule/builder">Open Shift Builder</Link>
            </Button>
            <AddShiftDialog onSuccess={refetch} />
          </div>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row p-4 border-b gap-4 items-center justify-between bg-white">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:bg-white hover:shadow-sm" onClick={() => setWeekOffset((prev) => prev - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium px-2 text-gray-700 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-brand" />
                  {formatDate(weekDates[0])} - {formatDate(weekDates[4])}, {weekDates[0].getFullYear()}
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:bg-white hover:shadow-sm" onClick={() => setWeekOffset((prev) => prev + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {weekOffset !== 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-brand" onClick={() => setWeekOffset(0)}>Today</Button>
              )}
            </div>

            <Tabs value={view} onValueChange={setView} className="w-full sm:w-auto">
              <TabsList className="bg-gray-100 p-1 rounded-lg">
                <TabsTrigger value="Daily" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs">Daily</TabsTrigger>
                <TabsTrigger value="Weekly" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs">Weekly</TabsTrigger>
                <TabsTrigger value="Monthly" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-6 py-4 border-b whitespace-nowrap min-w-[200px]">Employee</th>
                  {weekDates.map((d, i) => (
                    <th key={i} className="px-4 py-4 border-b text-center min-w-[120px]">
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400">{DAY_NAMES[i]}</span>
                        <span>{formatDate(d)}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {scheduleGrid.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/30 transition-colors">
                    <td className="px-6 py-4 border-r bg-white font-medium text-gray-900 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      {row.name}
                      <div className="text-xs font-normal text-gray-400 mt-1">{row.role}</div>
                    </td>
                    {weekDates.map((d, i) => {
                      const dateStr = formatDateISO(d);
                      const shift = row.shifts[dateStr];
                      return (
                        <td key={i} className="px-2 py-4 border-r border-dashed last:border-r-0">
                          {shift ? (
                            <div className="text-center font-semibold text-brand-dark bg-brand-light/30 rounded-md py-2 border border-brand/20 hover:bg-brand-light/60 transition-colors cursor-pointer">
                              {shift}
                            </div>
                          ) : (
                            <div className="text-center text-gray-400 font-medium bg-gray-50 rounded-md py-2 border border-gray-100">
                              Off
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scheduleGrid.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No schedule data</p>
              <p className="text-xs text-gray-500 mt-1">Create shifts and assign employees to see the roster.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
