"use client";

import React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-data";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/services/notifications";
import { useRoleContext } from "@/providers/RoleProvider";
import { PageSkeleton } from "@/components/Skeletons";

export default function NotificationsPage() {
  const { currentUser } = useRoleContext();
  const { data: notifications, loading, refetch } = useNotifications();
  const hasUnread = notifications.some((note) => !note.is_read);

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الإشعارات</h1>
          <p className="text-gray-500 text-sm mt-1">تنبيهات داخل النظام للحضور والمهام والاعتمادات.</p>
        </div>
        <Button
          variant="outline"
          disabled={!hasUnread || !currentUser?.orgId || !currentUser?.id}
          onClick={async () => {
            if (!currentUser?.orgId || !currentUser?.id) return;
            await markAllNotificationsRead(currentUser.orgId, currentUser.id);
            refetch();
          }}
        >
          Mark all read
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {notifications.map((note) => {
            const noteRecord = note as Record<string, unknown>;
            const noteId = String(noteRecord.id ?? "");
            const noteType = typeof noteRecord.type === "string" ? noteRecord.type : "update";
            const noteTitle = typeof noteRecord.title === "string" ? noteRecord.title : "Notification";
            const noteBody = typeof noteRecord.body === "string" ? noteRecord.body : "";
            const isRead = Boolean(noteRecord.is_read);

            return (
              <div key={noteId} className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={isRead ? "bg-gray-100 text-gray-600 border-gray-200" : "bg-brand-light text-brand-dark border-brand/20"}>
                      {noteType}
                    </Badge>
                    <span className="text-sm font-semibold text-gray-900">{noteTitle}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{noteBody}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!noteId) return;
                    await markNotificationRead(noteId, true);
                    refetch();
                  }}
                  disabled={isRead}
                >
                  {isRead ? "Read" : "Mark read"}
                </Button>
              </div>
            );
          })}

          {notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">لا توجد إشعارات بعد</p>
              <p className="text-xs text-gray-500 mt-1">ستظهر التنبيهات هنا عند إنشائها.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
