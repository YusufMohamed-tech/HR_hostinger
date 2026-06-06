"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Briefcase, Users, TrendingUp, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { JobCard } from "@/components/recruitment/JobCard";
import { duplicateJobPosting, getJobPostings, getJobTemplates, saveJobTemplate, updateJobPosting } from "@/lib/services/recruitment";
import type { JobPosting, JobTemplate } from "@/lib/services/recruitment";

export default function RecruitmentPage() {
  const router = useRouter();
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getJobPostings();
    const templatesResult = await getJobTemplates();
    setPostings(data || []);
    setTemplates(templatesResult.data || []);
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

  const handleDuplicate = async (id: string) => {
    const { data, error } = await duplicateJobPosting(id);
    if (error) setMessage(error);
    else if (data) router.push(`/recruitment/${data.id}/edit`);
  };

  const handleSaveTemplate = async (posting: JobPosting) => {
    const { error } = await saveJobTemplate(posting);
    if (error) setMessage(error);
    else {
      setMessage("تم حفظ القالب");
      load();
    }
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
      {templates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">القوالب المحفوظة</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {templates.map((template) => (
              <Card key={template.id}>
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <p className="font-semibold text-gray-900">{template.title}</p>
                    <p className="text-xs text-muted-foreground">{template.company_name || "—"}</p>
                  </div>
                  <Link
                    href={{
                      pathname: "/recruitment/new",
                      query: { template: template.id },
                    }}
                  >
                    <Button size="sm" variant="outline" className="w-full">استخدام القالب</Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

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
              onDuplicate={handleDuplicate}
              onSaveTemplate={handleSaveTemplate}
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

