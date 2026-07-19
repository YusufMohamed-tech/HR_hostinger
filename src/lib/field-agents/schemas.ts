import { z } from "zod";

export const createAgentSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  command_id: z.string().uuid().optional(),
  full_name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(40),
  national_id: z.string().trim().min(5).max(40),
  region: z.string().trim().max(120).optional(),
  commission_rate: z.coerce.number().min(0).max(100),
  sim_price: z.coerce.number().min(0),
  max_sim_capacity: z.coerce.number().int().min(0).optional(),
});

export const updateAgentSchema = z.object({
  full_name: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().min(8).max(40).optional(),
  national_id: z.string().trim().min(5).max(40).optional(),
  region: z.string().trim().max(120).nullable().optional(),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  sim_price: z.coerce.number().min(0).optional(),
  max_sim_capacity: z.coerce.number().int().min(0).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const importSimsSchema = z.object({
  command_id: z.string().uuid().optional(),
  sims: z
    .array(
      z.object({
        iccid: z.string().trim().min(18).max(22),
        provider: z.string().trim().min(1).max(40).default("virgin"),
        sim_type: z.string().trim().min(1).max(40).default("prepaid"),
        price: z.coerce.number().min(0),
      })
    )
    .min(1),
});

export const assignSimsSchema = z.object({
  command_id: z.string().uuid().optional(),
  agent_id: z.string().uuid(),
  sim_ids: z.array(z.string().uuid()).min(1),
  notes: z.string().trim().max(500).optional(),
});

export const assignSimsByQuantitySchema = z.object({
  command_id: z.string().uuid().optional(),
  agent_id: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  provider: z.string().trim().max(40).default("virgin"),
  sim_type: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const recordSaleSchema = z.object({
  sim_unit_id: z.string().uuid(),
  package_id: z.string().uuid(),
  customer_name: z.string().trim().max(160).optional(),
  command_id: z.string().uuid().optional(),
});

export const returnSimSchema = z.object({
  sim_unit_id: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  command_id: z.string().uuid().optional(),
});

export const voidSimSaleSchema = z.object({
  sale_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
  command_id: z.string().uuid().optional(),
});

export const collectCashSchema = z.object({
  collection_id: z.string().uuid().optional(),
  command_id: z.string().uuid().optional(),
  agent_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_method: z.enum(["cash", "bank_transfer"]).default("cash"),
  collection_date: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
});

export const simRequestSchema = z.object({
  quantity: z.coerce.number().int().positive(),
  sim_type: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const reviewRequestSchema = z.object({
  status: z.enum(["approved", "rejected", "delivered"]),
  review_note: z.string().trim().max(500).optional(),
});

export const simBoxImportSchema = z.object({
  command_id: z.string().uuid().optional(),
  provider: z.string().trim().min(1).max(80),
  order_number: z.string().trim().max(120).optional(),
  batch_number: z.string().trim().max(120).optional(),
  barcode_text: z.string().trim().max(240).optional(),
  first_kitcode: z.string().trim().min(1).max(80),
  last_kitcode: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().int().positive(),
  dealer_box_number: z.coerce.number().int().positive().nullable().optional(),
  dealer_box_total: z.coerce.number().int().positive().nullable().optional(),
  step: z.coerce.number().int().min(0).optional(),
  image_path: z.string().trim().max(1000).optional(),
  extracted_json: z.record(z.string(), z.unknown()).optional(),
  assigned_agent_id: z.string().uuid().nullable().optional(),
  import_duplicate_strategy: z.enum(["skip", "fail"]).default("fail"),
});
