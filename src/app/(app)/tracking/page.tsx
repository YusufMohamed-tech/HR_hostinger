"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrackingAlerts, useLocations } from "@/hooks/use-data";

export default function TrackingPage() {
  const { data: trackingAlerts, loading: loadingAlerts } = useTrackingAlerts();
  const { data: locations, loading: loadingLocations } = useLocations();

  if (loadingAlerts || loadingLocations) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">Loading tracking...</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tracking and Geofencing</h1>
        <p className="text-gray-500 text-sm mt-1">
          Monitor GPS readiness, geofence health, and shift location events.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Live Map Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] rounded-xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-sm text-gray-400">
              Map placeholder for geofencing
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Tracking Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {trackingAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{alert.issue}</p>
                  <p className="text-xs text-gray-500">{alert.location}</p>
                </div>
                <Badge className={alert.severity === "Medium" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}>
                  {alert.severity}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Location Readiness</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {locations.map((location) => (
            <div key={location.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="font-semibold text-gray-900">{location.name}</p>
              <p className="text-xs text-gray-500">{location.city}</p>
              <Badge className={location.geofence === "Enabled" ? "bg-green-50 text-green-700 border-green-200 mt-3" : "bg-amber-50 text-amber-700 border-amber-200 mt-3"}>
                {location.geofence}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
