"use client";

import React from "react";
import { FileText, Star, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobApplication } from "@/lib/services/recruitment";

const STAGE_COLORS: Record<string, string> = {
  submitted: "bg-gray-100 text-gray-700 border-gray-200",
  new: "bg-gray-100 text-gray-700 border-gray-200",
  screening: "bg-blue-50 text-blue-700 border-blue-200",
  shortlisted: "bg-teal-50 text-teal-700 border-teal-200",
  interview: "bg-purple-50 text-purple-700 border-purple-200",
  technical_test: "bg-amber-50 text-amber-700 border-amber-200",
  offer: "bg-green-50 text-green-700 border-green-200",
  hired: "bg-green-100 text-green-800 border-green-300",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

type Props = {
  application: JobApplication;
  onClick: () => void;
};

export function KanbanCard({ application, onClick }: Props) {
  const hasCv = Boolean(application.cv_url || application.resume_url);
  const dateStr = new Date(application.applied_at).toLocaleDateString("ar-SA", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={cn(
        "border rounded-lg p-3 bg-white shadow-sm hover:shadow-md cursor-pointer transition-all group",
        STAGE_COLORS[application.status] || STAGE_COLORS.submitted
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
          {application.candidate_name}
        </p>
        {application.score != null && (
          <span className="flex items-center gap-0.5 text-xs text-amber-600 shrink-0">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            {application.score}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
      <div className="flex items-center gap-2 mt-2">
        {hasCv && <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs mr-auto opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          <Eye className="w-3 h-3 ml-0.5" />
          عرض
        </Button>
      </div>
    </div>
  );
}

export const STAGES = [
  { key: "submitted", label: "مُقدَّم", color: "border-t-gray-400" },
  { key: "screening", label: "مراجعة", color: "border-t-blue-400" },
  { key: "shortlisted", label: "مختصر", color: "border-t-teal-400" },
  { key: "interview", label: "مقابلة", color: "border-t-purple-400" },
  { key: "technical_test", label: "اختبار تقني", color: "border-t-amber-400" },
  { key: "offer", label: "عرض", color: "border-t-green-400" },
  { key: "hired", label: "مقبول", color: "border-t-green-600" },
  { key: "rejected", label: "مرفوض", color: "border-t-red-400" },
];

type KanbanBoardProps = {
  applications: JobApplication[];
  onOpenApplication: (app: JobApplication) => void;
};

export function KanbanBoard({ applications, onOpenApplication }: KanbanBoardProps) {
  const byStage = (stageKey: string) =>
    applications.filter((a) => {
      const status = a.status;
      if (stageKey === "submitted") return status === "submitted" || status === "new";
      return status === stageKey;
    });

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
      {STAGES.map((stage) => {
        const cards = byStage(stage.key);
        return (
          <div
            key={stage.key}
            className={cn(
              "flex-shrink-0 w-52 bg-muted/40 rounded-xl border-t-4 p-2 flex flex-col gap-2",
              stage.color
            )}
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-gray-700">{stage.label}</span>
              <span className="text-xs bg-white border border-border/60 rounded-full px-1.5 py-0.5 text-muted-foreground">
                {cards.length}
              </span>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              {cards.map((app) => (
                <KanbanCard
                  key={app.id}
                  application={app}
                  onClick={() => onOpenApplication(app)}
                />
              ))}
              {cards.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4 opacity-50">لا يوجد</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
