"use client";

import React from "react";
import { Trash2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteLocation } from "@/lib/services/locations";
import { EditLocationDialog } from "@/components/forms/EditLocationDialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocations } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddLocationDialog } from "@/components/forms/AddLocationDialog";
import { PageSkeleton } from "@/components/Skeletons";

export default function LocationsPage() {
  const { currentUser } = useRoleContext();
  const { data: locations, loading, refetch } = useLocations();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage sites, geofences, and location readiness.
          </p>
        </div>

        {currentUser?.role === "Admin" && (
          <AddLocationDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Location</TableHead>
                <TableHead className="font-semibold text-gray-600">Type</TableHead>
                <TableHead className="font-semibold text-gray-600">Manager</TableHead>
                <TableHead className="font-semibold text-gray-600">Radius</TableHead>
                <TableHead className="font-semibold text-gray-600">Coordinates</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => {
                const locationRecord = location as Record<string, unknown>;
                const locationId = String(locationRecord.id ?? "");
                const locationName = typeof locationRecord.name === "string" ? locationRecord.name : "—";
                const locationType = typeof locationRecord.type === "string" ? locationRecord.type : "branch";
                const manager = (locationRecord.manager ?? null) as Record<string, unknown> | null;
                const managerName = typeof manager?.full_name === "string" ? manager.full_name : "—";
                const radius = typeof locationRecord.radius_meters === "number" ? locationRecord.radius_meters : 100;
                const latitude = typeof locationRecord.latitude === "number" ? locationRecord.latitude : null;
                const longitude = typeof locationRecord.longitude === "number" ? locationRecord.longitude : null;
                const coordinates = latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : "—";

                return (
                  <TableRow key={locationId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{locationName}</span>
                        <span className="text-xs text-gray-400">{locationId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">{locationType}</TableCell>
                    <TableCell className="text-gray-600">{managerName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">
                        {radius}m
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{coordinates}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {currentUser?.role === "Admin" && (
                          <EditLocationDialog location={location} onSuccess={refetch} />
                        )}
                        {currentUser?.role === "Admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (!confirm(`Delete ${locationName}?`)) return;
                              await deleteLocation(locationId);
                              refetch();
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {locations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MapPin className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No locations yet</p>
              <p className="text-xs text-gray-500 mt-1">Add a location to manage your sites.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
