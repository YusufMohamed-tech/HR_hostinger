import type { PromoterEligibility, PromoterSurveyInput, PromoterWeights, TelecomOffer } from "@/types/promoter";

export type ScoredOffer = {
  offer: TelecomOffer;
  eligible: boolean;
  estimatedSavings: number;
  score: number;
  reasons: string[];
};

const defaultWeights: PromoterWeights = {
  savings: 0.6,
  data: 0.2,
  bundle: 0.1,
  priority: 0.1,
};

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textValue(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => textValue(item)).filter(Boolean) : [];
}

function comparableSpend(survey: PromoterSurveyInput, eligibility: PromoterEligibility, offer: TelecomOffer) {
  const target = eligibility.offer_target || offer.offer_target;
  const mobile = numberValue(survey.monthly_mobile_spend);
  const home = numberValue(survey.monthly_home_spend);
  if (target === "home_internet") return home;
  if (target === "bundle") return mobile + home;
  return mobile;
}

function dataScore(offer: TelecomOffer) {
  const dataGb = numberValue(offer.data_gb);
  if (dataGb <= 0) return 0;
  return Math.min(dataGb / 200, 1);
}

function bundleFit(survey: PromoterSurveyInput, offer: TelecomOffer, eligibility: PromoterEligibility) {
  const target = eligibility.offer_target || offer.offer_target;
  if (target !== "bundle") return 0;
  return survey.home_internet_provider || numberValue(survey.monthly_home_spend) > 0 ? 1 : 0.4;
}

function eligibilityReasons(survey: PromoterSurveyInput, offer: TelecomOffer) {
  const eligibility = (offer.eligibility || {}) as PromoterEligibility;
  const reasons: string[] = [];
  const operator = textValue(survey.current_operator);
  const provider = textValue(survey.home_internet_provider);
  const city = textValue(survey.city);
  const targetOperators = arrayValue(eligibility.target_operators);
  const cities = arrayValue(eligibility.cities);
  const spend = comparableSpend(survey, eligibility, offer);
  const minSpend = numberValue(eligibility.min_monthly_spend, Number.NaN);
  const maxSpend = numberValue(eligibility.max_monthly_spend, Number.NaN);
  const minSims = numberValue(eligibility.min_sims, Number.NaN);
  const simCount = numberValue(survey.sim_count);

  if (targetOperators.length && (!operator || !targetOperators.includes(operator))) {
    reasons.push("Current operator is outside this offer target.");
  }
  if (cities.length && (!city || !cities.includes(city))) {
    reasons.push("City is outside this offer coverage.");
  }
  if (Number.isFinite(minSpend) && spend < minSpend) {
    reasons.push("Spend is below the offer minimum.");
  }
  if (Number.isFinite(maxSpend) && spend > maxSpend) {
    reasons.push("Spend is above the offer maximum.");
  }
  if (Number.isFinite(minSims) && simCount < minSims) {
    reasons.push("SIM count is below the offer minimum.");
  }
  if (eligibility.requires_home_internet && !provider && numberValue(survey.monthly_home_spend) <= 0) {
    reasons.push("Home internet is required for this bundle.");
  }

  return reasons;
}

export function scoreOffer(survey: PromoterSurveyInput, offer: TelecomOffer, weights: Partial<PromoterWeights> = {}): ScoredOffer {
  const mergedWeights = { ...defaultWeights, ...weights };
  const eligibility = (offer.eligibility || {}) as PromoterEligibility;
  const reasons = eligibilityReasons(survey, offer);
  const eligible = reasons.length === 0;
  const spend = comparableSpend(survey, eligibility, offer);
  const estimatedSavings = Math.max(0, spend - numberValue(offer.monthly_price));
  const savingsComponent = spend > 0 ? estimatedSavings / Math.max(1, spend) : 0;
  const priorityComponent = Math.max(0, Math.min(numberValue(offer.priority), 100)) / 100;

  const score = eligible
    ? (mergedWeights.savings * savingsComponent)
      + (mergedWeights.data * dataScore(offer))
      + (mergedWeights.bundle * bundleFit(survey, offer, eligibility))
      + (mergedWeights.priority * priorityComponent)
    : -1;

  if (eligible) {
    if (estimatedSavings > 0) reasons.push(`Estimated savings ${Math.round(estimatedSavings)}`);
    if (offer.offer_target === "bundle") reasons.push("Bundle fit");
    if (numberValue(offer.priority) > 0) reasons.push("Priority offer");
  }

  return {
    offer,
    eligible,
    estimatedSavings,
    score,
    reasons,
  };
}

export function recommendOffer(
  survey: PromoterSurveyInput,
  offers: TelecomOffer[],
  weights: Partial<PromoterWeights> = {}
): { best: ScoredOffer | null; alternatives: ScoredOffer[]; all: ScoredOffer[] } {
  const all = offers
    .filter((offer) => offer.is_active !== false)
    .map((offer) => scoreOffer(survey, offer, weights))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.estimatedSavings !== a.estimatedSavings) return b.estimatedSavings - a.estimatedSavings;
      return numberValue(b.offer.priority) - numberValue(a.offer.priority);
    });

  const eligible = all.filter((item) => item.eligible);
  const best = eligible[0] || null;
  const alternatives = eligible.slice(best ? 1 : 0, best ? 4 : 3);

  return { best, alternatives, all };
}

export function recommendationSnapshot(scored: ReturnType<typeof recommendOffer>) {
  const toCandidate = (item: ScoredOffer) => ({
    offer_id: item.offer.id,
    score: Number(item.score.toFixed(4)),
    eligible: item.eligible,
    estimated_savings: item.estimatedSavings,
    reasons: item.reasons,
  });

  return {
    best: scored.best ? toCandidate(scored.best) : null,
    alternatives: scored.alternatives.map(toCandidate),
    all: scored.all.map(toCandidate),
  };
}
