"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CalendarIcon, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleContext } from "@/providers/RoleProvider";

const scheduleData = [
  { id: 1, name: "Ahmed Youssef", role: "Employee", mon: "8AM - 4PM", tue: "8AM - 4PM", wed: "Off", thu: "10AM - 6PM", fri: "10AM - 6PM" },
  { id: 2, name: "Tariq Ali", role: "Employee", mon: "Off", tue: "12PM - 8PM", wed: "12PM - 8PM", thu: "12PM - 8PM", fri: "12PM - 8PM" },
  { id: 3, name: "Omar Zaid", role: "Employee", mon: "6AM - 2PM", tue: "6AM - 2PM", wed: "6AM - 2PM", thu: "6AM - 2PM", fri: "Off" },
];

export default function SchedulePage() {
  const { currentUser } = useRoleContext();
  const [view, setView] = useState("Weekly");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roster & Scheduling</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assign shifts, monitor availability, and prevent conflicts.
          </p>
        </div>

        {["Super Admin", "Admin", "Team Leader"].includes(currentUser?.role ?? "") && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button asChild variant="outline">
              <Link href="/schedule/builder">Open Shift Builder</Link>
            </Button>
            <Button className="bg-brand hover:bg-brand-dark text-white">
              <Plus className="w-4 h-4 mr-2" />
              Create Shift
            </Button>
          </div>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row p-4 border-b gap-4 items-center justify-between bg-white">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:bg-white hover:shadow-sm">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium px-2 text-gray-700 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-brand" />
                  May 1 - May 7, 2026
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:bg-white hover:shadow-sm">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
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
                  <th className="px-4 py-4 border-b text-center min-w-[120px]">
                    <div className="flex flex-col"><span className="text-xs text-gray-400">MON</span><span>May 1</span></div>
                  </th>
                  <th className="px-4 py-4 border-b text-center min-w-[120px]">
                    <div className="flex flex-col"><span className="text-xs text-gray-400">TUE</span><span>May 2</span></div>
                  </th>
                  <th className="px-4 py-4 border-b text-center min-w-[120px]">
                    <div className="flex flex-col"><span className="text-xs text-gray-400">WED</span><span>May 3</span></div>
                  </th>
                  <th className="px-4 py-4 border-b text-center min-w-[120px]">
                    <div className="flex flex-col"><span className="text-xs text-gray-400">THU</span><span>May 4</span></div>
                  </th>
                  <th className="px-4 py-4 border-b text-center min-w-[120px]">
                    <div className="flex flex-col"><span className="text-xs text-gray-400">FRI</span><span>May 5</span></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {scheduleData.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/30 transition-colors">
                    <td className="px-6 py-4 border-r bg-white font-medium text-gray-900 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      {row.name}
                      <div className="text-xs font-normal text-gray-400 mt-1">{row.role}</div>
                    </td>
                    {[row.mon, row.tue, row.wed, row.thu, row.fri].map((shift, i) => (
                      <td key={i} className="px-2 py-4 border-r border-dashed last:border-r-0">
                        {shift === "Off" ? (
                          <div className="text-center text-gray-400 font-medium bg-gray-50 rounded-md py-2 border border-gray-100">
                            Off
                          </div>
                        ) : (
                          <div className="text-center font-semibold text-brand-dark bg-brand-light/30 rounded-md py-2 border border-brand/20 hover:bg-brand-light/60 transition-colors cursor-pointer group relative">
                            {shift}
                            <div className="absolute inset-0 bg-brand/5 items-center justify-center rounded-md hidden group-hover:flex">
                              <Plus className="w-4 h-4 text-brand" />
                            </div>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
