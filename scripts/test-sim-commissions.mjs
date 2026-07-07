import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = path.resolve("src/lib/server/sim-commissions.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, require, console });

const { calculateSimPackageCommission } = module.exports;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertMoney(actual, expected, message) {
  assert(Math.abs(Number(actual) - expected) < 0.001, `${message}: expected ${expected}, got ${actual}`);
}

const merchantDefault = calculateSimPackageCommission({
  saleType: "merchant_sale",
  salePrice: 100,
  packageRow: { id: "pkg-default", package_name: "Default Package" },
});
assertMoney(merchantDefault.totalCommissionAmount, 15, "Default merchant total");
assertMoney(merchantDefault.agentCommissionAmount, 5, "Default merchant agent share");
assertMoney(merchantDefault.merchantCommissionAmount, 10, "Default merchant share");
assertMoney(merchantDefault.directAgentCommissionAmount, 0, "Default merchant direct share");

const directDefault = calculateSimPackageCommission({
  saleType: "agent_direct",
  salePrice: 100,
  packageRow: { id: "pkg-default", package_name: "Default Package" },
});
assertMoney(directDefault.totalCommissionAmount, 15, "Default direct total");
assertMoney(directDefault.agentCommissionAmount, 15, "Default direct agent share");
assertMoney(directDefault.merchantCommissionAmount, 0, "Default direct merchant share");
assertMoney(directDefault.directAgentCommissionAmount, 15, "Default direct snapshot");

const custom = calculateSimPackageCommission({
  saleType: "merchant_sale",
  salePrice: 100,
  packageRow: {
    total_commission_type: "flat",
    total_commission_value: 20,
    agent_chain_commission_type: "flat",
    agent_chain_commission_value: 8,
    merchant_commission_type: "flat",
    merchant_commission_value: 12,
    direct_agent_commission_type: "flat",
    direct_agent_commission_value: 20,
  },
});
assertMoney(custom.totalCommissionAmount, 20, "Custom total");
assertMoney(custom.agentCommissionAmount, 8, "Custom agent chain");
assertMoney(custom.merchantCommissionAmount, 12, "Custom merchant");

const customDirect = calculateSimPackageCommission({
  saleType: "agent_direct",
  salePrice: 100,
  packageRow: {
    total_commission_type: "flat",
    total_commission_value: 20,
    agent_chain_commission_type: "flat",
    agent_chain_commission_value: 8,
    merchant_commission_type: "flat",
    merchant_commission_value: 12,
    direct_agent_commission_type: "flat",
    direct_agent_commission_value: 20,
  },
});
assertMoney(customDirect.agentCommissionAmount, 20, "Custom direct agent");
assertMoney(customDirect.directAgentCommissionAmount, 20, "Custom direct snapshot");

const percentage = calculateSimPackageCommission({
  saleType: "merchant_sale",
  salePrice: 200,
  packageRow: {
    total_commission_type: "percentage",
    total_commission_value: 10,
    agent_chain_commission_type: "percentage",
    agent_chain_commission_value: 4,
    merchant_commission_type: "percentage",
    merchant_commission_value: 6,
    direct_agent_commission_type: "percentage",
    direct_agent_commission_value: 10,
  },
});
assertMoney(percentage.totalCommissionAmount, 20, "Percentage total");
assertMoney(percentage.agentCommissionAmount, 8, "Percentage agent chain");
assertMoney(percentage.merchantCommissionAmount, 12, "Percentage merchant");

let rejectedNegative = false;
try {
  calculateSimPackageCommission({
    saleType: "merchant_sale",
    salePrice: 100,
    packageRow: { total_commission_value: -1 },
  });
} catch {
  rejectedNegative = true;
}
assert(rejectedNegative, "Expected negative commission values to be rejected.");

console.log("SIM commission calculation tests passed.");
