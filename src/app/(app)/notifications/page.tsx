"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-data";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/services/notifications";
import { useRoleContext } from "@/providers/RoleProvider";
import { PageSkeleton } from "@/components/Skeletons";

function isBrokenQuestionText(value: string) {
  const compact = value.replace(/\s/g, "");
  const questionCount = (value.match(/\?/g) || []).length;
  if (questionCount === 0) return false;
  const normalized = value.replace(/[؟?\s.,:؛،!_-]/g, "");
  return normalized.length === 0 || questionCount >= 3 && questionCount / Math.max(compact.length, 1) > 0.35;
}

function readableNameFromBrokenText(value: string) {
  const words = value
    .replace(/\?/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF.'-]{1,}$/.test(word));
  return words[0] || "";
}

function readableNotificationTitle(title: string, type: string) {
  if (!isBrokenQuestionText(title)) return title;
  if (type === "leave") return "تحديث على طلب إجازة";
  if (type === "task") return "تحديث على مهمة";
  return "إشعار جديد";
}

function readableNotificationBody(body: string, type: string) {
  if (!isBrokenQuestionText(body)) return body;
  const name = readableNameFromBrokenText(body);
  if (type === "leave") return name ? `يوجد تحديث جديد على طلب إجازة ${name}. اضغط فتح لمراجعة التفاصيل.` : "يوجد تحديث جديد على طلب الإجازة. اضغط فتح لمراجعة التفاصيل.";
  if (type === "task") return "يوجد تحديث جديد على المهمة. اضغط فتح لمراجعة التفاصيل.";
  return "اضغط فتح لمراجعة التفاصيل.";
}

export default function NotificationsPage() {
  const router = useRouter();
  const { currentUser } = useRoleContext();
  const { data: notifications, loading, refetch } = useNotifications();
  const hasUnread = notifications.some((note) => !note.is_read);

  if (loading) return <PageSkeleton />;

  const openNotification = async (note: Record<string, unknown>) => {
    const noteId = String(note.id ?? "");
    const isRead = Boolean(note.is_read);
    const link = typeof note.link === "string" ? note.link : "";

    if (noteId && !isRead) {
      await markNotificationRead(noteId, true);
      refetch();
    }

    if (link) {
      router.push(link);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الإشعارات</h1>
          <p className="text-gray-500 text-sm mt-1">
            تنبيهات المهام والحضور والإجازات مع فتح مباشر لمكان التحديث.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!hasUnread || !currentUser?.orgId || !currentUser?.id}
          onClick={async () => {
            if (!currentUser?.orgId || !currentUser?.id) return;
            await markAllNotificationsRead();
            refetch();
          }}
        >
          تحديد الكل كمقروء
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {notifications.map((note) => {
            const noteRecord = note as Record<string, unknown>;
            const noteId = String(noteRecord.id ?? "");
            const noteType = typeof noteRecord.type === "string" ? noteRecord.type : "system";
            const rawTitle = typeof noteRecord.title === "string" ? noteRecord.title : "إشعار";
            const rawBody = typeof noteRecord.body === "string" ? noteRecord.body : "";
            const noteTitle = readableNotificationTitle(rawTitle, noteType);
            const noteBody = readableNotificationBody(rawBody, noteType);
            const noteLink = typeof noteRecord.link === "string" ? noteRecord.link : "";
            const isRead = Boolean(noteRecord.is_read);

            return (
              <div key={noteId} className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => openNotification(noteRecord)}
                  className="min-w-0 flex-1 text-right"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={isRead ? "bg-gray-100 text-gray-600 border-gray-200" : "bg-red-50 text-red-700 border-red-200"}
                    >
                      {noteType}
                    </Badge>
                    <span className="text-sm font-semibold text-gray-900">{noteTitle}</span>
                    {!isRead && <span className="h-2 w-2 rounded-full bg-red-600" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{noteBody}</p>
                </button>
                <Button variant="ghost" size="sm" onClick={() => openNotification(noteRecord)}>
                  {noteLink ? "فتح" : isRead ? "مقروء" : "تحديد كمقروء"}
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
