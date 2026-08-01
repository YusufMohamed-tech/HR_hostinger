"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Plus } from "lucide-react";
import { PageSkeleton } from "@/components/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageDialog } from "@/components/ui/feedback-dialog";
import { PRODUCT_INVENTORY_WORKBOOK_HEADERS } from "@/lib/product-inventory/workbook";
import {
  activateProductInventoryImportProfile,
  createProductInventoryImportProfile,
  getProductInventoryImportProfiles,
} from "@/lib/services/product-inventory";
import type { ProductInventoryImportProfile } from "@/types/product-inventory";

const canonicalMapping = Object.fromEntries(
  PRODUCT_INVENTORY_WORKBOOK_HEADERS.map((field) => [field, field])
);

export function ProductInventoryImportProfilesScreen() {
  const [profiles, setProfiles] = useState<ProductInventoryImportProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("قالب أجهزة الراوتر 5G");
  const [mapping, setMapping] = useState(JSON.stringify(canonicalMapping, null, 2));
  const [approvalNote, setApprovalNote] = useState("");

  const load = useCallback(async () => {
    const result = await getProductInventoryImportProfiles();
    setProfiles(result.data ?? []);
    setMessage(result.error || "");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    let parsedMapping: Record<string, string>;
    try {
      parsedMapping = JSON.parse(mapping) as Record<string, string>;
      if (!parsedMapping || Array.isArray(parsedMapping) || typeof parsedMapping !== "object") throw new Error();
    } catch {
      setMessage("خريطة الأعمدة يجب أن تكون JSON صحيحًا: اسم عمود العميل ← الحقل القياسي.");
      return;
    }
    setWorking(true);
    const result = await createProductInventoryImportProfile({
      profile_id: crypto.randomUUID(),
      name,
      use_first_sheet: true,
      header_row: 1,
      header_mapping: parsedMapping,
      required_fields: ["serial_number", "product_sku", "unit_cost", "planned_sale_price", "commission_type"],
      default_currency: "SAR",
      default_condition: "new",
      default_ownership_type: "purchased",
      is_active: true,
      approval_note: approvalNote,
    });
    setWorking(false);
    if (result.error) return setMessage(result.error);
    setShowForm(false);
    setApprovalNote("");
    await load();
  };

  const activate = async (profileId: string) => {
    setWorking(true);
    const result = await activateProductInventoryImportProfile(profileId);
    setWorking(false);
    if (result.error) return setMessage(result.error);
    await load();
  };

  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog open={Boolean(message)} onOpenChange={(open) => !open && setMessage("")} description={message} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-bold">إصدارات قالب الاستيراد</h1><p className="mt-2 text-gray-500">فعّل إصدارًا واحدًا فقط للاستلامات الجديدة، مع الاحتفاظ بكل الإصدارات القديمة لإعادة المعالجة والتدقيق.</p></div><Button onClick={() => setShowForm((value) => !value)}><Plus className="ml-2 h-4 w-4" />إصدار جديد</Button></div>
      {showForm && <Card><CardHeader><CardTitle>إصدار خريطة أعمدة جديدة</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>اسم القالب</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label>خريطة الأعمدة JSON</Label><textarea dir="ltr" className="min-h-72 w-full rounded-lg border p-3 font-mono text-xs" value={mapping} onChange={(event) => setMapping(event.target.value)} /><p className="mt-1 text-xs text-gray-500">المفتاح هو عنوان عمود العميل، والقيمة أحد الحقول القياسية في القالب.</p></div><div><Label>ملاحظة الاعتماد</Label><Input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="مرجع موافقة العميل أو نتيجة UAT" /></div><div className="flex justify-end"><Button disabled={working || name.trim().length < 2} onClick={() => void create()}>{working ? "جاري الحفظ..." : "حفظ وتفعيل الإصدار"}</Button></div></CardContent></Card>}
      <div className="space-y-3">{profiles.map((profile) => <Card key={profile.id} className={profile.is_active ? "border-green-200" : ""}><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><FileSpreadsheet className="mt-1 h-5 w-5 text-blue-600" /><div><div className="flex items-center gap-2"><p className="font-semibold">{profile.name} — v{profile.version}</p>{profile.is_active && <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="ml-1 h-3 w-3" />نشط</Badge>}</div><p className="mt-1 text-sm text-gray-500">صف العناوين {profile.header_row} · {Object.keys(profile.header_mapping).length} عمودًا · {profile.default_currency}</p><p className="mt-1 text-xs text-gray-400">{profile.approval_note || "لا توجد ملاحظة اعتماد"}</p></div></div>{!profile.is_active && <Button variant="outline" disabled={working} onClick={() => void activate(profile.id)}>تفعيل هذا الإصدار</Button>}</CardContent></Card>)}</div>
    </div>
  );
}
