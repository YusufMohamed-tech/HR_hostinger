import { z } from "zod";

const optionalText = (maximum: number) => z.union([
  z.string().trim().max(maximum),
  z.null(),
]).optional();

const nullableUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();

export const productCatalogProductSchema = z.object({
  company_id: z.string().uuid("اختر المورد."),
  name: z.string().trim().min(2, "اسم المنتج مطلوب.").max(200),
  description: optionalText(2_000),
  unit: z.string().trim().min(1).max(80).default("جهاز"),
  category: optionalText(120),
  sku: optionalText(160),
  barcode: optionalText(160),
  model: optionalText(160),
  price: z.coerce.number().min(0, "سعر البيع لا يمكن أن يكون أقل من صفر."),
  default_cost: z.coerce.number().min(0, "التكلفة لا يمكن أن تكون أقل من صفر."),
  commission_type: z.enum(["none", "flat", "percentage"]).default("none"),
  commission_value: z.coerce.number().min(0).default(0),
  revenue_account_id: nullableUuid,
  is_active: z.boolean().default(true),
}).superRefine((value, context) => {
  if (!value.sku?.trim() && !value.barcode?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["sku"],
      message: "أدخل SKU أو الباركود على الأقل.",
    });
  }
  if (value.is_active && value.price <= 0) {
    context.addIssue({
      code: "custom",
      path: ["price"],
      message: "سعر البيع للمنتج النشط يجب أن يكون أكبر من صفر.",
    });
  }
  if (value.commission_type === "none" && value.commission_value !== 0) {
    context.addIssue({
      code: "custom",
      path: ["commission_value"],
      message: "قيمة العمولة يجب أن تكون صفرًا عند اختيار بدون عمولة.",
    });
  }
  if (value.commission_type === "percentage" && value.commission_value > 100) {
    context.addIssue({
      code: "custom",
      path: ["commission_value"],
      message: "نسبة العمولة لا يمكن أن تتجاوز 100٪.",
    });
  }
});

export const productCatalogCreateSchema = productCatalogProductSchema.and(z.object({
  command_id: z.string().uuid(),
}));

export const productCatalogUpdateSchema = productCatalogProductSchema.and(z.object({
  command_id: z.string().uuid(),
  expected_version: z.coerce.number().int().min(1),
}));

export const productCatalogStatusSchema = z.object({
  command_id: z.string().uuid(),
  expected_version: z.coerce.number().int().min(1),
  is_active: z.boolean(),
});

export type ProductCatalogProductInput = z.infer<typeof productCatalogProductSchema>;
