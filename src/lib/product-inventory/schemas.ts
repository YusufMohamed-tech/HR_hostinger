import { z } from "zod";
import { normalizeSerial } from "@/lib/product-inventory/normalization";

const uuid = z.string().uuid();
const money = z.coerce.number().positive().max(999_999_999_999);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

export const receiptGroupSchema = z.object({
  product_id: uuid,
  unit_cost: money,
  planned_sale_price: money,
  currency,
  tax_included: z.boolean().default(true),
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  serial_numbers: z.array(z.string().trim().min(1).max(160)).min(1).max(1000),
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
  currency,
  tax_code: z.string().max(80).default(""),
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  notes: z.string().max(1000).default(""),
  status: z.enum(["valid", "warning"]),
  confidence: z.coerce.number().min(0).max(1).default(1),
  validation_errors: z.array(z.string()).max(20).default([]),
  validation_warnings: z.array(z.string()).max(20).default([]),
});

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
  currency,
  condition: z.enum(["new", "open_box", "refurbished"]).default("new"),
  status: z.enum(["valid", "warning"]),
  confidence: z.coerce.number().min(0).max(1),
  match_method: z.enum(["sku", "barcode", "name", "alias", "fuzzy", "none"]),
  validation_errors: z.array(z.string().max(500)).max(20).default([]),
  validation_warnings: z.array(z.string().max(500)).max(20).default([]),
  save_as_alias: z.boolean().default(false),
});

export const photoCommitSchema = z.object({
  expected_version: z.coerce.number().int().positive(),
  command_id: z.string().uuid(),
  warnings_accepted: z.boolean().default(false),
  candidates: z.array(photoCandidateCommitSchema).min(1).max(200),
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

export const productHandoverAcceptSchema = z.object({
  command_id: uuid,
  expected_version: z.coerce.number().int().positive(),
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
