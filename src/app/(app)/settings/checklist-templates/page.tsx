"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/Skeletons";
import { Plus, Trash2, GripVertical, Save, ClipboardList } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  type: "boolean" | "rating" | "text";
  required: boolean;
  order: number;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  items: ChecklistItem[];
  location_type: string | null;
  is_active: boolean;
  created_at: string;
}

const typeLabels: Record<string, string> = {
  boolean: "نعم/لا",
  rating: "تقييم (1-5)",
  text: "نص حر",
};

export default function ChecklistTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationType, setLocationType] = useState<string>("");
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/supervisor/checklist-templates");
      if (res.ok) {
        const json = await res.json();
        setTemplates(json.templates ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: "",
        type: "boolean",
        required: true,
        order: prev.length,
      },
    ]);
  }

  function updateItem(id: string, field: keyof ChecklistItem, value: unknown) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id).map((item, i) => ({ ...item, order: i })));
  }

  function resetForm() {
    setName("");
    setDescription("");
    setLocationType("");
    setItems([]);
    setShowForm(false);
  }

  async function handleSave() {
    if (!name.trim() || items.length === 0) return;
    const emptyLabels = items.filter((item) => !item.label.trim());
    if (emptyLabels.length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/checklist-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          location_type: locationType || null,
          items: items.map((item, i) => ({ ...item, order: i })),
        }),
      });
      if (res.ok) {
        resetForm();
        await fetchTemplates();
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          نماذج تقييم المواقع
        </h1>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 ml-2" />
            نموذج جديد
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">إنشاء نموذج تقييم جديد</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>اسم النموذج *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: تقييم الفروع اليومي"
                />
              </div>
              <div>
                <Label>نوع الموقع (اختياري)</Label>
                <Select value={locationType} onValueChange={(v) => setLocationType(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="جميع أنواع المواقع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">جميع أنواع المواقع</SelectItem>
                    <SelectItem value="branch">فرع</SelectItem>
                    <SelectItem value="booth">كشك</SelectItem>
                    <SelectItem value="office">مكتب</SelectItem>
                    <SelectItem value="area">منطقة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>الوصف (اختياري)</Label>
              <Textarea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="وصف مختصر للنموذج..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>عناصر التقييم *</Label>
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 ml-1" />
                  إضافة عنصر
                </Button>
              </div>

              {items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
                  أضف عناصر التقييم التي سيقوم المشرف بتعبئتها
                </p>
              )}

              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border p-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
                    <Input
                      className="flex-1"
                      placeholder="اسم العنصر"
                      value={item.label}
                      onChange={(e) => updateItem(item.id, "label", e.target.value)}
                    />
                    <Select
                      value={item.type}
                      onValueChange={(v) => updateItem(item.id, "type", v ?? "boolean")}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="boolean">نعم/لا</SelectItem>
                        <SelectItem value="rating">تقييم (1-5)</SelectItem>
                        <SelectItem value="text">نص حر</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={item.required}
                        onChange={(e) => updateItem(item.id, "required", e.target.checked)}
                        className="rounded"
                      />
                      مطلوب
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving || !name.trim() || items.length === 0}>
                <Save className="h-4 w-4 ml-2" />
                {saving ? "جاري الحفظ..." : "حفظ النموذج"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">النماذج الحالية</CardTitle>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              لا توجد نماذج تقييم بعد. أنشئ نموذجاً ليستخدمه المشرفون.
            </p>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{template.name}</h3>
                    <div className="flex items-center gap-2">
                      {template.location_type && (
                        <Badge variant="secondary">{template.location_type}</Badge>
                      )}
                      <Badge className="bg-green-100 text-green-700">
                        {template.items.length} عنصر
                      </Badge>
                    </div>
                  </div>
                  {template.description && (
                    <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {template.items.map((item) => (
                      <span key={item.id} className="text-xs rounded bg-muted px-2 py-1">
                        {item.label} ({typeLabels[item.type]})
                        {item.required && " *"}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
