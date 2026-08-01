import { z } from "zod";

const uuid = z.string().uuid("المعرف غير صالح.");

export const issueProductTraderHandoverSchema = z.object({
  handover_id: uuid,
  command_id: uuid,
  source_agent_id: uuid.optional(),
  merchant_id: uuid,
  unit_ids: z.array(uuid).min(1, "اختر منتجاً واحداً على الأقل.").max(100),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (new Set(value.unit_ids).size !== value.unit_ids.length) {
    context.addIssue({ code: "custom", path: ["unit_ids"], message: "لا يمكن تكرار نفس الجهاز." });
  }
});

export const respondProductTraderHandoverSchema = z.object({
  command_id: uuid,
  expected_version: z.number().int().positive(),
  accepted_unit_ids: z.array(uuid).max(100),
  rejected_units: z.array(z.object({
    unit_id: uuid,
    reason: z.enum(["missing", "damaged"]),
  })).max(100),
  rejection_reason: z.string().trim().max(1000).optional(),
  signature_data: z.string().max(1_000_000).optional(),
});

export const rejectProductTraderHandoverSchema = z.object({
  command_id: uuid,
  expected_version: z.number().int().positive(),
  rejection_reason: z.string().trim().min(3).max(1000),
});

export const cancelProductTraderHandoverSchema = z.object({
  command_id: uuid,
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});
