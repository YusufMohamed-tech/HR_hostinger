import assert from "node:assert/strict";
import test from "node:test";
import { hashEventPayload } from "../src/lib/event-payload";

test("event payload hashes are stable across object key order", () => {
  const left = hashEventPayload({ employeeId: "e1", values: { amount: 100, currency: "SAR" } });
  const right = hashEventPayload({ values: { currency: "SAR", amount: 100 }, employeeId: "e1" });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test("event payload hashes preserve array order", () => {
  assert.notEqual(hashEventPayload(["first", "second"]), hashEventPayload(["second", "first"]));
});

test("undefined object values do not make idempotency unstable", () => {
  assert.equal(hashEventPayload({ value: 1, optional: undefined }), hashEventPayload({ value: 1 }));
});

test("non-finite numbers are rejected", () => {
  assert.throws(() => hashEventPayload(Number.NaN), /must be finite/);
});
