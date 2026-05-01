"use client";

import React from "react";
import Link from "next/link";
import { CalendarIcon, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { locations, employees } from "@/data/mock";

export default function ShiftBuilderPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shift Builder</h1>
          <p className="text-gray-500 text-sm mt-1">
            Configure new shifts and assign employees across locations.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/schedule">Back to schedule</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Shift Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Shift Name</Label>
                <Input placeholder="Morning Coverage" />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input type="time" defaultValue="08:00" />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input type="time" defaultValue="16:00" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" />
              </div>
              <div className="space-y-2">
                <Label>Headcount</Label>
                <Input type="number" defaultValue={12} />
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
              Conflict detection will highlight overlaps and staffing gaps once live scheduling is enabled.
            </div>

            <Button className="bg-brand hover:bg-brand-dark text-white">Save Shift</Button>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Assign Employees
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {employees.slice(0, 4).map((employee) => (
              <div key={employee.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{employee.name}</p>
                  <p className="text-xs text-gray-500">{employee.role} • {employee.location}</p>
                </div>
                <Button variant="outline" size="sm">Assign</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            Shift Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[240px] rounded-xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-sm text-gray-400">
            Shift timeline preview
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
