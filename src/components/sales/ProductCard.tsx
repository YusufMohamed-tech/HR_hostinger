"use client";

import React from "react";
import { Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SalesProduct } from "@/lib/services/sales";
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
        "flex min-h-[190px] flex-col justify-between rounded-lg border bg-white p-4 shadow-sm transition",
        selected ? "border-brand bg-brand-light/40 ring-1 ring-brand/20" : "border-gray-100 hover:border-brand/30"
      )}
      dir="rtl"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-950">{product.name}</h3>
            <p className="mt-1 text-sm text-gray-500">
              {Number(product.price || 0).toLocaleString("ar-EG")} جنيه{product.unit ? ` / ${product.unit}` : ""}
            </p>
          </div>
          {product.category && (
            <Badge variant="outline" className="bg-white text-slate-600">
              {product.category}
            </Badge>
          )}
        </div>
        {product.description && <p className="line-clamp-2 text-xs text-gray-500">{product.description}</p>}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="icon-sm" onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>
            <Minus className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-950">{quantity}</div>
            {yesterdayQuantity ? <div className="text-xs text-gray-400">أمس: {yesterdayQuantity}</div> : null}
          </div>
          <Button className="bg-brand text-white hover:bg-brand-dark" size="icon-sm" onClick={() => onQuantityChange(quantity + 1)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {selected && (
          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">خصم %</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(event) => onDiscountChange(Math.max(0, Math.min(100, Number(event.target.value || 0))))}
              className="text-center"
            />
          </label>
        )}
      </div>
    </div>
  );
}
