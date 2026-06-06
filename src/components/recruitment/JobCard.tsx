"use client";

import React from "react";
import Link from "next/link";
import { Archive, Copy, ExternalLink, Pencil, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmActionButton } from "@/components/ui/feedback-dialog";
import type { JobPosting } from "@/lib/services/recruitment";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "نشطة", variant: "default" },
  draft: { label: "مسودة", variant: "secondary" },
  closed: { label: "مغلقة", variant: "destructive" },
  archived: { label: "مؤرشفة", variant: "outline" },
  open: { label: "نشطة", variant: "default" },
  published: { label: "نشطة", variant: "default" },
};

const EMP_TYPE_MAP: Record<string, string> = {
  full_time: "دوام كامل",
  part_time: "دوام جزئي",
  contract: "عقد",
  internship: "تدريب",
};

type Props = {
  posting: JobPosting;
  onArchive: (id: string) => void;
  onCopyLink: (slug: string) => void;
  onDuplicate?: (id: string) => void;
  onSaveTemplate?: (posting: JobPosting) => void;
};

export function JobCard({ posting, onArchive, onCopyLink, onDuplicate, onSaveTemplate }: Props) {
  const status = STATUS_MAP[posting.status] ?? { label: posting.status, variant: "outline" as const };
  const isActive = ["active", "open", "published"].includes(posting.status);
  const deadline = posting.deadline
    ? new Date(posting.deadline).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <Card className="border border-border/60 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-base truncate">{posting.title}</h3>
              <Badge variant={status.variant} className="shrink-0 text-xs">{status.label}</Badge>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              {posting.company_name && <span>{posting.company_name}</span>}
              {posting.city && <span>{posting.city}</span>}
              {posting.department?.name && <span>{posting.department.name}</span>}
              {posting.employment_type && (
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                  {EMP_TYPE_MAP[posting.employment_type] || posting.employment_type}
                </span>
              )}
              {deadline && <span>الموعد النهائي: {deadline}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-center gap-0.5">
              <Users className="w-4 h-4 text-brand" />
              <span className="text-xs font-semibold text-brand">{posting.application_count ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Button size="sm" variant="default" className="bg-brand hover:bg-brand-dark text-white text-xs" asChild>
            <Link href={`/recruitment/${posting.id}`}>عرض المسار</Link>
          </Button>
          <Button size="sm" variant="outline" className="text-xs" asChild>
            <Link href={`/recruitment/${posting.id}/edit`}>
              <Pencil className="w-3 h-3 ml-1" />
              تعديل
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => onDuplicate?.(posting.id)}>
            <Copy className="w-3 h-3 ml-1" />
            نسخ
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => onSaveTemplate?.(posting)}>
            حفظ كقالب
          </Button>
          {isActive && posting.public_slug && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => onCopyLink(posting.public_slug!)}
            >
              <Copy className="w-3 h-3 ml-1" />
              نسخ الرابط
            </Button>
          )}
          {isActive && posting.public_slug && (
            <Button size="sm" variant="ghost" className="text-xs" asChild>
              <a href={`/apply/${posting.public_slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3 ml-1" />
                معاينة
              </a>
            </Button>
          )}
          {posting.status !== "archived" && (
            <ConfirmActionButton
              title="أرشفة الوظيفة"
              description={`سيتم أرشفة وظيفة "${posting.title}". لن تقبل طلبات جديدة. هل تريد المتابعة؟`}
              confirmLabel="أرشفة"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onConfirm={() => onArchive(posting.id)}
            >
              <Archive className="w-3 h-3 ml-1" />
              أرشفة
            </ConfirmActionButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
