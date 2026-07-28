import assert from "node:assert/strict";
import test from "node:test";
import { isStrongEmployeeAccountPassword } from "../src/lib/employee-account-password";

test("employee temporary passwords require length, mixed case, and a number", () => {
  assert.equal(isStrongEmployeeAccountPassword("StrongPass123"), true);
  assert.equal(isStrongEmployeeAccountPassword("Short1A"), false);
  assert.equal(isStrongEmployeeAccountPassword("alllowercase123"), false);
  assert.equal(isStrongEmployeeAccountPassword("ALLUPPERCASE123"), false);
  assert.equal(isStrongEmployeeAccountPassword("NoNumbersHere"), false);
});

test("employee temporary passwords reject values over the supported maximum", () => {
  assert.equal(isStrongEmployeeAccountPassword(`Aa1${"x".repeat(126)}`), false);
});
