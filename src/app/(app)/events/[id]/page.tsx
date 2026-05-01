"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { events } from "@/data/mock";

export default function EventDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const event = events.find((item) => item.id === id);

  if (!event) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Event not found</h1>
        <Button asChild variant="outline">
          <Link href="/events">Back to events</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Event {event.id}</h1>
          <p className="text-gray-500 text-sm mt-1">Detailed payload and audit context.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/events">Back to events</Link>
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Event Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Type</p>
            <Badge className="mt-2 bg-brand-light text-brand-dark border-brand/20">{event.type}</Badge>
          </div>
          <div>
            <p className="text-xs text-gray-500">Timestamp</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{event.time}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Employee</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{event.employee}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Location</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{event.location}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-600">
            {event.payload}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
