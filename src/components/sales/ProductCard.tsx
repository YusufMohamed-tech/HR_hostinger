"use client";

import React from "react";
import { Minus, Plus, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SalesProduct } from "@/lib/services/sales";
import { formatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";

export function ProductCard({
  product,
  quantity,
  discountPercent,
  yesterdayQuantity,
  onQuantityChange,
  onDiscountChange,
}: {
  product: SalesProduct;
  quantity: number;
  discountPercent: number;
  yesterdayQuantity?: number;
  onQuantityChange: (quantity: number) => void;
  onDiscountChange: (discount: number) => void;
}) {
  const selected = quantity > 0;

  return (
    <div
      className={cn(
        "group rounded-lg border bg-white p-1.5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md sm:p-3",
        selected && "border-brand bg-brand-light/50 ring-1 ring-brand/20"
      )}
      dir="rtl"
    >
      <button
        type="button"
        onClick={() => onQuantityChange(quantity + 1)}
        className="flex min-h-[72px] w-full flex-col items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50/60 px-1.5 py-1.5 text-center transition group-hover:border-brand/40 group-hover:bg-white sm:min-h-[108px] sm:px-3 sm:py-3"
      >
        <Ticket className={cn("mb-1 h-4 w-4 sm:mb-2 sm:h-5 sm:w-5", selected ? "text-brand" : "text-gray-400")} />
        <h3 className="line-clamp-2 text-[10px] font-bold leading-4 text-gray-950 min-[420px]:text-[11px] sm:text-sm sm:leading-5">{product.name}</h3>
        <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">
          {formatCurrency(product.price)}{product.unit ? ` / ${product.unit}` : ""}
        </p>
        {product.category && (
          <Badge variant="outline" className="mt-1 hidden bg-white text-[10px] text-slate-600 sm:inline-flex sm:text-xs">
            {product.category}
          </Badge>
        )}
      </button>

      <div className="mt-1.5 flex items-center justify-between gap-1 sm:mt-3 sm:gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => onQuantityChange(Math.max(0, quantity - 1))} aria-label="تقليل الكمية">
          <Minus className="h-4 w-4" />
        </Button>
        <div className="min-w-10 rounded-md bg-white px-1.5 py-1 text-center sm:min-w-16 sm:px-3">
          <div className="text-lg font-bold text-gray-950 sm:text-2xl">{quantity}</div>
          {yesterdayQuantity ? <div className="text-[11px] text-gray-400">أمس: {yesterdayQuantity}</div> : null}
        </div>
        <Button className="bg-brand text-white hover:bg-brand-dark" size="icon-sm" onClick={() => onQuantityChange(quantity + 1)} aria-label="زيادة الكمية">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {selected && (
        <label className="mt-2 grid gap-1 text-xs sm:mt-3 sm:text-sm">
          <span className="text-gray-600">خصم %</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={discountPercent}
            onChange={(event) => onDiscountChange(Math.max(0, Math.min(100, Number(event.target.value || 0))))}
            className="h-8 text-center sm:h-9"
          />
        </label>
      )}
    </div>
  );
}
