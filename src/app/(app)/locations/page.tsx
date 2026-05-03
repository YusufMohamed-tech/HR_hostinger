"use client";

import React from "react";
import { Trash2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteLocation } from "@/lib/services/locations";
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

        {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
          <AddLocationDialog onSuccess={refetch} />
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">Location</TableHead>
                <TableHead className="font-semibold text-gray-600">City</TableHead>
                <TableHead className="font-semibold text-gray-600">Employees</TableHead>
                <TableHead className="font-semibold text-gray-600">Geofence</TableHead>
                <TableHead className="font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => (
                <TableRow key={location.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{location.name}</span>
                      <span className="text-xs text-gray-400">{location.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-600">{location.city}</TableCell>
                  <TableCell className="text-gray-600">{location.employees}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={location.geofence === "Enabled" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                      {location.geofence}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={location.status === "Active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                      {location.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={async () => { if (!confirm(`Delete ${location.name}?`)) return; await deleteLocation(location.id, currentUser?.orgId || "", currentUser?.id); refetch(); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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
