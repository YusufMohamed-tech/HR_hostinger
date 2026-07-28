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
