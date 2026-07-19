import assert from "node:assert/strict";
import test from "node:test";
import { REQUEST_ID_PATTERN, requestIdFromHeaders } from "../src/lib/request-id";

test("request IDs preserve a valid upstream UUID for end-to-end correlation", () => {
  const requestId = "12345678-1234-4234-8234-123456789abc";
  assert.equal(requestIdFromHeaders(new Headers({ "x-request-id": requestId })), requestId);
});

test("request IDs replace missing or malformed upstream values", () => {
  // Use a duck-typed header mock — undici rejects literal newlines in Header construction,
  // but the function must still sanitize anything it receives from untrusted sources.
  const malformed = { get: () => "log-injection\nvalue" };
  const generated = requestIdFromHeaders(malformed);
  assert.match(generated, REQUEST_ID_PATTERN);
  assert.notEqual(generated, "log-injection\nvalue");

  // Missing header also generates a fresh UUID.
  assert.match(requestIdFromHeaders(new Headers()), REQUEST_ID_PATTERN);
});
