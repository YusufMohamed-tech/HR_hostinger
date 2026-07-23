"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, GitBranch, BookOpen, Users, Coins, CalendarDays, Plus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AccountingPageHeader,
  AccountingLoading,
  AccountingEmptyState,
  AccountingStatusBadge,
} from "@/components/accounting/AccountingPrimitives";
import {
  getLegalEntities,
  saveLegalEntity,
  getAccountingBranches,
  saveAccountingBranch,
  getAccountingBooks,
  saveAccountingBook,
  getAccountingCurrencies,
  saveAccountingCurrency,
  getAccountingExchangeRates,
  saveAccountingExchangeRate,
  approveAccountingExchangeRate,
  getAccountingFiscalCalendars,
  saveAccountingFiscalCalendar,
  getAccountingUserScopes,
  saveAccountingUserScope,
  revokeAccountingUserScope,
  backfillDefaultEntity,
} from "@/lib/services/accounting";
import type {
  AccountingLegalEntity,
  AccountingBranch,
  AccountingBook,
  AccountingCurrency,
  AccountingExchangeRate,
  AccountingFiscalCalendar,
  AccountingUserScope,
} from "@/types/accounting";

type EntityTab = "entities" | "branches" | "books" | "currencies" | "rates" | "calendars" | "scopes";

function useLoad<T>(loader: () => Promise<{ data: T | null; error: string | null }>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loader();
    if (result.error) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
      setError("");
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, setError, load };
}

export function EntityManagementPage() {
  const [tab, setTab] = useState<EntityTab>("entities");

  const tabs: { key: EntityTab; label: string; icon: React.ReactNode }[] = [
    { key: "entities", label: "الكيانات القانونية", icon: <Building2 className="w-4 h-4" /> },
    { key: "branches", label: "الفروع", icon: <GitBranch className="w-4 h-4" /> },
    { key: "books", label: "الدفاتر", icon: <BookOpen className="w-4 h-4" /> },
    { key: "currencies", label: "العملات", icon: <Coins className="w-4 h-4" /> },
    { key: "rates", label: "أسعار الصرف", icon: <Coins className="w-4 h-4" /> },
    { key: "calendars", label: "التقويمات المالية", icon: <CalendarDays className="w-4 h-4" /> },
    { key: "scopes", label: "صلاحيات المستخدمين", icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      <AccountingPageHeader
        title="إعدادات الكيانات القانونية"
        description="إدارة الشركات والفروع والعملات والتقويمات المالية"
      />
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
            className="gap-1"
          >
            {t.icon}
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "entities" && <LegalEntitiesSection />}
      {tab === "branches" && <BranchesSection />}
      {tab === "books" && <BooksSection />}
      {tab === "currencies" && <CurrenciesSection />}
      {tab === "rates" && <ExchangeRatesSection />}
      {tab === "calendars" && <CalendarsSection />}
      {tab === "scopes" && <UserScopesSection />}
    </div>
  );
}

function LegalEntitiesSection() {
  const { data: entities, loading, error, load } = useLoad(() => getLegalEntities(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", vat_number: "", commercial_registration: "", functional_currency_code: "SAR", country: "SA" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    if (!form.code || !form.name_ar) { setMsg("الرمز والاسم العربي مطلوبان"); return; }
    setSaving(true);
    const result = await saveLegalEntity(form);
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ code: "", name_ar: "", name_en: "", vat_number: "", commercial_registration: "", functional_currency_code: "SAR", country: "SA" });
    load();
  };

  const handleBackfill = async () => {
    setSaving(true);
    const result = await backfillDefaultEntity();
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setMsg("تم إنشاء الكيان الافتراضي بنجاح");
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 ml-1" /> إضافة كيان
        </Button>
        {(!entities || entities.length === 0) && (
          <Button size="sm" variant="outline" onClick={handleBackfill} disabled={saving}>
            تهيئة كيان افتراضي
          </Button>
        )}
      </div>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>الرمز *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="COMP-01" /></div>
            <div><Label>الاسم (عربي) *</Label><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
            <div><Label>الاسم (إنجليزي)</Label><Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></div>
            <div><Label>الرقم الضريبي</Label><Input value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} /></div>
            <div><Label>السجل التجاري</Label><Input value={form.commercial_registration} onChange={(e) => setForm({ ...form, commercial_registration: e.target.value })} /></div>
            <div><Label>العملة الوظيفية</Label><Input value={form.functional_currency_code} onChange={(e) => setForm({ ...form, functional_currency_code: e.target.value })} /></div>
            <div className="md:col-span-3 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {entities && entities.length > 0 ? (
        <div className="grid gap-3">
          {entities.map((entity: AccountingLegalEntity) => (
            <Card key={entity.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {entity.name_ar}
                    {entity.is_default && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">افتراضي</span>}
                  </CardTitle>
                  <AccountingStatusBadge status={entity.status} />
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
                <div><span className="font-medium">الرمز:</span> {entity.code}</div>
                <div><span className="font-medium">العملة:</span> {entity.functional_currency_code}</div>
                {entity.vat_number && <div><span className="font-medium">الرقم الضريبي:</span> {entity.vat_number}</div>}
                {entity.commercial_registration && <div><span className="font-medium">السجل التجاري:</span> {entity.commercial_registration}</div>}
                {entity.name_en && <div><span className="font-medium">English:</span> {entity.name_en}</div>}
                <div><span className="font-medium">الدولة:</span> {entity.country}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد كيانات قانونية. أنشئ كيانًا جديدًا أو استخدم التهيئة الافتراضية." />
      )}
    </div>
  );
}

function BranchesSection() {
  const { data: branches, loading, load } = useLoad(() => getAccountingBranches(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", legal_entity_id: "" });
  const [entities, setEntities] = useState<AccountingLegalEntity[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { getLegalEntities().then((r) => { if (r.data) setEntities(r.data); }); }, []);

  const handleSave = async () => {
    if (!form.code || !form.name_ar || !form.legal_entity_id) { setMsg("الرمز والاسم والكيان مطلوبة"); return; }
    setSaving(true);
    const result = await saveAccountingBranch(form);
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ code: "", name_ar: "", name_en: "", legal_entity_id: "" });
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة فرع
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>الكيان القانوني *</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.legal_entity_id} onChange={(e) => setForm({ ...form, legal_entity_id: e.target.value })}>
                <option value="">اختر...</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name_ar} ({e.code})</option>)}
              </select>
            </div>
            <div><Label>الرمز *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BR-01" /></div>
            <div><Label>الاسم (عربي) *</Label><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
            <div><Label>الاسم (إنجليزي)</Label><Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></div>
            <div className="md:col-span-3 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {branches && branches.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">الرمز</th><th className="p-2 text-right">الاسم</th><th className="p-2 text-right">الكيان</th><th className="p-2 text-right">الحالة</th></tr>
            </thead>
            <tbody>
              {branches.map((b: AccountingBranch) => (
                <tr key={b.id} className="border-t">
                  <td className="p-2">{b.code}</td>
                  <td className="p-2">{b.name_ar}</td>
                  <td className="p-2">{entities.find((e) => e.id === b.legal_entity_id)?.name_ar || b.legal_entity_id?.slice(0, 8)}</td>
                  <td className="p-2">{b.is_active ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-600" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد فروع." />
      )}
    </div>
  );
}

function BooksSection() {
  const { data: books, loading, load } = useLoad(() => getAccountingBooks(), []);
  const [entities, setEntities] = useState<AccountingLegalEntity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", legal_entity_id: "", book_type: "statutory", functional_currency_code: "SAR" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { getLegalEntities().then((r) => { if (r.data) setEntities(r.data); }); }, []);

  const handleSave = async () => {
    if (!form.code || !form.name_ar || !form.legal_entity_id) { setMsg("الرمز والاسم والكيان مطلوبة"); return; }
    setSaving(true);
    const result = await saveAccountingBook(form);
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة دفتر
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>الكيان القانوني *</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.legal_entity_id} onChange={(e) => setForm({ ...form, legal_entity_id: e.target.value })}>
                <option value="">اختر...</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name_ar} ({e.code})</option>)}
              </select>
            </div>
            <div><Label>الرمز *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><Label>الاسم (عربي) *</Label><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
            <div>
              <Label>النوع</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.book_type} onChange={(e) => setForm({ ...form, book_type: e.target.value })}>
                <option value="statutory">نظامي</option>
                <option value="management">إداري</option>
                <option value="tax">ضريبي</option>
              </select>
            </div>
            <div><Label>العملة</Label><Input value={form.functional_currency_code} onChange={(e) => setForm({ ...form, functional_currency_code: e.target.value })} /></div>
            <div className="md:col-span-3 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {books && books.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">الرمز</th><th className="p-2 text-right">الاسم</th><th className="p-2 text-right">النوع</th><th className="p-2 text-right">العملة</th><th className="p-2 text-right">الحالة</th></tr>
            </thead>
            <tbody>
              {books.map((b: AccountingBook) => (
                <tr key={b.id} className="border-t">
                  <td className="p-2">{b.code}</td>
                  <td className="p-2">{b.name_ar}</td>
                  <td className="p-2">{b.book_type === "statutory" ? "نظامي" : b.book_type === "management" ? "إداري" : b.book_type}</td>
                  <td className="p-2">{b.functional_currency_code}</td>
                  <td className="p-2"><AccountingStatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد دفاتر محاسبية." />
      )}
    </div>
  );
}

function CurrenciesSection() {
  const { data: currencies, loading, load } = useLoad(() => getAccountingCurrencies(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", symbol: "", minor_units: "2" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    if (!form.code || !form.name_ar) { setMsg("رمز العملة والاسم العربي مطلوبان"); return; }
    setSaving(true);
    const result = await saveAccountingCurrency({ ...form, minor_units: Number(form.minor_units) });
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ code: "", name_ar: "", name_en: "", symbol: "", minor_units: "2" });
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة عملة
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><Label>الرمز (ISO) *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="USD" maxLength={3} /></div>
            <div><Label>الاسم (عربي) *</Label><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
            <div><Label>الاسم (إنجليزي)</Label><Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></div>
            <div><Label>الرمز</Label><Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="$" /></div>
            <div className="md:col-span-4 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {currencies && currencies.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">الرمز</th><th className="p-2 text-right">الاسم</th><th className="p-2 text-right">الرمز</th><th className="p-2 text-right">خانات عشرية</th><th className="p-2 text-right">فعّالة</th></tr>
            </thead>
            <tbody>
              {currencies.map((c: AccountingCurrency) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2 font-mono">{c.code}</td>
                  <td className="p-2">{c.name_ar}</td>
                  <td className="p-2">{c.symbol || "-"}</td>
                  <td className="p-2">{c.minor_units}</td>
                  <td className="p-2">{c.is_active ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-600" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد عملات." />
      )}
    </div>
  );
}

function ExchangeRatesSection() {
  const { data: rates, loading, load } = useLoad(() => getAccountingExchangeRates(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ from_currency_code: "", to_currency_code: "SAR", rate_date: new Date().toISOString().slice(0, 10), rate_type: "spot", rate: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    if (!form.from_currency_code || !form.rate) { setMsg("العملة والسعر مطلوبان"); return; }
    setSaving(true);
    const result = await saveAccountingExchangeRate(form);
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ from_currency_code: "", to_currency_code: "SAR", rate_date: new Date().toISOString().slice(0, 10), rate_type: "spot", rate: "" });
    load();
  };

  const handleApprove = async (id: string) => {
    const result = await approveAccountingExchangeRate(id);
    if (result.error) { setMsg(result.error); return; }
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة سعر صرف
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div><Label>من عملة *</Label><Input value={form.from_currency_code} onChange={(e) => setForm({ ...form, from_currency_code: e.target.value.toUpperCase() })} placeholder="USD" /></div>
            <div><Label>إلى عملة</Label><Input value={form.to_currency_code} onChange={(e) => setForm({ ...form, to_currency_code: e.target.value.toUpperCase() })} /></div>
            <div><Label>التاريخ</Label><Input type="date" value={form.rate_date} onChange={(e) => setForm({ ...form, rate_date: e.target.value })} /></div>
            <div>
              <Label>النوع</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}>
                <option value="spot">فوري</option>
                <option value="average">متوسط</option>
                <option value="closing">إقفال</option>
                <option value="historical">تاريخي</option>
              </select>
            </div>
            <div><Label>السعر *</Label><Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="3.75" /></div>
            <div className="md:col-span-5 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {rates && rates.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">من</th><th className="p-2 text-right">إلى</th><th className="p-2 text-right">التاريخ</th><th className="p-2 text-right">النوع</th><th className="p-2 text-right">السعر</th><th className="p-2 text-right">معتمد</th></tr>
            </thead>
            <tbody>
              {rates.map((r: AccountingExchangeRate) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.from_currency_code}</td>
                  <td className="p-2 font-mono">{r.to_currency_code}</td>
                  <td className="p-2">{r.rate_date}</td>
                  <td className="p-2">{r.rate_type}</td>
                  <td className="p-2 font-mono">{r.rate}</td>
                  <td className="p-2">
                    {r.is_approved ? <Check className="w-4 h-4 text-green-600" /> : (
                      <Button size="sm" variant="outline" onClick={() => handleApprove(r.id)}>اعتماد</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد أسعار صرف." />
      )}
    </div>
  );
}

function CalendarsSection() {
  const { data: calendars, loading, load } = useLoad(() => getAccountingFiscalCalendars(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name_ar: "", name_en: "", start_month: "1" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async () => {
    if (!form.code || !form.name_ar) { setMsg("الرمز والاسم مطلوبان"); return; }
    setSaving(true);
    const result = await saveAccountingFiscalCalendar({ ...form, start_month: Number(form.start_month) });
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ code: "", name_ar: "", name_en: "", start_month: "1" });
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة تقويم مالي
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><Label>الرمز *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="FY-JAN" /></div>
            <div><Label>الاسم (عربي) *</Label><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
            <div><Label>الاسم (إنجليزي)</Label><Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></div>
            <div>
              <Label>شهر البداية</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.start_month} onChange={(e) => setForm({ ...form, start_month: e.target.value })}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
              </select>
            </div>
            <div className="md:col-span-4 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {calendars && calendars.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">الرمز</th><th className="p-2 text-right">الاسم</th><th className="p-2 text-right">شهر البداية</th><th className="p-2 text-right">فعّال</th></tr>
            </thead>
            <tbody>
              {calendars.map((c: AccountingFiscalCalendar) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2">{c.code}</td>
                  <td className="p-2">{c.name_ar}</td>
                  <td className="p-2">{c.start_month}</td>
                  <td className="p-2">{c.is_active ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-600" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد تقويمات مالية." />
      )}
    </div>
  );
}

function UserScopesSection() {
  const { data: scopes, loading, load } = useLoad(() => getAccountingUserScopes(), []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ user_id: "", legal_entity_id: "", capability_group: "full" });
  const [entities, setEntities] = useState<AccountingLegalEntity[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { getLegalEntities().then((r) => { if (r.data) setEntities(r.data); }); }, []);

  const handleSave = async () => {
    if (!form.user_id || !form.legal_entity_id) { setMsg("المستخدم والكيان مطلوبان"); return; }
    setSaving(true);
    const result = await saveAccountingUserScope(form);
    setSaving(false);
    if (result.error) { setMsg(result.error); return; }
    setShowForm(false);
    setForm({ user_id: "", legal_entity_id: "", capability_group: "full" });
    load();
  };

  const handleRevoke = async (id: string) => {
    const result = await revokeAccountingUserScope(id);
    if (result.error) { setMsg(result.error); return; }
    load();
  };

  if (loading) return <AccountingLoading />;

  return (
    <div className="space-y-4">
      {msg && <p className="text-blue-600 text-sm">{msg}</p>}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="w-4 h-4 ml-1" /> إضافة صلاحية
      </Button>
      {showForm && (
        <Card>
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>معرف المستخدم *</Label><Input value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} placeholder="UUID" /></div>
            <div>
              <Label>الكيان القانوني *</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.legal_entity_id} onChange={(e) => setForm({ ...form, legal_entity_id: e.target.value })}>
                <option value="">اختر...</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name_ar}</option>)}
              </select>
            </div>
            <div>
              <Label>مجموعة الصلاحيات</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.capability_group} onChange={(e) => setForm({ ...form, capability_group: e.target.value })}>
                <option value="full">كاملة</option>
                <option value="branch_only">فرع فقط</option>
                <option value="view_only">عرض فقط</option>
              </select>
            </div>
            <div className="md:col-span-3 flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {scopes && scopes.length > 0 ? (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-right">المستخدم</th><th className="p-2 text-right">الكيان</th><th className="p-2 text-right">الصلاحية</th><th className="p-2 text-right">فعّالة</th><th className="p-2 text-right">إجراء</th></tr>
            </thead>
            <tbody>
              {scopes.map((s: AccountingUserScope) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{s.user_id.slice(0, 8)}...</td>
                  <td className="p-2">{entities.find((e) => e.id === s.legal_entity_id)?.name_ar || s.legal_entity_id.slice(0, 8)}</td>
                  <td className="p-2">{s.capability_group === "full" ? "كاملة" : s.capability_group === "branch_only" ? "فرع" : "عرض"}</td>
                  <td className="p-2">{s.is_active ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4 text-red-600" />}</td>
                  <td className="p-2">
                    {s.is_active && <Button size="sm" variant="destructive" onClick={() => handleRevoke(s.id)}>إلغاء</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AccountingEmptyState title="لا توجد صلاحيات مخصصة." />
      )}
    </div>
  );
}
