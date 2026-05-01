"use client";

import React from "react";
import Link from "next/link";
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
import { useEvents } from "@/hooks/use-data";

const typeStyles: Record<string, string> = {
  "Check-in": "bg-green-50 text-green-700 border-green-200",
  Movement: "bg-blue-50 text-blue-700 border-blue-200",
  Sales: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function EventsPage() {
  const { data: events, loading } = useEvents();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading events...</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Stream</h1>
        <p className="text-gray-500 text-sm mt-1">
          Real-time actions captured across shifts and locations.
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Type</TableHead>
                <TableHead className="font-semibold text-gray-600">Employee</TableHead>
                <TableHead className="font-semibold text-gray-600">Location</TableHead>
                <TableHead className="font-semibold text-gray-600">Time</TableHead>
                <TableHead className="font-semibold text-gray-600">Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Badge className={typeStyles[event.type] || "bg-gray-100 text-gray-600 border-gray-200"}>
                      {event.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-700">{event.employee}</TableCell>
                  <TableCell className="text-gray-600">{event.location}</TableCell>
                  <TableCell className="text-gray-600">{event.time}</TableCell>
                  <TableCell className="text-gray-500 text-xs">
                    <Link href={`/events/${event.id}`} className="text-brand hover:text-brand-dark">
                      {event.payload}
                    </Link>
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
