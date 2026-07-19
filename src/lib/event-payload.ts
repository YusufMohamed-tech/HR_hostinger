import { createHash } from "node:crypto";
import type { Json } from "@/types/database";

function canonicalJson(value: Json | undefined): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Event payload numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter((entry): entry is [string, Json] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function hashEventPayload(payload: Json) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
