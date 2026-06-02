"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Edit, Users, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { KanbanBoard } from "@/components/recruitment/KanbanBoard";
import { ApplicationPanel } from "@/components/recruitment/ApplicationPanel";
import { getJobPosting, getApplications } from "@/lib/services/recruitment";
import type { JobPosting, JobApplication } from "@/lib/services/recruitment";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  active: "نشطة",
  draft: "مسودة",
  closed: "مغلقة",
  archived: "مؤرشفة",
  published: "منشورة",
  open: "مفتوحة",
};
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  published: "bg-green-100 text-green-700",
  open: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-700",
  closed: "bg-red-100 text-red-700",
  archived: "bg-orange-100 text-orange-700",
};

export default function PostingPipelinePage() {
  const params = useParams();
  const postingId = params.postingId as string;

  const [posting, setPosting] = useState<JobPosting | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [selected, setSelected] = useState<JobApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [postingRes, appsRes] = await Promise.all([
      getJobPosting(postingId),
      getApplications(postingId),
    ]);
    if (postingRes.data) setPosting(postingRes.data);
    if (appsRes.data) setApplications(appsRes.data);
    setLoading(false);
  }, [postingId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCopyLink = () => {
    if (!posting?.public_slug) {
      setMessage("هذه الوظيفة لا تملك رابطاً عاماً. انشر الوظيفة أولاً لتوليد الرابط.");
      return;
    }
    const url = `${window.location.origin}/apply/${posting.public_slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setMessage(`تم نسخ الرابط:\n${url}`);
  };

  const handleOpenLink = () => {
    if (!posting?.public_slug) {
      setMessage("لا يوجد رابط عام. انشر الوظيفة أولاً.");
      return;
    }
    window.open(`/apply/${posting.public_slug}`, "_blank");
  };

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-8 w-64 bg-muted/40 rounded animate-pulse mb-6" />
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-52 h-80 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!posting) {
    return (
      <div className="p-6 text-center text-muted-foreground" dir="rtl">
        <p>لم يتم العثور على الوظيفة</p>
        <Link href="/recruitment">
          <Button className="mt-4" variant="outline">العودة</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Link href="/recruitment">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
              التوظيف
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-bold text-gray-900">{posting.title}</h1>
          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[posting.status] || "bg-gray-100 text-gray-700")}>
            {STATUS_LABELS[posting.status] || posting.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Users className="w-4 h-4" />
            {applications.length} متقدم
          </span>
          <Button variant="outline" size="sm" onClick={handleCopyLink} className="gap-1.5 text-xs">
            <Copy className="w-3.5 h-3.5" />
            نسخ الرابط
          </Button>
          <Button variant="outline" size="sm" onClick={handleOpenLink} className="gap-1.5 text-xs">
            <ExternalLink className="w-3.5 h-3.5" />
            معاينة
          </Button>
          <Link href={`/recruitment/${postingId}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Edit className="w-3.5 h-3.5" />
              تعديل
            </Button>
          </Link>
        </div>
      </div>

      {/* Kanban */}
      {applications.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا يوجد متقدمون بعد</p>
          <p className="text-sm mt-1">شارك رابط الوظيفة لاستقبال الطلبات</p>
          {posting.public_slug && (
            <Button className="mt-4 gap-1.5" variant="outline" onClick={handleCopyLink}>
              <Copy className="w-3.5 h-3.5" />
              نسخ رابط التقديم
            </Button>
          )}
        </div>
      ) : (
        <KanbanBoard
          applications={applications}
          onOpenApplication={(app) => setSelected(app)}
        />
      )}

      {/* Application side panel */}
      {selected && posting && (
        <ApplicationPanel
          application={selected}
          posting={posting}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            loadAll();
            // update selected application in local state too
            setSelected(null);
          }}
        />
      )}

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
