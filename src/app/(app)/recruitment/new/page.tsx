"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Save, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { FormBuilder } from "@/components/recruitment/FormBuilder";
import { FormPreview } from "@/components/recruitment/FormPreview";
import { createJobPosting } from "@/lib/services/recruitment";
import type { FormQuestion } from "@/lib/services/recruitment";
import { useDepartments, useLocations } from "@/hooks/use-data";

const EMP_TYPES = [
  { value: "full_time", label: "دوام كامل" },
  { value: "part_time", label: "دوام جزئي" },
  { value: "contract", label: "عقد" },
  { value: "internship", label: "تدريب" },
];

const COMPANY_OPTIONS = ["HG Communications", "Chessboard", "Tatwir Talent", "other"];
const CITY_OPTIONS = ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "تبوك", "أبها", "نجران", "حائل", "القصيم", "الجوف", "الباحة", "عسير", "ينبع", "جازان"];

export default function NewJobPage() {
  const router = useRouter();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();

  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [companySelection, setCompanySelection] = useState("Tatwir Talent");
  const [customCompanyName, setCustomCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [deadline, setDeadline] = useState("");
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const handleSave = async (status: "draft" | "active") => {
    if (!title.trim()) {
      setMessage("عنوان الوظيفة مطلوب");
      return;
    }
    setSaving(true);
    const { data, error } = await createJobPosting({
      title: title.trim(),
      department_id: departmentId || null,
      location_id: locationId || null,
      company_name: companySelection === "other" ? customCompanyName.trim() || null : companySelection,
      city: city || null,
      employment_type: employmentType || null,
      description: description || null,
      requirements: requirements || null,
      salary_min: salaryMin ? parseFloat(salaryMin) : null,
      salary_max: salaryMax ? parseFloat(salaryMax) : null,
      deadline: deadline || null,
      form_schema: questions,
      status,
    } as Parameters<typeof createJobPosting>[0]);
    setSaving(false);
    if (error) {
      setMessage(error);
    } else if (data) {
      router.push(`/recruitment/${data.id}`);
    }
  };

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/recruitment">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
              التوظيف
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-bold text-gray-900">وظيفة جديدة</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className="gap-1.5"
          >
            {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showPreview ? "إخفاء المعاينة" : "معاينة النموذج"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSave("draft")}
            disabled={saving}
          >
            حفظ كمسودة
          </Button>
          <Button
            className="bg-brand hover:bg-brand-dark text-white gap-1.5"
            size="sm"
            onClick={() => handleSave("active")}
            disabled={saving}
          >
            <Save className="w-4 h-4" />
            نشر الوظيفة
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${showPreview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 lg:grid-cols-3"}`}>
        {/* Left: form details */}
        <div className={`space-y-4 ${showPreview ? "" : "lg:col-span-2"}`}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">تفاصيل الوظيفة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>عنوان الوظيفة <span className="text-red-500">*</span></Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: مهندس برمجيات أول"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>اسم الشركة</Label>
                  <Select value={companySelection} onValueChange={(value) => setCompanySelection(value || "Tatwir Talent")}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="اختر الشركة" /></SelectTrigger>
                    <SelectContent>
                      {COMPANY_OPTIONS.map((company) => (
                        <SelectItem key={company} value={company}>{company === "other" ? "أخرى" : company}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>المدينة</Label>
                  <Select value={city} onValueChange={(value) => setCity(value || "")}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="اختر المدينة" /></SelectTrigger>
                    <SelectContent>
                      {CITY_OPTIONS.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {companySelection === "other" && (
                <div>
                  <Label>اسم الشركة الأخرى</Label>
                  <Input value={customCompanyName} onChange={(event) => setCustomCompanyName(event.target.value)} className="mt-1" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>القسم</Label>
                    <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments || []).map((d) => (
                        <SelectItem key={d.id as string} value={d.id as string}>{d.name as string}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الموقع</Label>
                    <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر الموقع" />
                    </SelectTrigger>
                    <SelectContent>
                      {(locations || []).map((l) => (
                        <SelectItem key={l.id as string} value={l.id as string}>{l.name as string}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>نوع التوظيف</Label>
                  <Select value={employmentType} onValueChange={(v) => setEmploymentType(v ?? "full_time")}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMP_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>آخر موعد للتقديم</Label>
                  <Input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>الراتب الأدنى (ريال)</Label>
                  <Input
                    type="number"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder="مثال: 5000"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>الراتب الأعلى (ريال)</Label>
                  <Input
                    type="number"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder="مثال: 10000"
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label>وصف الوظيفة</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="اكتب وصفاً تفصيلياً للوظيفة..."
                  rows={4}
                  className="w-full mt-1 border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div>
                <Label>المتطلبات</Label>
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="المؤهلات والخبرات المطلوبة..."
                  rows={3}
                  className="w-full mt-1 border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </CardContent>
          </Card>

          {/* Form builder */}
          <FormBuilder questions={questions} onChange={setQuestions} />
        </div>

        {/* Right: preview */}
        {showPreview && (
          <div className="lg:sticky lg:top-6 lg:self-start">
            <FormPreview jobTitle={title} questions={questions} />
          </div>
        )}
      </div>

      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
    </div>
  );
}
