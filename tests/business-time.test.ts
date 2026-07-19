import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidTimeZone,
  businessDateAt,
  businessDayUtcRange,
  businessMonthUtcRange,
  parseBusinessDate,
} from "../src/lib/business-time";

test("businessDateAt crosses midnight in the organization timezone", () => {
  assert.equal(businessDateAt("2026-07-17T20:59:59.999Z", "Asia/Riyadh"), "2026-07-17");
  assert.equal(businessDateAt("2026-07-17T21:00:00.000Z", "Asia/Riyadh"), "2026-07-18");
});

test("businessDayUtcRange honors DST spring-forward and fall-back days", () => {
  const spring = businessDayUtcRange("2026-03-08", "America/New_York");
  const fall = businessDayUtcRange("2026-11-01", "America/New_York");

  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 23);
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 3_600_000, 25);
  assert.equal(spring.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(fall.start.toISOString(), "2026-11-01T04:00:00.000Z");
});

test("businessMonthUtcRange uses local month boundaries", () => {
  const range = businessMonthUtcRange(2026, 7, "Asia/Riyadh");
  assert.equal(range.start.toISOString(), "2026-06-30T21:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-31T21:00:00.000Z");
});

test("invalid dates and timezones fail closed", () => {
  assert.throws(() => parseBusinessDate("2026-02-30"), /Invalid business date/);
  assert.throws(() => assertValidTimeZone("Not/A_Timezone"), /Invalid IANA timezone/);
});
