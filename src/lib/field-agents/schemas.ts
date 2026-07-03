import { z } from "zod";

export const createAgentSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(40),
  national_id: z.string().trim().min(5).max(40),
  region: z.string().trim().max(120).optional(),
  commission_rate: z.coerce.number().min(0).max(100),
  max_sim_capacity: z.coerce.number().int().min(0).optional(),
});

export const updateAgentSchema = z.object({
  full_name: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().min(8).max(40).optional(),
  national_id: z.string().trim().min(5).max(40).optional(),
  region: z.string().trim().max(120).nullable().optional(),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  max_sim_capacity: z.coerce.number().int().min(0).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const importSimsSchema = z.object({
  sims: z
    .array(
      z.object({
        iccid: z.string().trim().min(18).max(22),
        sim_type: z.string().trim().min(1).max(40).default("prepaid"),
        price: z.coerce.number().min(0),
      })
    )
    .min(1),
});

export const assignSimsSchema = z.object({
  agent_id: z.string().uuid(),
  sim_ids: z.array(z.string().uuid()).min(1),
  notes: z.string().trim().max(500).optional(),
});

export const recordSaleSchema = z.object({
  sim_unit_id: z.string().uuid(),
  sold_price: z.coerce.number().min(0),
  customer_name: z.string().trim().max(160).optional(),
});

export const returnSimSchema = z.object({
  sim_unit_id: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

export const collectCashSchema = z.object({
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
