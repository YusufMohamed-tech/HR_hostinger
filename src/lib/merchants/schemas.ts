import { z } from "zod";

export const createMerchantSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  business_name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(160).optional(),
  sim_price: z.coerce.number().min(0),
  commission_rate: z.coerce.number().min(0).max(100),
});

export const updateMerchantSchema = z.object({
  business_name: z.string().trim().min(2).max(160).optional(),
  owner_name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  sim_price: z.coerce.number().min(0).optional(),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const assignSimsToMerchantSchema = z.object({
  merchant_id: z.string().uuid(),
  sim_ids: z.array(z.string().uuid()).min(1),
  notes: z.string().trim().max(500).optional(),
});

export const merchantRecordSaleSchema = z.object({
  sim_unit_id: z.string().uuid(),
  sold_price: z.coerce.number().min(0),
  customer_name: z.string().trim().max(160).optional(),
});

export const merchantReturnSimSchema = z.object({
  sim_unit_id: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

export const collectMerchantCashSchema = z.object({
  merchant_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_method: z.enum(["cash", "bank_transfer"]).default("cash"),
  collection_date: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
});

export const merchantSimRequestSchema = z.object({
  quantity: z.coerce.number().int().positive(),
  sim_type: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const reviewMerchantRequestSchema = z.object({
  status: z.enum(["approved", "rejected", "delivered"]),
  review_note: z.string().trim().max(500).optional(),
});
