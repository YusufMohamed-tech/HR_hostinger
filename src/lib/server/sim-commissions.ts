export type SimSaleCommissionType = "agent_direct" | "merchant_sale";
export type SimCommissionType = "flat" | "percentage";

export type SimCommissionRule = {
  type: SimCommissionType;
  value: number;
  amount: number;
};

export type SimCommissionRuleSnapshot = {
  saleType: SimSaleCommissionType;
  salePrice: number;
  currency: string;
  package: {
    id: string | null;
    name: string | null;
    provider: string | null;
  };
  rules: {
    total: SimCommissionRule;
    agentChain: SimCommissionRule;
    merchant: SimCommissionRule;
    directAgent: SimCommissionRule;
  };
  calculated: {
    totalCommissionAmount: number;
    agentCommissionAmount: number;
    merchantCommissionAmount: number;
    directAgentCommissionAmount: number;
  };
  warnings: string[];
  legacy: {
    agentCommissionType: SimCommissionType;
    agentCommissionValue: number;
    merchantCommissionType: SimCommissionType;
    merchantCommissionValue: number;
  };
};

export type SimCommissionCalculation = {
  currency: string;
  totalCommissionAmount: number;
  agentCommissionAmount: number;
  merchantCommissionAmount: number;
  directAgentCommissionAmount: number;
  ruleSnapshot: SimCommissionRuleSnapshot;
};

type CalculateSimPackageCommissionInput = {
  saleType: SimSaleCommissionType;
  salePrice: number;
  packageRow: Record<string, unknown>;
};

const DEFAULT_CURRENCY = "SAR";
const DEFAULT_TOTAL = 15;
const DEFAULT_AGENT_CHAIN = 5;
const DEFAULT_MERCHANT = 10;
const DEFAULT_DIRECT_AGENT = 15;

function isCommissionType(value: unknown): value is SimCommissionType {
  return value === "flat" || value === "percentage";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function typeValue(value: unknown, fallback: SimCommissionType): SimCommissionType {
  return isCommissionType(value) ? value : fallback;
}

function numericValue(value: unknown, fallback: number, label: string): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
  if (parsed < 0) throw new Error(`${label} cannot be negative.`);
  return parsed;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amountFromRule(type: SimCommissionType, value: number, salePrice: number): number {
  const amount = type === "percentage" ? (salePrice * value) / 100 : value;
  if (amount < 0) throw new Error("Calculated commission amount cannot be negative.");
  return roundMoney(amount);
}

function buildRule(type: SimCommissionType, value: number, salePrice: number): SimCommissionRule {
  return {
    type,
    value,
    amount: amountFromRule(type, value, salePrice),
  };
}

export function calculateSimPackageCommission({
  saleType,
  salePrice,
  packageRow,
}: CalculateSimPackageCommissionInput): SimCommissionCalculation {
  if (saleType !== "agent_direct" && saleType !== "merchant_sale") {
    throw new Error("Unsupported SIM sale commission type.");
  }
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error("Sale price must be a non-negative number.");
  }

  const currency = stringValue(packageRow.commission_currency) || DEFAULT_CURRENCY;
  const legacyAgentType = typeValue(packageRow.agent_commission_type, "flat");
  const legacyAgentValue = numericValue(packageRow.agent_commission_value, DEFAULT_AGENT_CHAIN, "Agent commission value");
  const legacyMerchantType = typeValue(packageRow.merchant_commission_type, "flat");
  const legacyMerchantValue = numericValue(packageRow.merchant_commission_value, DEFAULT_MERCHANT, "Merchant commission value");

  const totalType = typeValue(packageRow.total_commission_type, "flat");
  const totalValue = numericValue(packageRow.total_commission_value, DEFAULT_TOTAL, "Total commission value");
  const agentChainType = typeValue(packageRow.agent_chain_commission_type, legacyAgentType);
  const agentChainValue = numericValue(packageRow.agent_chain_commission_value, legacyAgentValue, "Agent chain commission value");
  const merchantType = legacyMerchantType;
  const merchantValue = legacyMerchantValue;
  const directAgentType = typeValue(packageRow.direct_agent_commission_type, totalType);
  const directAgentValue = numericValue(packageRow.direct_agent_commission_value, totalValue || DEFAULT_DIRECT_AGENT, "Direct agent commission value");

  const totalRule = buildRule(totalType, totalValue, salePrice);
  const agentChainRule = buildRule(agentChainType, agentChainValue, salePrice);
  const merchantRule = buildRule(merchantType, merchantValue, salePrice);
  const directAgentRule = buildRule(directAgentType, directAgentValue, salePrice);

  const warnings: string[] = [];
  let agentCommissionAmount = 0;
  let merchantCommissionAmount = 0;
  let directAgentCommissionAmount = 0;

  if (saleType === "merchant_sale") {
    agentCommissionAmount = agentChainRule.amount;
    merchantCommissionAmount = merchantRule.amount;
    const splitTotal = roundMoney(agentCommissionAmount + merchantCommissionAmount);
    if (splitTotal !== totalRule.amount) {
      warnings.push("Merchant-sale commission split does not equal the configured total commission.");
    }
  } else {
    agentCommissionAmount = directAgentRule.amount;
    directAgentCommissionAmount = directAgentRule.amount;
  }

  const calculated = {
    totalCommissionAmount: totalRule.amount,
    agentCommissionAmount,
    merchantCommissionAmount,
    directAgentCommissionAmount,
  };

  const ruleSnapshot: SimCommissionRuleSnapshot = {
    saleType,
    salePrice: roundMoney(salePrice),
    currency,
    package: {
      id: stringValue(packageRow.id) || null,
      name: stringValue(packageRow.package_name) || null,
      provider: stringValue(packageRow.provider) || null,
    },
    rules: {
      total: totalRule,
      agentChain: agentChainRule,
      merchant: merchantRule,
      directAgent: directAgentRule,
    },
    calculated,
    warnings,
    legacy: {
      agentCommissionType: legacyAgentType,
      agentCommissionValue: legacyAgentValue,
      merchantCommissionType: legacyMerchantType,
      merchantCommissionValue: legacyMerchantValue,
    },
  };

  return {
    currency,
    ...calculated,
    ruleSnapshot,
  };
}
