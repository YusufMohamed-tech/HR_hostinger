import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { coordinatesForLocation, hasCoordinates } from "./location-coordinate-utils.mjs";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const dryRun = process.env.DRY_RUN === "1";

if (!supabaseUrl || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const sourcePath = path.resolve(process.cwd(), "scripts", "sales-locations-2026.json");
const locationPayload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const sourceByName = new Map(locationPayload.locations.map((location) => [location.name, location]));

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        timeout: 90000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Supabase API ${response.statusCode}: ${raw}`));
            return;
          }
          resolve(raw ? JSON.parse(raw) : null);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Supabase API request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function querySupabase(query) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const result = await postJson(
    url,
    { query },
    {
      Authorization: `Bearer ${accessToken}`,
    }
  );

  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.value)) return result.value;
  return result ? [result] : [];
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

function isLikelySwappedSaudiCoordinate(location) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return latitude >= 34 && latitude <= 56 && longitude >= 16 && longitude <= 33;
}

async function loadLocations() {
  return querySupabase(`
    with org as (
      select id
      from public.organizations
      where slug = '${sqlString(orgSlug)}'
      limit 1
    )
    select
      id::text,
      name,
      type,
      latitude,
      longitude,
      radius_meters
    from public.locations
    where org_id = (select id from org)
    order by name;
  `);
}

async function applyUpdates(updates) {
  if (!updates.length || dryRun) return [];

  const payload = JSON.stringify(
    updates.map((update) => ({
      id: update.id,
      latitude: update.latitude,
      longitude: update.longitude,
      radius_meters: update.radius_meters,
    }))
  );

  return querySupabase(`
    with payload as (
      select *
      from jsonb_to_recordset($locations$${payload}$locations$::jsonb)
        as x(id uuid, latitude numeric, longitude numeric, radius_meters integer)
    )
    update public.locations as locations
    set
      latitude = payload.latitude,
      longitude = payload.longitude,
      radius_meters = coalesce(nullif(locations.radius_meters, 0), payload.radius_meters, 100),
      updated_at = now()
    from payload
    where locations.id = payload.id
    returning locations.id::text, locations.name, locations.latitude, locations.longitude;
  `);
}

function buildUpdates(locations) {
  const updates = [];
  const cityCounts = new Map();

  for (const location of locations) {
    if (isLikelySwappedSaudiCoordinate(location)) {
      updates.push({
        id: location.id,
        name: location.name,
        reason: "swapped",
        latitude: Number(location.longitude),
        longitude: Number(location.latitude),
        radius_meters: Number(location.radius_meters || 100),
      });
      continue;
    }

    if (hasCoordinates(location)) continue;

    const sourceLocation = sourceByName.get(location.name) || { name: location.name, city: "", site_name: "" };
    const coordinates = coordinatesForLocation(sourceLocation);
    cityCounts.set(coordinates.city_label, (cityCounts.get(coordinates.city_label) || 0) + 1);

    updates.push({
      id: location.id,
      name: location.name,
      reason: "missing",
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      radius_meters: Number(location.radius_meters || sourceLocation.radius_meters || 100),
      city_label: coordinates.city_label,
    });
  }

  return { updates, cityCounts };
}

const before = await loadLocations();
const { updates, cityCounts } = buildUpdates(before);
const updatedRows = await applyUpdates(updates);
const after = await loadLocations();
const missingAfter = after.filter((location) => !hasCoordinates(location)).length;
const swappedFixed = updates.filter((update) => update.reason === "swapped").length;
const missingFixed = updates.filter((update) => update.reason === "missing").length;

console.log(`Location coordinates ${dryRun ? "dry run" : "seed"} complete.`);
console.log(`Total locations: ${before.length}`);
console.log(`Missing coordinates fixed: ${dryRun ? 0 : missingFixed}${dryRun ? ` planned: ${missingFixed}` : ""}`);
console.log(`Swapped Saudi coordinates fixed: ${dryRun ? 0 : swappedFixed}${dryRun ? ` planned: ${swappedFixed}` : ""}`);
console.log(`Rows updated by database: ${updatedRows.length}`);
console.log(`Missing coordinates after run: ${missingAfter}`);
console.log("Cities covered:");
for (const [city, count] of [...cityCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${city}: ${count}`);
}
