"use client";

import React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-data";
import { markNotificationRead } from "@/lib/services/notifications";
import { PageSkeleton } from "@/components/Skeletons";

export default function NotificationsPage() {
  const { data: notifications, loading, refetch } = useNotifications();

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-gray-500 text-sm mt-1">In-app alerts for attendance, tasks, and approvals.</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {notifications.map((note) => (
            <div key={note.id} className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={note.is_read ? "bg-gray-100 text-gray-600 border-gray-200" : "bg-brand-light text-brand-dark border-brand/20"}>
                    {note.type}
                  </Badge>
                  <span className="text-sm font-semibold text-gray-900">{note.title}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{note.body || ""}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await markNotificationRead(note.id, true);
                  refetch();
                }}
                disabled={note.is_read}
              >
                {note.is_read ? "Read" : "Mark read"}
              </Button>
            </div>
          ))}

          {notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No notifications yet</p>
              <p className="text-xs text-gray-500 mt-1">Alerts will appear here as they are generated.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
