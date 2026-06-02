"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, FileText, Download, ExternalLink, Star, Calendar, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmActionButton, MessageDialog } from "@/components/ui/feedback-dialog";
import { updateApplication, updateApplicationStage, scheduleInterview, hireCandidate, getInterviews } from "@/lib/services/recruitment";
import type { JobApplication, JobPosting, FormQuestion, Interview } from "@/lib/services/recruitment";
import { cn } from "@/lib/utils";

const STAGE_LABELS: Record<string, string> = {
  submitted: "مُقدَّم",
  screening: "قيد المراجعة",
  shortlisted: "مختصر",
  interview: "مقابلة",
  technical_test: "اختبار تقني",
  offer: "عرض وظيفي",
  hired: "مقبول",
  rejected: "مرفوض",
};

const STAGE_COLORS: Record<string, string> = {
  submitted: "bg-gray-100 text-gray-700",
  screening: "bg-blue-100 text-blue-700",
  shortlisted: "bg-teal-100 text-teal-700",
  interview: "bg-purple-100 text-purple-700",
  technical_test: "bg-amber-100 text-amber-700",
  offer: "bg-green-100 text-green-700",
  hired: "bg-green-200 text-green-800",
  rejected: "bg-red-100 text-red-700",
};

const STAGES = [
  "submitted", "screening", "shortlisted", "interview", "technical_test", "offer", "hired", "rejected",
];

const INTERVIEW_TYPES = [
  { value: "in_person", label: "حضوري" },
  { value: "video", label: "عن بُعد (فيديو)" },
  { value: "phone", label: "هاتفي" },
];

type Props = {
  application: JobApplication;
  posting: JobPosting;
  onClose: () => void;
  onUpdated: () => void;
};

export function ApplicationPanel({ application, posting, onClose, onUpdated }: Props) {
  const [notes, setNotes] = useState(application.recruiter_notes || "");
  const [score, setScore] = useState<string>(application.score?.toString() ?? "");
  const [selectedStage, setSelectedStage] = useState(application.status);
  const [stageNote, setStageNote] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [updatingStage, setUpdatingStage] = useState(false);
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [message, setMessage] = useState("");
  const [interviewForm, setInterviewForm] = useState({
    scheduled_at: "",
    type: "in_person",
    location: "",
    notes: "",
  });
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const questions: FormQuestion[] = Array.isArray(posting.form_schema) ? posting.form_schema : [];

  useEffect(() => {
    getInterviews(application.id).then(({ data }) => {
      if (data) setInterviews(data);
    });
  }, [application.id]);

  const autoSaveNotes = useCallback(
    (value: string) => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(async () => {
        setSavingNotes(true);
        await updateApplication(application.id, { recruiter_notes: value });
        setSavingNotes(false);
      }, 1200);
    },
    [application.id]
  );

  const handleNotesChange = (value: string) => {
    setNotes(value);
    autoSaveNotes(value);
  };

  const handleScoreBlur = async () => {
    const num = parseFloat(score);
    if (!isNaN(num) && num >= 0 && num <= 100) {
      await updateApplication(application.id, { score: num });
    }
  };

  const handleStageUpdate = async () => {
    if (selectedStage === application.status) return;
    setUpdatingStage(true);
    const { error } = await updateApplicationStage(application.id, selectedStage, stageNote || undefined);
    setUpdatingStage(false);
    if (error) {
      setMessage(error);
    } else {
      setStageNote("");
      onUpdated();
    }
  };

  const handleScheduleInterview = async () => {
    if (!interviewForm.scheduled_at || !interviewForm.type) return;
    const { error } = await scheduleInterview({
      application_id: application.id,
      scheduled_at: interviewForm.scheduled_at,
      type: interviewForm.type,
      location: interviewForm.location || undefined,
      notes: interviewForm.notes || undefined,
    });
    if (error) {
      setMessage(error);
    } else {
      setShowInterviewForm(false);
      setInterviewForm({ scheduled_at: "", type: "in_person", location: "", notes: "" });
      const { data } = await getInterviews(application.id);
      if (data) setInterviews(data);
      onUpdated();
    }
  };

  const handleHire = async () => {
    const { data, error } = await hireCandidate(application.id);
    if (error) {
      setMessage(error);
    } else if (data) {
      setMessage(`تم قبول المتقدم وإنشاء ملف الموظف بنجاح. رقم الموظف: ${data.employee_id}`);
      onUpdated();
    }
  };

  const cvUrl = application.cv_url || application.resume_url;
  const canHire = ["offer", "hired"].includes(application.status);

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-900 text-base">{application.candidate_name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{application.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs px-2 py-1 rounded-full font-medium", STAGE_COLORS[application.status] || "bg-gray-100 text-gray-700")}>
              {STAGE_LABELS[application.status] || application.status}
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">تاريخ التقديم</p>
              <p className="font-medium">{new Date(application.applied_at).toLocaleDateString("ar-SA")}</p>
            </div>
            {application.phone && (
              <div>
                <p className="text-xs text-muted-foreground">الجوال</p>
                <p className="font-medium">{application.phone}</p>
              </div>
            )}
          </div>

          {/* CV */}
          {cvUrl && (
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              <span className="text-sm font-medium">السيرة الذاتية</span>
              <Button size="sm" variant="outline" className="text-xs h-7 mr-auto" asChild>
                <a href={cvUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3 h-3 ml-1" />
                  عرض
                </a>
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7" asChild>
                <a href={cvUrl} download>
                  <Download className="w-3 h-3 ml-1" />
                  تحميل
                </a>
              </Button>
            </div>
          )}

          {/* Answers */}
          {questions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700 border-b pb-1">إجابات المتقدم</p>
              {questions.map((q) => (
                <div key={q.id} className="text-sm">
                  <p className="text-xs text-muted-foreground mb-0.5">{q.label}</p>
                  <p className="text-gray-800 bg-muted/40 rounded px-2 py-1">
                    {application.answers?.[q.id] || <span className="italic text-muted-foreground">لا يوجد</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Score */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              التقييم (0–100)
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                max="100"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                onBlur={handleScoreBlur}
                placeholder="أدخل تقييماً"
                className="w-28 h-8 text-sm"
              />
              {score && <span className="text-sm text-muted-foreground self-center">/ 100</span>}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold">ملاحظات المسؤول</Label>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={3}
              placeholder="أضف ملاحظات داخلية..."
              className="w-full border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {savingNotes && <p className="text-xs text-muted-foreground">جاري الحفظ...</p>}
          </div>

          {/* Stage update */}
          <div className="space-y-2 border border-border/60 rounded-lg p-3">
            <p className="text-sm font-semibold">تحديث المرحلة</p>
            <Select value={selectedStage} onValueChange={(v) => setSelectedStage(v ?? selectedStage)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={stageNote}
              onChange={(e) => setStageNote(e.target.value)}
              placeholder="ملاحظة اختيارية..."
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              onClick={handleStageUpdate}
              disabled={updatingStage || selectedStage === application.status}
              className="bg-brand hover:bg-brand-dark text-white w-full"
            >
              {updatingStage ? "جاري التحديث..." : "تحديث المرحلة"}
            </Button>
          </div>

          {/* Interviews */}
          {interviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">المقابلات المجدولة</p>
              {interviews.map((iv) => (
                <div key={iv.id} className="text-sm bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1 font-medium text-purple-800">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(iv.scheduled_at || iv.interview_date).toLocaleString("ar-SA")}
                  </div>
                  {iv.location && <p className="text-xs text-muted-foreground mt-0.5">الموقع: {iv.location}</p>}
                  {iv.notes && <p className="text-xs text-muted-foreground">ملاحظة: {iv.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Schedule interview */}
          {!showInterviewForm ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setShowInterviewForm(true)}
            >
              <Calendar className="w-3.5 h-3.5 ml-1" />
              جدولة مقابلة
            </Button>
          ) : (
            <div className="space-y-2 border border-purple-200 rounded-lg p-3 bg-purple-50/50">
              <p className="text-sm font-semibold text-purple-800">جدولة مقابلة جديدة</p>
              <div>
                <Label className="text-xs mb-1 block">التاريخ والوقت</Label>
                <Input
                  type="datetime-local"
                  value={interviewForm.scheduled_at}
                  onChange={(e) => setInterviewForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">نوع المقابلة</Label>
                <Select
                  value={interviewForm.type}
                  onValueChange={(v) => setInterviewForm((p) => ({ ...p, type: v ?? p.type }))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVIEW_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">الموقع أو الرابط</Label>
                <Input
                  value={interviewForm.location}
                  onChange={(e) => setInterviewForm((p) => ({ ...p, location: e.target.value }))}
                  placeholder="عنوان أو رابط اجتماع"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">ملاحظات</Label>
                <Input
                  value={interviewForm.notes}
                  onChange={(e) => setInterviewForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="ملاحظات اختيارية"
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleScheduleInterview} className="bg-purple-600 hover:bg-purple-700 text-white flex-1 text-xs">
                  حفظ المقابلة
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowInterviewForm(false)} className="text-xs">
                  إلغاء
                </Button>
              </div>
            </div>
          )}

          {/* Hire */}
          {canHire && (
            <ConfirmActionButton
              title="قبول وإنشاء ملف موظف"
              description={`سيتم إنشاء ملف موظف كامل لـ ${application.candidate_name} في نظام HR. هل تريد المتابعة؟`}
              confirmLabel="قبول وإنشاء الملف"
              className="w-full bg-green-600 hover:bg-green-700 text-white text-sm"
              onConfirm={handleHire}
            >
              <CheckCircle className="w-4 h-4 ml-1" />
              قبول وإنشاء ملف موظف
            </ConfirmActionButton>
          )}
        </div>

        <MessageDialog
          open={Boolean(message)}
          onOpenChange={(open) => !open && setMessage("")}
          description={message}
        />
      </div>
    </div>
  );
}
