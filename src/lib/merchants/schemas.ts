import { z } from "zod";

export const createMerchantSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  business_name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(160).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  sim_price: z.coerce.number().min(0),
  commission_rate: z.coerce.number().min(0).max(100),
});

export const updateMerchantSchema = z.object({
  business_name: z.string().trim().min(2).max(160).optional(),
  owner_name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  place_photo_url: z.string().trim().max(1000).nullable().optional(),
  sim_price: z.coerce.number().min(0).optional(),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const assignSimsToMerchantSchema = z.object({
  merchant_id: z.string().uuid(),
  sim_ids: z.array(z.string().uuid()).min(1),
  notes: z.string().trim().max(500).optional(),
});

export const assignSimsToMerchantByQuantitySchema = z.object({
  merchant_id: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  sim_type: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(40).default("virgin"),
  notes: z.string().trim().max(500).optional(),
});

export const merchantRecordSaleSchema = z.object({
  sim_unit_id: z.string().uuid(),
  package_id: z.string().uuid(),
  customer_name: z.string().trim().min(2).max(160),
  customer_national_id: z.string().trim().min(5).max(40),
  customer_absher_mobile: z.string().trim().min(5).max(40),
  customer_birth_date_hijri: z.string().trim().min(1).max(40),
  customer_id_expiry_hijri: z.string().trim().min(1).max(40),
  customer_email: z.string().trim().email().max(160),
  customer_nationality: z.string().trim().min(2).max(80),
  package_reference: z.string().trim().min(1).max(80),
  device_serial: z.string().trim().min(3).max(80),
  city_district: z.string().trim().min(2).max(160),
  marketer_name: z.string().trim().max(160).optional(),
  national_address: z.string().trim().min(2).max(160),
  supervisor_name: z.string().trim().min(2).max(160),
});

export const merchantReturnSimSchema = z.object({
  sim_unit_id: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

export const collectMerchantCashSchema = z.object({
  merchant_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_method: z.enum(["cash", "bank_transfer", "visa", "electronic"]).default("cash"),
  collection_date: z.string().trim().min(1).optional(),
  payment_proof_url: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const confirmMerchantPaymentSchema = z.object({
  status: z.enum(["confirmed", "rejected"]),
  rejection_reason: z.string().trim().max(500).optional(),
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

export const simPackageSchema = z.object({
  provider: z.string().trim().max(40).default("virgin"),
  package_name: z.string().trim().min(2).max(160),
  internet_allowance: z.string().trim().max(80).nullable().optional(),
  minutes_allowance: z.string().trim().max(80).nullable().optional(),
  validity: z.string().trim().max(80).nullable().optional(),
  base_price: z.coerce.number().min(0),
  sale_price: z.coerce.number().min(0),
  tax_included: z.coerce.boolean().default(true),
  agent_commission_type: z.enum(["percentage", "flat"]).default("percentage"),
  agent_commission_value: z.coerce.number().min(0),
  merchant_commission_type: z.enum(["percentage", "flat"]).default("percentage"),
  merchant_commission_value: z.coerce.number().min(0),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const updateSimPackageSchema = simPackageSchema.partial();
