"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
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
  analyzeProductInventoryImportProfile,
  confirmProductInventoryImportProfile,
  getProductInventoryImportProfiles,
  getProductInventorySetup,
  type ProductInventoryImportAnalysisPreview,
} from "@/lib/services/product-inventory";
import type {
  ProductInventoryCompany,
  ProductInventoryImportProfile,
} from "@/types/product-inventory";

const fieldLabels: Record<string, string> = {
  supplier_code: "كود المورد",
  receipt_reference: "مرجع الاستلام",
  product_sku: "كود المنتج SKU",
  product_name: "اسم المنتج",
  model: "الموديل",
  serial_number: "الرقم التسلسلي",
  barcode: "الباركود",
  unit_cost: "تكلفة الوحدة",
  planned_sale_price: "سعر البيع",
  minimum_sale_price: "أقل سعر بيع",
  maximum_sale_price: "أعلى سعر بيع",
  commission_type: "نوع العمولة",
  commission_value: "قيمة العمولة",
  commission_base: "أساس العمولة",
  currency: "العملة",
  tax_code: "رمز الضريبة",
  condition: "حالة الجهاز",
  notes: "ملاحظات",
};

const shapeLabels = {
  row_per_device: "جهاز واحد في كل صف",
  continuation_rows: "صفوف سيريالات متتابعة",
  serial_columns: "عدة أعمدة سيريال في الصف",
};

function confidenceClass(confidence: number) {
  if (confidence >= 0.92) return "border-green-200 bg-green-50 text-green-700";
  if (confidence >= 0.75) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function issueLabel(issue: string) {
  const required = /^Required field (.+) could not be recognized safely\.$/u.exec(issue);
  if (required) return `لم يتم التعرف بأمان على حقل ${fieldLabels[required[1]] || required[1]}.`;
  if (issue.startsWith("A product SKU")) return "يجب تحديد عمود كود المنتج أو الباركود أو اسم المنتج.";
  if (issue.includes("no data rows")) return "لم يتم العثور على صفوف أجهزة أسفل العناوين المكتشفة.";
  if (issue.includes("similar inventory-table score")) return "يوجد أكثر من شيت محتمل؛ راجع الشيت الذي اختاره النظام.";
  const confirmation = /^Confirm the proposed (.+) column\.$/u.exec(issue);
  if (confirmation) return `راجع عمود ${fieldLabels[confirmation[1]] || confirmation[1]} المقترح.`;
  return issue;
}

function profileModeLabel(profile: ProductInventoryImportProfile) {
  if (profile.recognition_mode === "automatic") return "تلقائي";
  if (profile.recognition_mode === "reviewed") return "تلقائي بعد المراجعة";
  return "قديم";
}

export function ProductInventoryImportProfilesScreen() {
  const [profiles, setProfiles] = useState<ProductInventoryImportProfile[]>([]);
  const [companies, setCompanies] = useState<ProductInventoryCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"" | "analyze" | "confirm" | "activate">("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("قالب أجهزة الراوتر 5G");
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("SAR");
  const [defaultCondition, setDefaultCondition] = useState<"new" | "open_box" | "refurbished">("new");
  const [defaultOwnership, setDefaultOwnership] = useState<"purchased" | "consignment">("purchased");
  const [analysis, setAnalysis] = useState<ProductInventoryImportAnalysisPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [profilesResult, setupResult] = await Promise.all([
      getProductInventoryImportProfiles(),
      getProductInventorySetup(),
    ]);
    setProfiles(profilesResult.data ?? []);
    setCompanies(setupResult.data?.companies ?? []);
    setMessage(profilesResult.error || setupResult.error || "");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const recognition = analysis?.recognition ?? null;
  const proposalsByHeader = useMemo(
    () => new Map((recognition?.field_proposals ?? []).map((proposal) => [proposal.header, proposal])),
    [recognition]
  );
  const reviewHeaders = useMemo(() => {
    if (!recognition) return [];
    return recognition.headers.filter((header) => {
      if (!header) return false;
      const proposal = proposalsByHeader.get(header);
      return !proposal || proposal.status !== "confirmed";
    });
  }, [proposalsByHeader, recognition]);
  const mappingValues = Object.values(mapping);
  const mappingReady = mappingValues.includes("serial_number")
    && mappingValues.includes("unit_cost")
    && mappingValues.includes("planned_sale_price")
    && mappingValues.some((field) => ["product_sku", "product_name", "barcode"].includes(field))
    && mappingValues.every((field, index) => field === "serial_number" || mappingValues.indexOf(field) === index);

  const resetForm = () => {
    setShowForm(false);
    setFile(null);
    setAnalysis(null);
    setMapping({});
    setApprovalNote("");
  };

  const analyze = async () => {
    if (!file || name.trim().length < 2) {
      setMessage("اكتب اسم القالب واختر ملف XLSX أو CSV.");
      return;
    }
    setWorking("analyze");
    const result = await analyzeProductInventoryImportProfile(file, {
      analysis_id: crypto.randomUUID(),
      managed_file_id: crypto.randomUUID(),
      command_id: crypto.randomUUID(),
      template_name: name,
      supplier_company_id: supplierId || undefined,
    });
    setWorking("");
    if (result.error || !result.data) {
      setMessage(result.error || "تعذر تحليل ملف القالب.");
      return;
    }
    setAnalysis(result.data);
    setMapping(result.data.recognition.header_mapping);
    if (result.data.recognition.metadata.currency?.match(/^[A-Za-z]{3}$/u)) {
      setDefaultCurrency(result.data.recognition.metadata.currency.toUpperCase());
    }
  };

  const updateMapping = (header: string, field: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (!field) {
        delete next[header];
        return next;
      }
      if (field !== "serial_number") {
        for (const [existingHeader, existingField] of Object.entries(next)) {
          if (existingHeader !== header && existingField === field) delete next[existingHeader];
        }
      }
      next[header] = field;
      return next;
    });
  };

  const confirm = async () => {
    if (!analysis || !mappingReady) {
      setMessage("حدد السيريال والمنتج والتكلفة وسعر البيع قبل الاعتماد.");
      return;
    }
    setWorking("confirm");
    const result = await confirmProductInventoryImportProfile(analysis.analysis_id, {
      command_id: crypto.randomUUID(),
      profile_id: crypto.randomUUID(),
      name,
      header_mapping: mapping,
      default_currency: defaultCurrency,
      default_condition: defaultCondition,
      default_ownership_type: defaultOwnership,
      approval_note: approvalNote,
    });
    setWorking("");
    if (result.error) {
      setMessage(result.error);
      return;
    }
    resetForm();
    await load();
  };

  const activate = async (profileId: string) => {
    setWorking("activate");
    const result = await activateProductInventoryImportProfile(profileId);
    setWorking("");
    if (result.error) return setMessage(result.error);
    await load();
  };

  if (loading) return <PageSkeleton />;
  return (
    <div className="space-y-6" dir="rtl">
      <MessageDialog
        open={Boolean(message)}
        onOpenChange={(open) => !open && setMessage("")}
        description={message}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">إصدارات قالب الاستيراد</h1>
          <p className="mt-2 text-gray-500">
            ارفع ملف العميل، وسيكتشف النظام الشيت والعناوين والأعمدة تلقائيًا بدون JSON.
          </p>
        </div>
        <Button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }}>
          <Plus className="ml-2 h-4 w-4" />{showForm ? "إلغاء" : "إصدار جديد من Excel"}
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />التعرف التلقائي على قالب العميل
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!analysis && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>اسم القالب *</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>المورد — اختياري لتحسين مطابقة المنتجات</Label>
                    <select
                      className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                      value={supplierId}
                      onChange={(event) => setSupplierId(event.target.value)}
                    >
                      <option value="">التعرف من كل المنتجات</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>{company.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-6 text-center hover:bg-blue-50">
                  <Upload className="mb-3 h-8 w-8 text-blue-600" />
                  <span className="font-semibold">اختر ملف XLSX أو CSV من العميل</span>
                  <span className="mt-1 text-sm text-gray-500">حد أقصى 10 MB و10,000 صف لكل شيت</span>
                  {file && <span className="mt-3 rounded-full bg-white px-3 py-1 text-sm text-blue-700">{file.name}</span>}
                  <input
                    className="sr-only"
                    type="file"
                    accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                  />
                </label>
                <div className="flex justify-end">
                  <Button disabled={working === "analyze" || !file} onClick={() => void analyze()}>
                    <Sparkles className="ml-2 h-4 w-4" />
                    {working === "analyze" ? "جاري قراءة الشيتات والتعرف على الأعمدة..." : "تحليل الملف تلقائيًا"}
                  </Button>
                </div>
              </>
            )}

            {recognition && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border p-4"><p className="text-xs text-gray-500">الشيت المكتشف</p><p className="mt-1 font-bold">{recognition.sheet_name}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-gray-500">صف العناوين</p><p className="mt-1 font-bold">{recognition.header_row}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-gray-500">شكل الملف</p><p className="mt-1 font-bold">{shapeLabels[recognition.shape]}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-gray-500">ثقة التعرف</p><p className="mt-1 font-bold">{Math.round(recognition.confidence * 100)}%</p></div>
                </div>

                {(recognition.blocking_errors.length > 0 || recognition.warnings.length > 0) && (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                    {[...recognition.blocking_errors, ...recognition.warnings].map((issue) => (
                      <p key={issue} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />{issueLabel(issue)}
                      </p>
                    ))}
                  </div>
                )}

                <div>
                  <h3 className="font-semibold">الأعمدة التي تعرف عليها النظام</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {recognition.field_proposals.filter((proposal) => proposal.status === "confirmed").map((proposal) => (
                      <div key={`${proposal.header}-${proposal.field}`} className="flex items-center justify-between gap-3 rounded-lg border border-green-100 bg-green-50/40 p-3">
                        <div><p className="text-xs text-gray-500">{proposal.column_letter} · {proposal.header}</p><p className="font-medium">{fieldLabels[proposal.field]}</p></div>
                        <Badge variant="outline" className={confidenceClass(proposal.confidence)}>{Math.round(proposal.confidence * 100)}%</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                {reviewHeaders.length > 0 && (
                  <div>
                    <h3 className="font-semibold">راجع الأعمدة غير المؤكدة فقط</h3>
                    <p className="mt-1 text-sm text-gray-500">اختر المعنى الصحيح للعمود أو اتركه “تجاهل”.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {reviewHeaders.map((header) => {
                        const proposal = proposalsByHeader.get(header);
                        return (
                          <div key={header} className="rounded-lg border p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium">{header}</p>
                              {proposal && <Badge variant="outline" className={confidenceClass(proposal.confidence)}>{Math.round(proposal.confidence * 100)}%</Badge>}
                            </div>
                            <select
                              className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                              value={mapping[header] || ""}
                              onChange={(event) => updateMapping(header, event.target.value)}
                            >
                              <option value="">تجاهل هذا العمود</option>
                              {PRODUCT_INVENTORY_WORKBOOK_HEADERS.map((field) => (
                                <option key={field} value={field}>{fieldLabels[field]}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="font-semibold">عينة من البيانات بعد اكتشاف صف العناوين</h3>
                  <div className="mt-3 overflow-x-auto rounded-lg border">
                    <table className="min-w-max text-sm">
                      <thead className="bg-gray-50">
                        <tr><th className="px-3 py-2 text-right">الصف</th>{recognition.headers.map((header, index) => <th key={`${header}-${index}`} className="px-3 py-2 text-right">{header || `عمود ${index + 1}`}</th>)}</tr>
                      </thead>
                      <tbody>
                        {recognition.sample_rows.slice(0, 8).map((row) => (
                          <tr key={row.row_number} className="border-t">
                            <td className="px-3 py-2 text-gray-500">{row.row_number}</td>
                            {recognition.headers.map((_, index) => <td key={index} className="max-w-56 truncate px-3 py-2" dir="auto">{String(row.values[index] ?? "")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2"><Label>العملة الافتراضية</Label><Input maxLength={3} value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value.toUpperCase())} /></div>
                  <div className="space-y-2"><Label>حالة الجهاز</Label><select className="h-10 w-full rounded-lg border bg-white px-3" value={defaultCondition} onChange={(event) => setDefaultCondition(event.target.value as typeof defaultCondition)}><option value="new">جديد</option><option value="open_box">مفتوح</option><option value="refurbished">مجدد</option></select></div>
                  <div className="space-y-2"><Label>نوع الملكية</Label><select className="h-10 w-full rounded-lg border bg-white px-3" value={defaultOwnership} onChange={(event) => setDefaultOwnership(event.target.value as typeof defaultOwnership)}><option value="purchased">مملوك</option><option value="consignment">عهدة مورد</option></select></div>
                  <div className="space-y-2"><Label>مرجع الاعتماد</Label><Input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="موافقة العميل أو UAT" /></div>
                </div>
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2 text-sm">
                    {mappingReady ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
                    <p>{mappingReady ? "السيريال والمنتج والتكلفة وسعر البيع محددة، والقالب جاهز." : "حدد الحقول الأساسية قبل الاعتماد."}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setAnalysis(null); setMapping({}); }}>اختيار ملف آخر</Button>
                    <Button disabled={!mappingReady || working === "confirm" || !/^[A-Z]{3}$/u.test(defaultCurrency)} onClick={() => void confirm()}>
                      {working === "confirm" ? "جاري الحفظ والتفعيل..." : "حفظ وتفعيل القالب"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {profiles.map((profile) => (
          <Card key={profile.id} className={profile.is_active ? "border-green-200" : ""}>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="mt-1 h-5 w-5 text-blue-600" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{profile.name} — v{profile.version}</p>
                    {profile.is_active && <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="ml-1 h-3 w-3" />نشط</Badge>}
                    <Badge variant="outline">{profileModeLabel(profile)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    شيت {profile.sheet_name || "الأول"} · صف العناوين {profile.header_row} · {Object.keys(profile.header_mapping).length} عمودًا · {profile.default_currency}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">{profile.approval_note || "لا توجد ملاحظة اعتماد"}</p>
                </div>
              </div>
              {!profile.is_active && <Button variant="outline" disabled={working === "activate"} onClick={() => void activate(profile.id)}>تفعيل هذا الإصدار</Button>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
