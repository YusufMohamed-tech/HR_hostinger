"use client";

import React from "react";
import { MapPin, Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/ui/feedback-dialog";
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
  const canManageLocations = ["Superadmin", "Admin", "HR_Admin", "Training_Manager", "Sales_Manager"].includes(currentUser?.role || "");

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">المواقع</h1>
          <p className="mt-1 text-sm text-gray-500">
            إدارة مواقع العمل وتصنيفها حسب المدينة والمشروع ونطاق الحضور.
          </p>
        </div>

        {canManageLocations && <AddLocationDialog onSuccess={refetch} />}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">الموقع</TableHead>
                <TableHead className="font-semibold text-gray-600">المدينة</TableHead>
                <TableHead className="font-semibold text-gray-600">المشروع</TableHead>
                <TableHead className="font-semibold text-gray-600">النوع</TableHead>
                <TableHead className="font-semibold text-gray-600">المدير</TableHead>
                <TableHead className="font-semibold text-gray-600">النطاق</TableHead>
                <TableHead className="font-semibold text-gray-600">الإحداثيات</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => {
                const locationRecord = location as Record<string, unknown>;
                const locationId = String(locationRecord.id ?? "");
                const locationName = typeof locationRecord.name === "string" ? locationRecord.name : "—";
                const locationType = typeof locationRecord.type === "string" ? locationRecord.type : "branch";
                const locationCity = typeof locationRecord.city === "string" ? locationRecord.city : "—";
                const project = (locationRecord.project ?? null) as Record<string, unknown> | null;
                const projectName = typeof project?.name === "string"
                  ? project.name
                  : typeof locationRecord.project_name === "string"
                    ? locationRecord.project_name
                    : "—";
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
                        {typeof locationRecord.address_details === "string" && locationRecord.address_details && (
                          <span className="text-xs text-gray-500">{locationRecord.address_details}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">{locationCity}</TableCell>
                    <TableCell className="text-gray-600">{projectName}</TableCell>
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
                        {canManageLocations && <EditLocationDialog location={location} onSuccess={refetch} />}
                        {canManageLocations && (
                          <ConfirmActionButton
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            title="حذف الموقع"
                            description={`سيتم حذف موقع ${locationName}. هل تريد المتابعة؟`}
                            confirmLabel="حذف"
                            destructive
                            onConfirm={async () => {
                              await deleteLocation(locationId, Number(locationRecord.version || 1));
                              refetch();
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </ConfirmActionButton>
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
              <MapPin className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-900">لا توجد مواقع بعد</p>
              <p className="mt-1 text-xs text-gray-500">أضف موقعا لإدارة مواقع العمل والحضور.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
