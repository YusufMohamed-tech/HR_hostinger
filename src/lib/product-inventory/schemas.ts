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
