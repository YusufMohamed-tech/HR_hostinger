"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrackingAlerts, useLocations } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";
import { MapPin, Wifi, WifiOff } from "lucide-react";

export default function TrackingPage() {
  const { data: trackingAlerts, loading: loadingAlerts } = useTrackingAlerts();
  const { data: locations, loading: loadingLocations } = useLocations();

  if (loadingAlerts || loadingLocations) {
    return <PageSkeleton />;
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
            <div className="h-[280px] rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
                <MapPin className="h-6 w-6 text-brand" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Map integration coming soon</p>
                <p className="text-xs text-gray-400 mt-1">GPS tracking will be visualized here</p>
              </div>
              <div className="flex gap-2 mt-2">
                {locations.slice(0, 3).map((loc) => (
                  <span key={loc.id} className="text-[10px] bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-500 shadow-sm">
                    📍 {loc.name}
                  </span>
                ))}
              </div>
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
                <Badge variant="outline" className={alert.severity === "Medium" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}>
                  {alert.severity}
                </Badge>
              </div>
            ))}
            {trackingAlerts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Wifi className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No tracking alerts</p>
              </div>
            )}
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
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-900">{location.name}</p>
                {location.geofence === "Enabled" ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                  <WifiOff className="h-4 w-4 text-amber-500" />
                )}
              </div>
              <p className="text-xs text-gray-500">{location.city}</p>
              <Badge variant="outline" className={location.geofence === "Enabled" ? "bg-green-50 text-green-700 border-green-200 mt-3" : "bg-amber-50 text-amber-700 border-amber-200 mt-3"}>
                {location.geofence}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
