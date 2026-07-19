"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LogOut, Bell, Briefcase, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { ApplicationCard } from "@/components/candidate/ApplicationCard";
import { createClient } from "@/lib/supabase/client";
import {
  getCandidateApplications,
  getCandidateNotifications,
  markCandidateNotificationsRead,
} from "@/lib/services/candidate";
import type { CandidateApplication, CandidateNotification } from "@/lib/services/candidate";

export default function CandidateApplicationsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [notifications, setNotifications] = useState<CandidateNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotifs, setShowNotifs] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [appsRes, notifsRes] = await Promise.all([
      getCandidateApplications(),
      getCandidateNotifications(),
    ]);
    setApplications(appsRes.data || []);
    setNotifications(notifsRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser({ id: data.user.id, email: data.user.email });
        load();
      } else {
        setLoading(false);
      }
    });
  }, [supabase, load]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setApplications([]);
  };

  const handleOpenNotifs = async () => {
    setShowNotifs(true);
    const unread = notifications.filter((n) => !n.is_read);
    if (unread.length > 0) {
      await markCandidateNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-4">
          <Briefcase className="w-12 h-12 mx-auto text-brand opacity-70" />
          <h2 className="text-xl font-bold text-gray-900">بوابة المتقدمين</h2>
          <p className="text-sm text-muted-foreground">يرجى تسجيل الدخول لعرض طلباتك</p>
          <Link href="/candidate/login">
            <Button className="bg-brand hover:bg-brand-dark text-white">تسجيل الدخول</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-brand" />
            <span className="font-bold text-gray-900">بوابة المتقدمين</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative" onClick={handleOpenNotifs}>
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-xs gap-1">
              <LogOut className="w-3.5 h-3.5" />
              خروج
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">طلباتي</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-muted/40 animate-pulse" />)}
          </div>
        ) : applications.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">لا توجد طلبات بعد</p>
            <p className="text-sm mt-1">تصفح الوظائف المتاحة وقدّم طلبك</p>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map((app) => (
              <ApplicationCard key={app.id} application={app} onUpdated={load} />
            ))}
          </div>
        )}
      </main>

      {/* Notifications sheet */}
      {showNotifs && (
        <div className="fixed inset-0 z-50 flex" dir="rtl">
          <div className="flex-1 bg-black/30" onClick={() => setShowNotifs(false)} />
          <div className="w-80 bg-white shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <span className="font-semibold text-sm">الإشعارات</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowNotifs(false)}>✕</Button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد إشعارات</p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`px-4 py-3 ${!n.is_read ? "bg-brand/5" : ""}`}>
                    <p className="text-sm font-medium text-gray-800">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-600 mt-0.5">{n.body}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(n.created_at).toLocaleDateString("ar-SA")}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
