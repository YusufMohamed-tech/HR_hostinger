"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRoleContext } from "@/providers/RoleProvider";

const STORAGE_KEY = "phase2_announcement_dismissed_v1";
const EXPIRY_DATE = new Date("2026-08-06T00:00:00.000Z"); // visible until end of 5 Aug

const FEATURES = [
  "دفتر الأستاذ العام — عمود مركز التكلفة مع فلتر مستقل",
  "القيود اليومية — بحث واختيار الحسابات بالاسم أو الرقم",
  "القيود اليومية — إرفاق مستندات داعمة لكل قيد",
  "العملاء والموردون — صلاحيات إنشاء وتعديل وحذف قابلة للضبط",
  "أنواع القيود — ترقيم مستقل وصيغة مخصصة لكل نوع",
  "الخدمات البنكية — استيراد كشوف الحساب والمطابقة والتسوية",
];

export function Phase2AnnouncementBanner() {
  const { currentUser } = useRoleContext();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (currentUser?.role !== "Finance_Manager") return;
    if (new Date() >= EXPIRY_DATE) return;
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) return;
    setVisible(true);
  }, [currentUser?.role]);

  const dismiss = () => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="relative mb-6 rounded-xl border border-brand/30 bg-brand/5 px-5 py-4 shadow-sm">
      <button
        onClick={dismiss}
        className="absolute left-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label="إغلاق"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="mb-3 text-sm font-semibold text-brand">
        ✦ تحديثات جديدة — تم تفعيلها الآن
      </p>

      <ul className="space-y-1.5">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
            <span className="mt-0.5 text-brand">•</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-gray-400">هذا الإشعار يظهر حتى 5 أغسطس 2026</p>
    </div>
  );
}
