import assert from "node:assert/strict";
import test from "node:test";
import { isCrossSiteMutation, type MutationRequestLike } from "../src/lib/cross-site-mutation";

function request({
  method = "POST",
  pathname = "/api/auth/login",
  requestOrigin = "http://127.0.0.1:3000",
  headers = {},
}: {
  method?: string;
  pathname?: string;
  requestOrigin?: string;
  headers?: Record<string, string>;
} = {}): MutationRequestLike {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    method,
    nextUrl: { origin: requestOrigin, pathname },
    headers: {
      get(name) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

test("allows a same-origin mutation through a TLS-terminating reverse proxy", () => {
  assert.equal(isCrossSiteMutation(request({
    headers: {
      origin: "https://hr.chessboard-systems.com",
      host: "127.0.0.1:3000",
      "x-forwarded-host": "hr.chessboard-systems.com",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  })), false);
});

test("allows a same-origin mutation using the public Host header", () => {
  assert.equal(isCrossSiteMutation(request({
    headers: {
      origin: "https://hr.chessboard-systems.com",
      host: "hr.chessboard-systems.com",
      "sec-fetch-site": "same-origin",
    },
  })), false);
});

test("rejects a browser-declared cross-site mutation", () => {
  assert.equal(isCrossSiteMutation(request({
    headers: {
      origin: "https://attacker.example",
      host: "hr.chessboard-systems.com",
      "sec-fetch-site": "cross-site",
    },
  })), true);
});

test("rejects a mutation with an untrusted Origin", () => {
  assert.equal(isCrossSiteMutation(request({
    headers: {
      origin: "https://attacker.example",
      host: "hr.chessboard-systems.com",
      "x-forwarded-proto": "https",
    },
  })), true);
});

test("rejects malformed Origin values", () => {
  assert.equal(isCrossSiteMutation(request({
    headers: {
      origin: "not-an-origin",
      host: "hr.chessboard-systems.com",
    },
  })), true);
});

test("does not apply the mutation check to safe methods or non-API routes", () => {
  const crossSiteHeaders = {
    origin: "https://attacker.example",
    host: "hr.chessboard-systems.com",
    "sec-fetch-site": "cross-site",
  };
  assert.equal(isCrossSiteMutation(request({ method: "GET", headers: crossSiteHeaders })), false);
  assert.equal(isCrossSiteMutation(request({ pathname: "/login", headers: crossSiteHeaders })), false);
});
