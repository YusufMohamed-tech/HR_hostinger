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
        "group rounded-lg border bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md",
        selected && "border-brand bg-brand-light/50 ring-1 ring-brand/20"
      )}
      dir="rtl"
    >
      <button
        type="button"
        onClick={() => onQuantityChange(quantity + 1)}
        className="flex min-h-[118px] w-full flex-col items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center transition group-hover:border-brand/40 group-hover:bg-white"
      >
        <Ticket className={cn("mb-2 h-6 w-6", selected ? "text-brand" : "text-gray-400")} />
        <h3 className="line-clamp-2 text-sm font-bold text-gray-950">{product.name}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {formatCurrency(product.price)}{product.unit ? ` / ${product.unit}` : ""}
        </p>
        {product.category && (
          <Badge variant="outline" className="mt-2 bg-white text-xs text-slate-600">
            {product.category}
          </Badge>
        )}
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => onQuantityChange(Math.max(0, quantity - 1))} aria-label="تقليل الكمية">
          <Minus className="h-4 w-4" />
        </Button>
        <div className="min-w-16 rounded-md bg-white px-3 py-1 text-center">
          <div className="text-2xl font-bold text-gray-950">{quantity}</div>
          {yesterdayQuantity ? <div className="text-[11px] text-gray-400">أمس: {yesterdayQuantity}</div> : null}
        </div>
        <Button className="bg-brand text-white hover:bg-brand-dark" size="icon-sm" onClick={() => onQuantityChange(quantity + 1)} aria-label="زيادة الكمية">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {selected && (
        <label className="mt-3 grid gap-1 text-sm">
          <span className="text-gray-600">خصم %</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={discountPercent}
            onChange={(event) => onDiscountChange(Math.max(0, Math.min(100, Number(event.target.value || 0))))}
            className="h-9 text-center"
          />
        </label>
      )}
    </div>
  );
}
