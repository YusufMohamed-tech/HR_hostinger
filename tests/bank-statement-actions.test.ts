import assert from "node:assert/strict";
import test from "node:test";
import {
  getBankStatementActionCapabilities,
  normalizeBankStatementEditInput,
  normalizeBankStatementReason,
} from "../src/lib/banking/statement-actions";

const validInput = {
  bank_account_id: "11111111-1111-4111-8111-111111111111",
  statement_date: "2026-08-15",
  period_start: "2026-08-01",
  period_end: "2026-08-15",
  opening_balance: "100.25",
  closing_balance: 200.5,
  file_name: " statement.csv ",
};

test("bank statement edit input is normalized and validates its period", () => {
  const result = normalizeBankStatementEditInput(validInput);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.opening_balance, 100.25);
    assert.equal(result.value.file_name, "statement.csv");
  }
  assert.equal(normalizeBankStatementEditInput({ ...validInput, period_end: "2026-07-31" }).ok, false);
  assert.equal(normalizeBankStatementEditInput({ ...validInput, statement_date: "2026-02-30" }).ok, false);
  assert.equal(normalizeBankStatementEditInput({ ...validInput, closing_balance: "NaN" }).ok, false);
  assert.equal(normalizeBankStatementEditInput({ ...validInput, bank_account_id: "not-a-uuid" }).ok, false);
});

test("recall reasons are mandatory and bounded", () => {
  assert.equal(normalizeBankStatementReason("  correction required  ", true).ok, true);
  assert.equal(normalizeBankStatementReason("   ", true).ok, false);
  assert.equal(normalizeBankStatementReason("", false).ok, true);
  assert.equal(normalizeBankStatementReason("x".repeat(1001), false).ok, false);
});

test("statement action capabilities follow role, lifecycle, activity, and recall history", () => {
  const imported = { status: "imported" as const, matched_count: 0, has_line_activity: false, recalled_at: null };
  assert.deepEqual(getBankStatementActionCapabilities(imported, "Accountant"), {
    canEdit: true,
    canRecall: false,
    canCancel: true,
  });
  assert.equal(getBankStatementActionCapabilities({ ...imported, has_line_activity: true }, "Finance_Manager").canEdit, false);
  assert.equal(getBankStatementActionCapabilities({ ...imported, recalled_at: "2026-08-17T00:00:00Z" }, "Finance_Manager").canCancel, false);
  assert.equal(getBankStatementActionCapabilities({ ...imported, status: "in_progress" }, "Finance_Manager").canRecall, true);
  assert.equal(getBankStatementActionCapabilities({ ...imported, status: "in_progress" }, "Accountant").canRecall, false);
});
