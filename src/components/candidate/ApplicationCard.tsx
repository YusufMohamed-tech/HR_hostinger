"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, Calendar, Building2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CandidateApplication } from "@/lib/services/candidate";

const STAGE_LABELS: Record<string, string> = {
  submitted: "مُقدَّم",
  new: "مُقدَّم",
  screening: "قيد المراجعة",
  shortlisted: "مختصر",
  interview: "مقابلة",
  technical_test: "اختبار تقني",
  offer: "عرض وظيفي",
  hired: "مقبول",
  rejected: "مرفوض",
};

const STAGE_BADGE: Record<string, string> = {
  submitted: "bg-gray-100 text-gray-700",
  new: "bg-gray-100 text-gray-700",
  screening: "bg-blue-100 text-blue-700",
  shortlisted: "bg-teal-100 text-teal-700",
  interview: "bg-purple-100 text-purple-700",
  technical_test: "bg-amber-100 text-amber-700",
  offer: "bg-green-100 text-green-700",
  hired: "bg-green-200 text-green-800",
  rejected: "bg-red-100 text-red-700",
};

const EMP_TYPE_MAP: Record<string, string> = {
  full_time: "دوام كامل",
  part_time: "دوام جزئي",
  contract: "عقد",
  internship: "تدريب",
};

type Props = {
  application: CandidateApplication;
};

export function ApplicationCard({ application }: Props) {
  const [expanded, setExpanded] = useState(false);
  const job = application.job;
  const stageLabel = STAGE_LABELS[application.status] || application.status;
  const stageBadgeClass = STAGE_BADGE[application.status] || STAGE_BADGE.submitted;
  const dateStr = new Date(application.applied_at).toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const nextInterview = (application.interviews || []).find(
    (iv) => new Date(iv.scheduled_at || iv.interview_date) >= new Date()
  );

  return (
    <div className="border border-border/60 rounded-xl bg-white shadow-sm overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-base">{job?.title || "وظيفة"}</h3>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", stageBadgeClass)}>
                {stageLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              {job?.org?.name && <span>{job.org.name}</span>}
              {job?.department?.name && (
                <span className="flex items-center gap-0.5">
                  <Building2 className="w-3 h-3" />
                  {job.department.name}
                </span>
              )}
              {job?.location?.name && (
                <span className="flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {job.location.name}
                </span>
              )}
              {job?.employment_type && (
                <span>{EMP_TYPE_MAP[job.employment_type] || job.employment_type}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">تاريخ التقديم: {dateStr}</p>

            {nextInterview && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-1">
                <Calendar className="w-3 h-3" />
                مقابلة:{" "}
                {new Date(nextInterview.scheduled_at || nextInterview.interview_date).toLocaleDateString("ar-SA", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>
          <div className="text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-4 pb-4 pt-3 bg-muted/20">
          <p className="text-xs font-semibold text-gray-700 mb-3">سجل المراحل</p>
          <div className="relative">
            <div className="absolute right-2 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-3">
              {(application.stage_history || []).map((entry, i) => (
                <div key={i} className="flex items-start gap-3 pr-6 relative">
                  <div className="absolute right-0 top-1 w-4 h-4 rounded-full bg-brand border-2 border-white shadow-sm" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">
                      {STAGE_LABELS[entry.stage] || entry.stage}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.changed_at).toLocaleDateString("ar-SA", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {entry.note && (
                      <p className="text-xs text-gray-600 mt-0.5 italic">{entry.note}</p>
                    )}
                  </div>
                </div>
              ))}
              {(!application.stage_history || application.stage_history.length === 0) && (
                <p className="text-xs text-muted-foreground pr-6">لا يوجد سجل للمراحل</p>
              )}
            </div>
          </div>

          {(application.interviews || []).length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">المقابلات</p>
              {(application.interviews || []).map((iv) => (
                <div key={iv.id} className="text-xs bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-2">
                  <p className="font-medium text-purple-800">
                    {new Date(iv.scheduled_at || iv.interview_date).toLocaleString("ar-SA")}
                  </p>
                  {iv.location && <p className="text-muted-foreground mt-0.5">الموقع: {iv.location}</p>}
                  {iv.notes && <p className="text-muted-foreground">ملاحظات: {iv.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
