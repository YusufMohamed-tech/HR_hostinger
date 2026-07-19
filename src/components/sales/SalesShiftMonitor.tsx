"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Clock3, Target } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  getSalesShiftMonitor,
  respondSalesShiftPrompt,
  type SalesShiftMonitorPrompt,
} from "@/lib/services/sales";
import { useRoleContext } from "@/providers/RoleProvider";
import { formatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";

function isSalesRole(role?: string | null) {
  const normalized = String(role || "").toLowerCase().replace(/-/g, "_");
  return normalized === "sales" || normalized === "sales_manager";
}

function maybeNotify(prompt: SalesShiftMonitorPrompt) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  const show = () => {
    try {
      new Notification(prompt.title, { body: prompt.body });
    } catch {
      // Browser notification support varies; the in-app popup is the reliable channel.
    }
  };

  if (Notification.permission === "granted") show();
  else if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") show();
    }).catch(() => undefined);
  }
}

export function SalesShiftMonitor() {
  const { currentUser, loading } = useRoleContext();
  const router = useRouter();
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<SalesShiftMonitorPrompt | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seenPromptRef = useRef("");

  const canMonitor = useMemo(() => (
    !loading &&
    Boolean(currentUser) &&
    (isSalesRole(currentUser?.orgMembershipRole) || isSalesRole(currentUser?.role))
  ), [currentUser, loading]);

  const load = useCallback(async () => {
    if (!canMonitor || pathname?.startsWith("/login")) return;
    const result = await getSalesShiftMonitor();
    if (result.error || !result.data) return;
    setPrompt(result.data.prompt);
    if (result.data.prompt) {
      const signature = `${result.data.prompt.type}:${result.data.prompt.key}:${result.data.prompt.company_id}`;
      if (seenPromptRef.current !== signature) {
        seenPromptRef.current = signature;
        setReason("");
        setError("");
        maybeNotify(result.data.prompt);
      }
    }
  }, [canMonitor, pathname]);

  useEffect(() => {
    load();
    if (!canMonitor) return undefined;
    const timer = window.setInterval(load, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canMonitor, load]);

  const respond = async (action: "snooze" | "acknowledge" | "open_sales" | "submit_reason") => {
    if (!prompt) return;
    if (action === "submit_reason" && reason.trim().length < 5) {
      setError("اكتب سببًا واضحًا قبل الإرسال.");
      return;
    }

    setBusy(true);
    setError("");
    const result = await respondSalesShiftPrompt({
      prompt_id: prompt.id,
      expected_version: prompt.version,
      prompt_type: prompt.type,
      prompt_key: prompt.key,
      company_id: prompt.company_id,
      action,
      reason: reason.trim(),
    });
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (action === "open_sales") {
      setPrompt(null);
      router.push(prompt.action_url);
      return;
    }

    setPrompt(result.data?.prompt || null);
  };

  const progress = prompt ? Math.min(100, Math.max(0, prompt.progress_percent)) : 0;
  const required = Boolean(prompt?.requires_reason);

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open && !required) setPrompt(null);
      }}
    >
      <DialogContent dir="rtl" showCloseButton={!required} className="sm:max-w-[520px]">
        {prompt && (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                {prompt.type === "hourly" ? <Clock3 className="h-6 w-6" /> : prompt.type === "mid_shift" ? <BellRing className="h-6 w-6" /> : <Target className="h-6 w-6" />}
              </div>
              <DialogTitle className="text-xl font-bold text-gray-950">{prompt.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm leading-6 text-gray-600">{prompt.body}</p>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-500">الشركة</p>
                    <p className="font-bold text-gray-950">{prompt.company_name}</p>
                  </div>
                  <Badge variant="outline" className="bg-white text-brand">{prompt.progress_percent}%</Badge>
                </div>
                <div className="h-2 rounded-full bg-gray-200">
                  <div className={cn("h-2 rounded-full", progress >= 100 ? "bg-green-600" : progress >= 40 ? "bg-brand" : "bg-amber-500")} style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-white p-2">
                    <p className="text-gray-500">الهدف</p>
                    <p className="mt-1 font-bold text-gray-950">{formatCurrency(prompt.target_amount, 0)}</p>
                  </div>
                  <div className="rounded-lg bg-white p-2">
                    <p className="text-gray-500">المحقق</p>
                    <p className="mt-1 font-bold text-brand">{formatCurrency(prompt.achieved_amount, 0)}</p>
                  </div>
                  <div className="rounded-lg bg-white p-2">
                    <p className="text-gray-500">المتبقي</p>
                    <p className="mt-1 font-bold text-red-600">{formatCurrency(prompt.remaining_amount, 0)}</p>
                  </div>
                </div>
              </div>

              {required && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-900">سبب عدم تحقيق الهدف *</label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="اكتب السبب هنا، مثل ضعف الإقبال أو نقص المنتجات أو مشكلة في الموقع..."
                    className="min-h-28 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <p className="text-xs text-gray-500">هذا السبب إلزامي إذا لم يتم تحقيق هدف اليوم قبل نهاية الوردية.</p>
                </div>
              )}

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            </div>

            <DialogFooter className="sm:justify-start">
              <Button
                className="bg-brand text-white hover:bg-brand-dark"
                disabled={busy || (required && reason.trim().length < 5)}
                onClick={() => required ? respond("submit_reason") : respond("open_sales")}
              >
                {required ? "إرسال السبب" : "تسجيل مبيعات الآن"}
              </Button>
              {required ? (
                <Button variant="outline" disabled={busy} onClick={() => respond("open_sales")}>تسجيل مبيعات أولًا</Button>
              ) : (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => respond("snooze")}>ذكرني لاحقًا</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => respond("acknowledge")}>تم الاطلاع</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
