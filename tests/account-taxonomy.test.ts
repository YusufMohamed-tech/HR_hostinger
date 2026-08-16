import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_SUBTYPE_LABELS_AR,
  ACCOUNT_SUBTYPE_TAXONOMY,
  isAccountingAccountType,
  getAccountSubtypeLabelAr,
  getAccountSubtypeOptions,
  isAccountSubtypeForType,
  isCanonicalAccountSubtype,
  isKnownLegacyAccountSubtypeForType,
  isSupportedAccountSubtypeForType,
  normalizeAccountingAccountSubtype,
  normalizeAccountingAccountType,
  normalizeAccountSubtype,
} from "../src/lib/accounting/account-taxonomy";

test("account subtype taxonomy provides labeled choices for every account type", () => {
  for (const [type, options] of Object.entries(ACCOUNT_SUBTYPE_TAXONOMY)) {
    assert.ok(options.length > 0, `${type} must have at least one subtype`);
    assert.equal(new Set(options.map((option) => option.value)).size, options.length);
    for (const option of options) {
      assert.ok(option.labelAr.trim().length > 0);
      assert.equal(ACCOUNT_SUBTYPE_LABELS_AR[option.value], option.labelAr);
    }
  }
});

test("account subtypes are constrained to their parent account type", () => {
  assert.equal(isAccountSubtypeForType("asset", "related_party_receivable"), true);
  assert.equal(isAccountSubtypeForType("liability", "related_party_receivable"), false);
  assert.equal(isAccountSubtypeForType("liability", "related_party_payable"), true);
  assert.equal(isAccountSubtypeForType("asset", "related_party_payable"), false);
  assert.equal(isAccountSubtypeForType("expense", "cost_of_revenue"), true);
  assert.equal(isAccountSubtypeForType("revenue", "cost_of_revenue"), false);
});

test("changing account type preserves compatible subtypes and clears incompatible ones", () => {
  assert.equal(normalizeAccountSubtype("asset", "bank"), "bank");
  assert.equal(normalizeAccountSubtype("asset", "  BANK  "), "bank");
  assert.equal(normalizeAccountSubtype("expense", "bank"), "");
  assert.equal(normalizeAccountSubtype("revenue", null), "");
});

test("account classification input normalization is safe for API payloads", () => {
  assert.equal(isAccountingAccountType("asset"), true);
  assert.equal(isAccountingAccountType(" asset "), false);
  assert.equal(normalizeAccountingAccountType(" Asset "), "asset");
  assert.equal(normalizeAccountingAccountType("contra_asset"), null);
  assert.equal(normalizeAccountingAccountType({}), null);
  assert.equal(normalizeAccountingAccountSubtype(" Related_Party_Receivable "), "related_party_receivable");
  assert.equal(normalizeAccountingAccountSubtype("   "), null);
  assert.equal(normalizeAccountingAccountSubtype(null), null);
  assert.equal(isCanonicalAccountSubtype("related_party_receivable"), true);
  assert.equal(isCanonicalAccountSubtype("employee_advances"), false);
});

test("known legacy subtypes remain type-bound while unknown values are unsupported", () => {
  assert.equal(isKnownLegacyAccountSubtypeForType("asset", "employee_advances"), true);
  assert.equal(isKnownLegacyAccountSubtypeForType("expense", "employee_advances"), false);
  assert.equal(isKnownLegacyAccountSubtypeForType("expense", "cost_of_sales"), true);
  assert.equal(isSupportedAccountSubtypeForType("asset", "related_party_receivable"), true);
  assert.equal(isSupportedAccountSubtypeForType("liability", "related_party_receivable"), false);
  assert.equal(isSupportedAccountSubtypeForType("asset", "custom_legacy_value"), false);
  assert.equal(isSupportedAccountSubtypeForType("asset", null), true);
});

test("subtype labels handle canonical, legacy, empty, and unknown values", () => {
  assert.equal(getAccountSubtypeLabelAr("commission_revenue"), "إيراد عمولات");
  assert.equal(getAccountSubtypeLabelAr("payroll"), "رواتب ومزايا موظفين");
  assert.equal(getAccountSubtypeLabelAr(null), "غير مصنف");
  assert.equal(getAccountSubtypeLabelAr("custom_legacy_value"), "custom_legacy_value");
  assert.deepEqual(
    getAccountSubtypeOptions("equity").map((option) => option.value),
    ["capital", "retained_earnings", "reserves", "current_year_result"],
  );
});
