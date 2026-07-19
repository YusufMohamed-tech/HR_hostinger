import assert from "node:assert/strict";
import test from "node:test";
import { recruitmentFormSchema, validatePublicApplicationAnswers } from "../src/lib/recruitment-form";

const questions = recruitmentFormSchema.parse([
  { id: "experience", type: "number", label: "Experience", required: true, order: 1 },
  { id: "availability", type: "select", label: "Availability", options: ["Now", "Later"], required: true, order: 2 },
  { id: "portfolio", type: "file", label: "Portfolio", required: true, order: 3, accept: ".pdf,.docx" },
  { id: "start_date", type: "date", label: "Start date", required: false, order: 4 },
]);

test("recruitment form schema normalizes option strings and rejects duplicate IDs", () => {
  const normalized = recruitmentFormSchema.parse([
    { id: "choice", type: "select", label: "Choice", options: "One, Two", required: false, order: 1 },
  ]);
  assert.deepEqual(normalized[0].options, ["One", "Two"]);
  assert.equal(recruitmentFormSchema.safeParse([
    { id: "same", type: "text", label: "One", required: false, order: 1 },
    { id: "same", type: "text", label: "Two", required: false, order: 2 },
  ]).success, false);
});

test("candidate answers require declared fields, valid values, and required uploads", () => {
  assert.deepEqual(validatePublicApplicationAnswers(
    questions,
    { experience: "4", availability: "Now", start_date: "2026-08-01" },
    new Set(["portfolio"]),
  ), { valid: true, issues: [] });

  const result = validatePublicApplicationAnswers(
    questions,
    { experience: "NaN", availability: "Never", unknown: "value", start_date: "2026-02-30" },
    new Set(),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [
    "Unknown answer field: unknown",
    "Answer must be a finite number: experience",
    "Answer is not an allowed option: availability",
    "Required answer is missing: portfolio",
    "Answer must be a valid date: start_date",
  ]);
});

test("file questions reject text substitution and unknown uploads", () => {
  const result = validatePublicApplicationAnswers(
    questions,
    { experience: "2", availability: "Later", portfolio: "pretend.pdf" },
    new Set(["not-a-question"]),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [
    "Unknown file field: not-a-question",
    "Required answer is missing: portfolio",
  ]);
});
