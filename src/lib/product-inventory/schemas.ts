import { z } from "zod";
import { normalizeSerial } from "@/lib/product-inventory/normalization";

const uuid = z.string().uuid();
const money = z.coerce.number().positive().max(999_999_999_999);
const nonNegativeMoney = z.coerce.number().min(0).max(999_999_999_999);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const commissionType = z.enum(["none", "flat", "percentage"]);
const commissionBase = z.enum(["net_amount", "gross_amount"]);

function validateCommercialRule(
  value: {
    planned_sale_price: number;
    minimum_sale_price?: number;
    maximum_sale_price?: number;
    commission_type: "none" | "flat" | "percentage";
    commission_value: number;
  },
  context: z.RefinementCtx
) {
  const minimum = value.minimum_sale_price ?? value.planned_sale_price;
  const maximum = value.maximum_sale_price ?? value.planned_sale_price;
  if (minimum > value.planned_sale_price || value.planned_sale_price > maximum) {
    context.addIssue({ code: "custom", message: "سعر البيع يجب أن يقع بين الحد الأدنى والحد الأعلى." });
  }
  if (value.commission_type === "none" && value.commission_value !== 0) {
    context.addIssue({ code: "custom", message: "اختر نوع عمولة عند إدخال قيمة عمولة." });
  }
  if (value.commission_type === "percentage" && value.commission_value > 100) {
    context.addIssue({ code: "custom", message: "نسبة العمولة لا يمكن أن تتجاوز 100%." });
  }
}

export const receiptGroupSchema = z.object({
  product_id: z.string().optional().default("").transform((v) => (v && z.string().uuid().safeParse(v).success ? v : null)),
  product_name: z.string().trim().max(200).optional(),
  unit_cost: money,
  planned_sale_price: money,
  minimum_sale_price: money.optional(),
  maximum_sale_price: money.optional(),
  commission_type: commissionType.default("none"),
  commission_value: nonNegativeMoney.default(0),
  commission_base: commissionBase.default("net_amount"),
  currency,
  tax_included: z.boolean().default(true),
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  serial_numbers: z.array(z.string().trim().min(1).max(160)).min(1).max(1000),
}).superRefine((data, context) => {
  if (!data.product_id && !data.product_name) {
    context.addIssue({ code: "custom", message: "يجب اختيار منتج أو كتابة اسم المنتج.", path: ["product_id"] });
  }
  validateCommercialRule(data, context);
});

export const manualReceiptSchema = z
  .object({
    receipt_id: uuid,
    expected_version: z.coerce.number().int().min(0),
    supplier_company_id: uuid,
    warehouse_id: uuid,
    ownership_type: z.enum(["purchased", "consignment"]),
    receipt_date: z.iso.date(),
    delivery_note_no: z.string().trim().max(120).optional(),
    supplier_invoice_no: z.string().trim().max(120).optional(),
    invoice_received: z.boolean().default(false),
    currency,
    notes: z.string().trim().max(2000).optional(),
    groups: z.array(receiptGroupSchema).min(1).max(100),
    command_id: uuid,
  })
  .superRefine((value, context) => {
    const normalized = value.groups.flatMap((group) =>
      group.serial_numbers.map(normalizeSerial)
    );
    if (normalized.some((serial) => serial.length < 1 || serial.length > 160)) {
      context.addIssue({ code: "custom", path: ["groups"], message: "يوجد رقم تسلسلي غير صالح." });
    }
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: "custom", path: ["groups"], message: "الأرقام التسلسلية يجب أن تكون فريدة داخل الاستلام." });
    }
    if (normalized.length > 1000) {
      context.addIssue({ code: "custom", path: ["groups"], message: "الحد الأقصى هو 1000 وحدة في الاستلام." });
    }
  });

export const receiptTransitionSchema = z.object({
  expected_version: z.coerce.number().int().positive(),
  command_id: uuid,
  reason: z.string().trim().min(3).max(1000).optional(),
});

export const workbookImportRowSchema = z.object({
  row_number: z.coerce.number().int().min(2),
  raw_data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  supplier_code: z.string().max(160).default(""),
  receipt_reference: z.string().max(160).default(""),
  product_sku: z.string().max(160).default(""),
  product_name: z.string().max(300).default(""),
  model: z.string().max(160).default(""),
  product_id: z.string().uuid(),
  serial_number: z.string().trim().min(1).max(160),
  normalized_serial: z.string().max(160).default(""),
  barcode: z.string().max(160).default(""),
  unit_cost: money,
  planned_sale_price: money,
  minimum_sale_price: money.optional(),
  maximum_sale_price: money.optional(),
  commission_type: commissionType.default("none"),
  commission_value: nonNegativeMoney.default(0),
  commission_base: commissionBase.default("net_amount"),
  currency,
  tax_code: z.string().max(80).default(""),
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  notes: z.string().max(1000).default(""),
  status: z.enum(["valid", "warning"]),
  confidence: z.coerce.number().min(0).max(1).default(1),
  validation_errors: z.array(z.string()).max(20).default([]),
  validation_warnings: z.array(z.string()).max(20).default([]),
}).superRefine(validateCommercialRule);

export const workbookCommitSchema = z.object({
  source_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive(),
  command_id: z.string().uuid(),
  rows: z.array(workbookImportRowSchema).min(1).max(10000),
});

export const photoCandidateCommitSchema = z.object({
  source_id: z.string().uuid(),
  candidate_index: z.coerce.number().int().positive().max(200),
  raw_product_name: z.string().max(300).default(""),
  raw_sku: z.string().max(160).default(""),
  raw_model: z.string().max(160).default(""),
  raw_serial: z.string().max(160).default(""),
  raw_barcode: z.string().max(160).default(""),
  product_id: z.string().uuid(),
  serial_number: z.string().trim().min(1).max(160),
  normalized_serial: z.string().max(160).default(""),
  unit_cost: money,
  planned_sale_price: money,
  minimum_sale_price: money.optional(),
  maximum_sale_price: money.optional(),
  commission_type: commissionType.default("none"),
  commission_value: nonNegativeMoney.default(0),
  commission_base: commissionBase.default("net_amount"),
  currency,
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  status: z.enum(["valid", "warning"]),
  confidence: z.coerce.number().min(0).max(1),
  match_method: z.enum(["sku", "barcode", "name", "alias", "fuzzy", "none"]),
  validation_errors: z.array(z.string().max(500)).max(20).default([]),
  validation_warnings: z.array(z.string().max(500)).max(20).default([]),
  save_as_alias: z.boolean().default(false),
}).superRefine(validateCommercialRule);

export const photoCommitSchema = z.object({
  expected_version: z.coerce.number().int().positive(),
  command_id: z.string().uuid(),
  warnings_accepted: z.boolean().default(false),
  candidates: z.array(photoCandidateCommitSchema).min(1).max(200),
});

export const productCommercialTermSchema = z.object({
  receipt_line_id: uuid,
  sale_price: money,
  minimum_sale_price: money,
  maximum_sale_price: money,
  currency,
  commission_type: commissionType,
  commission_value: nonNegativeMoney,
  commission_base: commissionBase,
  source: z.enum(["catalog_default", "workbook_proposal", "photo_proposal", "finance"]).default("finance"),
  reason: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => validateCommercialRule({
  planned_sale_price: value.sale_price,
  minimum_sale_price: value.minimum_sale_price,
  maximum_sale_price: value.maximum_sale_price,
  commission_type: value.commission_type,
  commission_value: value.commission_value,
}, context));

export const productCommercialTermsCommandSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
  terms: z.array(productCommercialTermSchema).min(1).max(100),
});

export const productHandoverSchema = z.object({
  handover_id: uuid,
  command_id: uuid,
  warehouse_id: uuid,
  agent_id: uuid,
  require_acknowledgment: z.boolean().optional(),
  notes: z.string().trim().max(1000).default(""),
  units: z.array(z.object({
    unit_id: uuid,
    minimum_sale_price: money.optional(),
    maximum_sale_price: money.optional(),
  })).min(1).max(200),
}).superRefine((value, context) => {
  if (new Set(value.units.map((unit) => unit.unit_id)).size !== value.units.length) {
    context.addIssue({ code: "custom", path: ["units"], message: "اختر كل وحدة مرة واحدة فقط." });
  }
  value.units.forEach((unit, index) => {
    if (
      unit.minimum_sale_price !== undefined
      && unit.maximum_sale_price !== undefined
      && unit.minimum_sale_price > unit.maximum_sale_price
    ) {
      context.addIssue({
        code: "custom",
        path: ["units", index],
        message: "الحد الأدنى لسعر البيع يجب ألا يتجاوز الحد الأعلى.",
      });
    }
  });
});

export const productInventoryOperationalAssignmentSchema = z.object({
  assignment_id: uuid.optional(),
  expected_version: z.coerce.number().int().positive().optional(),
  employee_id: uuid,
  project_id: uuid,
  location_id: z.union([uuid, z.literal("")]).optional().transform((value) => value || undefined),
  city: z.string().trim().min(1).max(160),
  position_code: z.enum(["OGPM", "OGSV1"]),
  responsibility: z.enum(["project_manager", "supervisor"]),
  can_receive_custody: z.boolean().default(true),
  can_sell: z.boolean().default(false),
  can_request_return: z.boolean().default(true),
  can_approve_return: z.boolean().default(false),
  status: z.enum(["active", "inactive"]).default("active"),
  effective_from: z.iso.date(),
  effective_to: z.union([z.iso.date(), z.literal("")]).optional().transform((value) => value || undefined),
}).superRefine((value, context) => {
  if ((value.position_code === "OGPM") !== (value.responsibility === "project_manager")) {
    context.addIssue({ code: "custom", path: ["responsibility"], message: "OGPM لمدير المشروع وOGSV1 للمشرف." });
  }
  if (value.assignment_id && !value.expected_version) {
    context.addIssue({ code: "custom", path: ["expected_version"], message: "إصدار التكليف مطلوب عند التعديل." });
  }
  if (value.effective_to && value.effective_to < value.effective_from) {
    context.addIssue({ code: "custom", path: ["effective_to"], message: "تاريخ النهاية يسبق تاريخ البداية." });
  }
});

export const productEmployeeHandoverSchema = z.object({
  handover_id: uuid,
  command_id: uuid,
  warehouse_id: uuid,
  assignment_id: uuid,
  require_acknowledgment: z.boolean().default(true),
  notes: z.string().trim().max(2000).default(""),
  unit_ids: z.array(uuid).min(1).max(200),
}).superRefine((value, context) => {
  if (new Set(value.unit_ids).size !== value.unit_ids.length) {
    context.addIssue({ code: "custom", path: ["unit_ids"], message: "لا يمكن تكرار نفس السيريال في التسليم." });
  }
});

export const productEmployeeHandoverAcceptSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
  signature_data: z.string().startsWith("data:image/").max(1_500_000),
  acceptance_note: z.string().trim().max(1000).default(""),
});

export const productHandoverAcceptSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
  signature_data: z.string().min(1, "يجب التوقيع قبل تأكيد الاستلام."),
});

export const productAgentReturnSchema = z.object({
  return_id: uuid,
  command_id: uuid,
  warehouse_id: uuid,
  unit_ids: z.array(uuid).min(1).max(200),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((value, context) => {
  if (new Set(value.unit_ids).size !== value.unit_ids.length) {
    context.addIssue({ code: "custom", path: ["unit_ids"], message: "اختر كل وحدة مرة واحدة فقط." });
  }
});

export const productPriceOverrideRequestSchema = z.object({
  request_id: uuid,
  command_id: uuid,
  unit_id: uuid,
  requested_price: money,
  reason: z.string().trim().min(5).max(1000),
});

export const productPriceOverrideReviewSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
  review_note: z.string().trim().max(1000).default(""),
});

export const agentProductSaleSchema = z.object({
  sale_id: uuid,
  command_id: uuid,
  unit_id: uuid,
  actual_sale_price: money,
  sale_date: z.iso.date(),
  payment_method: z.enum(["cash", "bank_transfer", "card", "electronic", "agent_credit"]),
  customer_name: z.string().trim().max(160).default(""),
  customer_phone: z.string().trim().max(40).default(""),
  customer_reference: z.string().trim().max(160).default(""),
  price_override_request_id: uuid.optional(),
});

export const agentProductSaleVoidSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
  return_disposition: z.enum(["sellable", "damaged"]).default("sellable"),
});

export const agentProductCollectionSchema = z.object({
  collection_id: uuid,
  command_id: uuid,
  agent_id: uuid,
  amount: money,
  payment_method: z.enum(["cash", "bank_transfer", "card", "electronic"]),
  reference: z.string().trim().max(160).default(""),
  collection_date: z.iso.date(),
  notes: z.string().trim().max(1000).default(""),
});

export const productInventoryLossSchema = z.object({
  loss_id: uuid,
  command_id: uuid,
  unit_id: uuid,
  loss_type: z.enum(["damage", "loss"]),
  reason: z.string().trim().min(5).max(1000),
});
