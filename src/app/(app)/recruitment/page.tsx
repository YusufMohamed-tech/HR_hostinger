"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Briefcase, Users, TrendingUp, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { JobCard } from "@/components/recruitment/JobCard";
import { getJobPostings, updateJobPosting } from "@/lib/services/recruitment";
import type { JobPosting } from "@/lib/services/recruitment";

export default function RecruitmentPage() {
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getJobPostings();
    setPostings(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleArchive = async (id: string) => {
    const { error } = await updateJobPosting(id, { status: "archived" });
    if (error) setMessage(error);
    else load();
  };

  const handleCopyLink = (slug: string) => {
    const url = `${window.location.origin}/apply/${slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setMessage(`تم نسخ رابط التقديم:\n${url}`);
  };

  const active = postings.filter((p) => p.status === "active" || p.status === "published" || p.status === "open");
  const draft = postings.filter((p) => p.status === "draft");
  const total = postings.reduce((sum, p) => sum + (p.application_count || 0), 0);
  const newThisWeek = postings.reduce((sum, p) => sum + (p.new_this_week || 0), 0);

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">التوظيف</h1>
          <p className="text-sm text-muted-foreground mt-1">إدارة الوظائف المفتوحة والمتقدمين</p>
        </div>
        <Link href="/recruitment/new">
          <Button className="bg-brand hover:bg-brand-dark text-white gap-1.5">
            <Plus className="w-4 h-4" />
            إضافة وظيفة جديدة
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Briefcase className="w-8 h-8 text-brand bg-brand/10 rounded-lg p-1.5" />
              <div>
                <p className="text-xs text-muted-foreground">وظائف نشطة</p>
                <p className="text-2xl font-bold">{active.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Users className="w-8 h-8 text-blue-500 bg-blue-50 rounded-lg p-1.5" />
              <div>
                <p className="text-xs text-muted-foreground">إجمالي الطلبات</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-green-500 bg-green-50 rounded-lg p-1.5" />
              <div>
                <p className="text-xs text-muted-foreground">طلبات هذا الأسبوع</p>
                <p className="text-2xl font-bold">{newThisWeek}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <FileSearch className="w-8 h-8 text-amber-500 bg-amber-50 rounded-lg p-1.5" />
              <div>
                <p className="text-xs text-muted-foreground">مسودات</p>
                <p className="text-2xl font-bold">{draft.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Postings list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : postings.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا توجد وظائف بعد</p>
          <p className="text-sm mt-1">ابدأ بإضافة وظيفة جديدة</p>
          <Link href="/recruitment/new">
            <Button className="mt-4 bg-brand hover:bg-brand-dark text-white">
              <Plus className="w-4 h-4 ml-1" />
              إضافة وظيفة
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {postings.map((posting) => (
            <JobCard
              key={posting.id}
              posting={posting}
              onArchive={handleArchive}
              onCopyLink={handleCopyLink}
            />
          ))}
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

