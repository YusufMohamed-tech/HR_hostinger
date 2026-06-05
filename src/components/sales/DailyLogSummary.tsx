"use client";

import React from "react";
import { ShoppingCart } from "lucide-react";

export function DailyLogSummary({
  totalItems,
  subtotal,
  discount,
  total,
}: {
  totalItems: number;
  subtotal: number;
  discount: number;
  total: number;
}) {
  const format = (value: number) => `${value.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} جنيه`;

  return (
    <div className="sticky top-4 z-10 grid gap-3 rounded-lg border border-brand/20 bg-white/95 p-4 shadow-sm backdrop-blur sm:grid-cols-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">العناصر</p>
          <p className="font-bold text-gray-950">{totalItems}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500">قبل الخصم</p>
        <p className="font-bold text-gray-950">{format(subtotal)}</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">إجمالي الخصم</p>
        <p className="font-bold text-red-600">{format(discount)}</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">الإجمالي النهائي</p>
        <p className="text-lg font-bold text-brand-dark">{format(total)}</p>
      </div>
    </div>
  );
}
