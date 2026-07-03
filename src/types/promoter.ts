export type PromoterReferenceKind = "mobile_operator" | "internet_provider" | "city";
export type TelecomOfferTarget = "mobile" | "home_internet" | "bundle" | "addon";
export type PromoterRecommendationSource = "auto" | "manual";
export type PromoterLeadStatus =
  | "captured"
  | "recommended"
  | "sent_to_agent"
  | "converted"
  | "not_interested"
  | "invalid";

export type PromoterWeights = {
  savings: number;
  data: number;
  bundle: number;
  priority: number;
};

export type PromoterEligibility = {
  offer_target?: TelecomOfferTarget;
  target_operators?: string[] | null;
  min_monthly_spend?: number | null;
  max_monthly_spend?: number | null;
  min_sims?: number | null;
  requires_home_internet?: boolean | null;
  cities?: string[] | null;
};

export type PromoterReferenceValue = {
  id: string;
  organization_id: string;
  kind: PromoterReferenceKind;
  code: string;
  label_ar: string;
  label_en: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type TelecomOffer = {
  id: string;
  organization_id: string;
  company_id: string | null;
  product_id: string | null;
  name_ar: string;
  name_en: string | null;
  offer_target: TelecomOfferTarget;
  monthly_price: number;
  contract_months: number | null;
  data_gb: number | null;
  minutes: number | null;
  sim_count: number | null;
  benefits_ar: string[];
  benefits_en: string[];
  eligibility: PromoterEligibility;
  priority: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoterCampaign = {
  id: string;
  organization_id: string;
  company_id: string | null;
  name: string;
  code: string | null;
  start_date: string | null;
  end_date: string | null;
  target_leads: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PromoterSurveyInput = {
  current_operator?: string | null;
  sim_count?: number | null;
  monthly_mobile_spend?: number | null;
  home_internet_provider?: string | null;
  monthly_home_spend?: number | null;
  city?: string | null;
};

export type PromoterRecommendationCandidate = {
  offer_id: string;
  score: number;
  eligible: boolean;
  estimated_savings: number;
  reasons: string[];
};

export type PromoterRecommendationSnapshot = {
  best?: PromoterRecommendationCandidate | null;
  alternatives?: PromoterRecommendationCandidate[];
  all?: PromoterRecommendationCandidate[];
};

export type PromoterLead = PromoterSurveyInput & {
  id: string;
  organization_id: string;
  company_id: string | null;
  campaign_id: string | null;
  promoter_id: string;
  location_id: string | null;
  full_name: string;
  mobile: string;
  email: string | null;
  recommended_offer_id: string | null;
  pushed_offer_id: string | null;
  estimated_savings: number | null;
  recommendation_source: PromoterRecommendationSource;
  recommendation_snapshot: PromoterRecommendationSnapshot;
  status: PromoterLeadStatus;
  assigned_agent_id: string | null;
  agent_reviewed_at: string | null;
  conversion_sale_log_id: string | null;
  consent_given: boolean;
  marketing_consent: boolean;
  consent_version: string | null;
  consent_at: string | null;
  language: string;
  created_at: string;
  updated_at: string;
};

export type PromoterLeadEvent = {
  id: string;
  organization_id: string;
  lead_id: string;
  event_type: string;
  actor_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type PromoterSettings = {
  id: string;
  organization_id: string;
  company_id: string | null;
  weights: PromoterWeights;
  consent_version: string;
  consent_text_ar: string | null;
  consent_text_en: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoterDashboardData = {
  leads: number;
  sentToAgent: number;
  converted: number;
  conversionRate: number;
  estimatedSavings: number;
  byStatus: Array<{ label: string; count: number }>;
  byCity: Array<{ label: string; count: number }>;
  byOperator: Array<{ label: string; count: number }>;
  byOffer: Array<{ label: string; count: number }>;
  byPromoter: Array<{ label: string; count: number }>;
};
