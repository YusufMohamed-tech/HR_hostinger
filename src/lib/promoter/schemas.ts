import { z } from "zod";

const optionalText = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text || null;
}, z.string().nullable());

const optionalUuid = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text || null;
}, z.string().uuid().nullable());

const optionalNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}, z.number().nullable());

const booleanValue = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

export const promoterReferenceSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["mobile_operator", "internet_provider", "city"]),
  code: z.string().trim().min(1).max(80),
  label_ar: z.string().trim().min(1).max(160),
  label_en: optionalText.optional(),
  is_active: booleanValue.default(true),
  sort_order: z.coerce.number().int().default(0),
});

export const promoterEligibilitySchema = z.object({
  offer_target: z.enum(["mobile", "home_internet", "bundle", "addon"]).optional(),
  target_operators: z.array(z.string().trim().min(1)).nullable().optional(),
  min_monthly_spend: optionalNumber.optional(),
  max_monthly_spend: optionalNumber.optional(),
  min_sims: optionalNumber.optional(),
  requires_home_internet: z.boolean().nullable().optional(),
  cities: z.array(z.string().trim().min(1)).nullable().optional(),
});

export const telecomOfferSchema = z.object({
  company_id: optionalUuid.optional(),
  product_id: optionalUuid.optional(),
  name_ar: z.string().trim().min(2).max(180),
  name_en: optionalText.optional(),
  offer_target: z.enum(["mobile", "home_internet", "bundle", "addon"]),
  monthly_price: z.coerce.number().min(0),
  contract_months: optionalNumber.optional(),
  data_gb: optionalNumber.optional(),
  minutes: optionalNumber.optional(),
  sim_count: optionalNumber.optional(),
  benefits_ar: z.array(z.string().trim().min(1)).default([]),
  benefits_en: z.array(z.string().trim().min(1)).default([]),
  eligibility: promoterEligibilitySchema.default({}),
  priority: z.coerce.number().int().default(0),
  is_active: booleanValue.default(true),
});

export const promoterCampaignSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: optionalUuid.optional(),
  name: z.string().trim().min(2).max(180),
  code: optionalText.optional(),
  start_date: optionalText.optional(),
  end_date: optionalText.optional(),
  target_leads: optionalNumber.optional(),
  is_active: booleanValue.default(true),
});

export const promoterSettingsSchema = z.object({
  company_id: optionalUuid.optional(),
  weights: z.object({
    savings: z.coerce.number().min(0).max(1).default(0.6),
    data: z.coerce.number().min(0).max(1).default(0.2),
    bundle: z.coerce.number().min(0).max(1).default(0.1),
    priority: z.coerce.number().min(0).max(1).default(0.1),
  }).default({ savings: 0.6, data: 0.2, bundle: 0.1, priority: 0.1 }),
  consent_version: z.string().trim().min(1).max(40).default("v1"),
  consent_text_ar: optionalText.optional(),
  consent_text_en: optionalText.optional(),
});

export const promoterLeadCaptureSchema = z.object({
  company_id: optionalUuid.optional(),
  campaign_id: optionalUuid.optional(),
  location_id: optionalUuid.optional(),
  full_name: z.string().trim().min(2).max(180),
  mobile: z.string().trim().min(7).max(30),
  email: optionalText.optional(),
  city: optionalText.optional(),
  current_operator: optionalText.optional(),
  sim_count: optionalNumber.optional(),
  monthly_mobile_spend: optionalNumber.optional(),
  home_internet_provider: optionalText.optional(),
  monthly_home_spend: optionalNumber.optional(),
  pushed_offer_id: optionalUuid.optional(),
  assigned_agent_id: optionalUuid.optional(),
  consent_given: z.literal(true),
  marketing_consent: booleanValue.default(false),
  consent_version: optionalText.optional(),
  language: z.enum(["ar", "en"]).default("ar"),
});

export const promoterLeadPatchSchema = z.object({
  status: z.enum(["captured", "recommended", "sent_to_agent", "converted", "not_interested", "invalid"]).optional(),
  assigned_agent_id: optionalUuid.optional(),
  conversion_sale_log_id: optionalUuid.optional(),
  pushed_offer_id: optionalUuid.optional(),
  agent_reviewed_at: optionalText.optional(),
});
