import assert from "node:assert/strict";
import test from "node:test";
import { journalRequiresCostCenter, validateJournalLines } from "../src/lib/accounting/validation";

const balancedLines = [
  { account_id: "asset-account", debit: 100, credit: 0, cost_center_id: "center-1" },
  { account_id: "equity-account", debit: 0, credit: 100, cost_center_id: "center-1" },
];

test("manual journal source normalization fails closed", () => {
  assert.equal(journalRequiresCostCenter(undefined), true);
  assert.equal(journalRequiresCostCenter(""), true);
  assert.equal(journalRequiresCostCenter(" MANUAL "), true);
  assert.equal(journalRequiresCostCenter("payroll"), false);
  assert.equal(journalRequiresCostCenter("reversal"), false);
});

test("manual journal lines require cost centers and identify each affected row", () => {
  const result = validateJournalLines([
    { ...balancedLines[0], cost_center_id: null },
    { ...balancedLines[1], cost_center_id: "" },
  ], { sourceModule: "manual" });

  assert.equal(result.valid, false);
  assert.equal("field" in result ? result.field : undefined, "cost_center_id");
  assert.deepEqual("lineErrors" in result ? (result.lineErrors ?? []).map((error) => error.lineIndex) : [], [0, 1]);
});

test("automated and reversal journals retain optional cost centers", () => {
  for (const sourceModule of ["payroll", "invoice", "reversal"]) {
    const result = validateJournalLines(
      balancedLines.map((line) => ({ account_id: line.account_id, debit: line.debit, credit: line.credit })),
      { sourceModule },
    );
    assert.equal(result.valid, true, sourceModule);
  }
});

test("untouched rows do not show a cost-center error before an account is selected", () => {
  const result = validateJournalLines([
    { account_id: "", debit: 100, credit: 0, cost_center_id: null },
    balancedLines[1],
  ], { sourceModule: "manual" });
  assert.equal(result.valid, false);
  assert.deepEqual("lineErrors" in result ? result.lineErrors : [], []);
});
