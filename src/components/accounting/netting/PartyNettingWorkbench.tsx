"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountingEntity } from "@/providers/AccountingEntityProvider";
import { AccountingEmptyState, AccountingLoading, MoneyAmount } from "@/components/accounting/AccountingPrimitives";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PartyRole {
  id: string;
  party_id: string;
  party_name_ar?: string;
  name_ar?: string;
  role_type: string;
  [key: string]: unknown;
}

interface DualRoleParty {
  party_id: string;
  name_ar: string;
}

interface OpenItem {
  id: string;
  document_no: string;
  document_date: string;
  due_date: string;
  original_amount: number;
  outstanding_amount: number;
  currency_code?: string;
  direction: "receivable" | "payable";
  [key: string]: unknown;
}

interface NettingAllocation {
  open_item_id: string;
  direction: "receivable" | "payable";
  allocated_amount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  try {
    return new Date(date).toLocaleDateString("ar-SA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return date;
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PartyNettingWorkbench() {
  const { entityHeader, functionalCurrency } = useAccountingEntity();

  // Party selection
  const [parties, setParties] = useState<DualRoleParty[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [loadingParties, setLoadingParties] = useState(true);
  const [partyError, setPartyError] = useState<string | null>(null);

  // Open items
  const [arItems, setArItems] = useState<OpenItem[]>([]);
  const [apItems, setApItems] = useState<OpenItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // Selections & allocations
  const [selectedAr, setSelectedAr] = useState<Record<string, number>>({});
  const [selectedAp, setSelectedAp] = useState<Record<string, number>>({});

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Netting date
  const [nettingDate, setNettingDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );

  // ---------- Fetch parties with dual roles ----------
  useEffect(() => {
    if (!entityHeader) return;
    let cancelled = false;

    async function loadParties() {
      setLoadingParties(true);
      setPartyError(null);
      try {
        const res = await fetch("/api/accounting/party-roles", {
          headers: { "X-Accounting-Entity-Id": entityHeader! },
        });
        if (!res.ok) throw new Error("فشل تحميل بيانات الأطراف.");
        const json = await res.json();
        const roles: PartyRole[] = json.data || [];

        // Group by party_id and find parties with both customer and vendor roles
        const partyMap = new Map<string, { roles: Set<string>; name: string }>();
        for (const role of roles) {
          const pid = role.party_id;
          if (!partyMap.has(pid)) {
            partyMap.set(pid, {
              roles: new Set(),
              name: role.party_name_ar || role.name_ar || pid,
            });
          }
          partyMap.get(pid)!.roles.add(role.role_type);
        }

        const dualParties: DualRoleParty[] = [];
        for (const [partyId, info] of partyMap) {
          if (info.roles.has("customer") && info.roles.has("vendor")) {
            dualParties.push({ party_id: partyId, name_ar: info.name });
          }
        }

        if (!cancelled) setParties(dualParties);
      } catch (err) {
        if (!cancelled) setPartyError(err instanceof Error ? err.message : "خطأ غير متوقع.");
      } finally {
        if (!cancelled) setLoadingParties(false);
      }
    }

    loadParties();
    return () => { cancelled = true; };
  }, [entityHeader]);

  // ---------- Fetch open items when party selected ----------
  const loadOpenItems = useCallback(
    async (partyId: string) => {
      if (!entityHeader || !partyId) return;
      setLoadingItems(true);
      setItemsError(null);
      setSelectedAr({});
      setSelectedAp({});
      setSubmitSuccess(false);
      setSubmitError(null);

      try {
        const headers = { "X-Accounting-Entity-Id": entityHeader };
        const [arRes, apRes] = await Promise.all([
          fetch(`/api/accounting/open-items?party_id=${partyId}&direction=receivable`, { headers }),
          fetch(`/api/accounting/open-items?party_id=${partyId}&direction=payable`, { headers }),
        ]);

        if (!arRes.ok || !apRes.ok) throw new Error("فشل تحميل البنود المفتوحة.");

        const arJson = await arRes.json();
        const apJson = await apRes.json();
        setArItems(arJson.data || []);
        setApItems(apJson.data || []);
      } catch (err) {
        setItemsError(err instanceof Error ? err.message : "خطأ غير متوقع.");
      } finally {
        setLoadingItems(false);
      }
    },
    [entityHeader]
  );

  useEffect(() => {
    if (selectedPartyId) {
      loadOpenItems(selectedPartyId);
    } else {
      setArItems([]);
      setApItems([]);
    }
  }, [selectedPartyId, loadOpenItems]);

  // ---------- Totals ----------
  const totalArSelected = useMemo(
    () => roundMoney(Object.values(selectedAr).reduce((sum, v) => sum + v, 0)),
    [selectedAr]
  );

  const totalApSelected = useMemo(
    () => roundMoney(Object.values(selectedAp).reduce((sum, v) => sum + v, 0)),
    [selectedAp]
  );

  const nettingAmount = useMemo(
    () => roundMoney(Math.min(totalArSelected, totalApSelected)),
    [totalArSelected, totalApSelected]
  );

  // ---------- Toggle / allocate handlers ----------
  function toggleArItem(item: OpenItem, checked: boolean) {
    setSelectedAr((prev) => {
      const next = { ...prev };
      if (checked) {
        next[item.id] = item.outstanding_amount;
      } else {
        delete next[item.id];
      }
      return next;
    });
  }

  function toggleApItem(item: OpenItem, checked: boolean) {
    setSelectedAp((prev) => {
      const next = { ...prev };
      if (checked) {
        next[item.id] = item.outstanding_amount;
      } else {
        delete next[item.id];
      }
      return next;
    });
  }

  function updateArAllocation(itemId: string, value: number, max: number) {
    const clamped = roundMoney(Math.max(0, Math.min(value, max)));
    setSelectedAr((prev) => ({ ...prev, [itemId]: clamped }));
  }

  function updateApAllocation(itemId: string, value: number, max: number) {
    const clamped = roundMoney(Math.max(0, Math.min(value, max)));
    setSelectedAp((prev) => ({ ...prev, [itemId]: clamped }));
  }

  // ---------- Submit ----------
  async function handleSubmit() {
    if (!entityHeader || !selectedPartyId || nettingAmount <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    const allocations: NettingAllocation[] = [];

    for (const [itemId, amount] of Object.entries(selectedAr)) {
      if (amount > 0) {
        allocations.push({
          open_item_id: itemId,
          direction: "receivable",
          allocated_amount: amount,
        });
      }
    }
    for (const [itemId, amount] of Object.entries(selectedAp)) {
      if (amount > 0) {
        allocations.push({
          open_item_id: itemId,
          direction: "payable",
          allocated_amount: amount,
        });
      }
    }

    try {
      const res = await fetch("/api/accounting/party-nettings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Accounting-Entity-Id": entityHeader,
        },
        body: JSON.stringify({
          party_id: selectedPartyId,
          netting_date: nettingDate,
          currency_code: functionalCurrency,
          total_amount: nettingAmount,
          allocations,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "فشل إنشاء المقاصة.");
      }

      setSubmitSuccess(true);
      // Reload open items after successful netting
      loadOpenItems(selectedPartyId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "خطأ غير متوقع.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- Render ----------
  if (loadingParties) return <AccountingLoading />;

  return (
    <div dir="rtl" className="grid gap-6">
      {/* Party Selector */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-gray-700">الطرف</label>
              {partyError ? (
                <p className="text-sm text-red-600">{partyError}</p>
              ) : parties.length === 0 ? (
                <p className="text-sm text-gray-500">لا يوجد أطراف لديهم دور مزدوج (عميل + مورد).</p>
              ) : (
                <Select value={selectedPartyId} onValueChange={(v) => setSelectedPartyId(v || "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الطرف..." />
                  </SelectTrigger>
                  <SelectContent>
                    {parties.map((p) => (
                      <SelectItem key={p.party_id} value={p.party_id}>
                        {p.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-gray-700">تاريخ المقاصة</label>
              <Input
                type="date"
                value={nettingDate}
                onChange={(e) => setNettingDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Open Items */}
      {selectedPartyId && (
        <>
          {loadingItems ? (
            <AccountingLoading />
          ) : itemsError ? (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-red-600">{itemsError}</p>
              </CardContent>
            </Card>
          ) : arItems.length === 0 && apItems.length === 0 ? (
            <AccountingEmptyState
              title="لا توجد بنود مفتوحة"
              description="لا يوجد بنود مستحقة للطرف المحدد."
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* AR Table */}
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">ذمم مدينة (مستحقات لنا)</h3>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {arItems.length}
                    </Badge>
                  </div>
                  {arItems.length === 0 ? (
                    <p className="text-sm text-gray-500">لا توجد بنود مدينة مفتوحة.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>رقم المستند</TableHead>
                            <TableHead>التاريخ</TableHead>
                            <TableHead>الاستحقاق</TableHead>
                            <TableHead>المبلغ الأصلي</TableHead>
                            <TableHead>المتبقي</TableHead>
                            <TableHead>المخصص</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {arItems.map((item) => {
                            const isChecked = item.id in selectedAr;
                            return (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => toggleArItem(item, checked)}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {item.document_no || "-"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {formatDate(item.document_date)}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {formatDate(item.due_date)}
                                </TableCell>
                                <TableCell>
                                  <MoneyAmount value={item.original_amount} />
                                </TableCell>
                                <TableCell>
                                  <MoneyAmount value={item.outstanding_amount} className="font-semibold" />
                                </TableCell>
                                <TableCell>
                                  {isChecked && (
                                    <Input
                                      type="number"
                                      min={0}
                                      max={item.outstanding_amount}
                                      step={0.01}
                                      value={selectedAr[item.id] ?? 0}
                                      onChange={(e) =>
                                        updateArAllocation(item.id, parseFloat(e.target.value) || 0, item.outstanding_amount)
                                      }
                                      className="w-28"
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {Object.keys(selectedAr).length > 0 && (
                    <div className="mt-3 flex items-center justify-between border-t pt-3">
                      <span className="text-sm font-medium text-gray-700">إجمالي المدين المحدد:</span>
                      <MoneyAmount value={totalArSelected} className="font-bold text-green-700" />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* AP Table */}
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">ذمم دائنة (مستحقات عليها)</h3>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      {apItems.length}
                    </Badge>
                  </div>
                  {apItems.length === 0 ? (
                    <p className="text-sm text-gray-500">لا توجد بنود دائنة مفتوحة.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>رقم المستند</TableHead>
                            <TableHead>التاريخ</TableHead>
                            <TableHead>الاستحقاق</TableHead>
                            <TableHead>المبلغ الأصلي</TableHead>
                            <TableHead>المتبقي</TableHead>
                            <TableHead>المخصص</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {apItems.map((item) => {
                            const isChecked = item.id in selectedAp;
                            return (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => toggleApItem(item, checked)}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {item.document_no || "-"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {formatDate(item.document_date)}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {formatDate(item.due_date)}
                                </TableCell>
                                <TableCell>
                                  <MoneyAmount value={item.original_amount} />
                                </TableCell>
                                <TableCell>
                                  <MoneyAmount value={item.outstanding_amount} className="font-semibold" />
                                </TableCell>
                                <TableCell>
                                  {isChecked && (
                                    <Input
                                      type="number"
                                      min={0}
                                      max={item.outstanding_amount}
                                      step={0.01}
                                      value={selectedAp[item.id] ?? 0}
                                      onChange={(e) =>
                                        updateApAllocation(item.id, parseFloat(e.target.value) || 0, item.outstanding_amount)
                                      }
                                      className="w-28"
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {Object.keys(selectedAp).length > 0 && (
                    <div className="mt-3 flex items-center justify-between border-t pt-3">
                      <span className="text-sm font-medium text-gray-700">إجمالي الدائن المحدد:</span>
                      <MoneyAmount value={totalApSelected} className="font-bold text-red-700" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Netting Preview & Submit */}
          {nettingAmount > 0 && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">معاينة قيد المقاصة</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-xs text-gray-500">إجمالي المدين المحدد</p>
                    <MoneyAmount value={totalArSelected} className="mt-1 text-lg font-bold text-green-700" />
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-xs text-gray-500">إجمالي الدائن المحدد</p>
                    <MoneyAmount value={totalApSelected} className="mt-1 text-lg font-bold text-red-700" />
                  </div>
                  <div className="rounded-lg border border-blue-300 bg-white p-3">
                    <p className="text-xs text-gray-500">مبلغ المقاصة</p>
                    <MoneyAmount value={nettingAmount} className="mt-1 text-lg font-bold text-blue-700" />
                  </div>
                </div>

                {/* Journal Preview */}
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
                  <p className="mb-2 text-xs font-medium text-gray-600">القيد المحاسبي المتوقع:</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>البيان</TableHead>
                        <TableHead>مدين</TableHead>
                        <TableHead>دائن</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-sm">حساب الذمم الدائنة (AP)</TableCell>
                        <TableCell>
                          <MoneyAmount value={nettingAmount} className="font-semibold" />
                        </TableCell>
                        <TableCell>-</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm">حساب الذمم المدينة (AR)</TableCell>
                        <TableCell>-</TableCell>
                        <TableCell>
                          <MoneyAmount value={nettingAmount} className="font-semibold" />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Submit */}
                <div className="mt-4 flex items-center gap-3">
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || nettingAmount <= 0}
                  >
                    {submitting ? "جارٍ الإنشاء..." : "إنشاء المقاصة"}
                  </Button>
                  {submitError && (
                    <p className="text-sm text-red-600">{submitError}</p>
                  )}
                  {submitSuccess && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      تم إنشاء المقاصة بنجاح
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
