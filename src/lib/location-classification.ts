import { saudiCityOptions } from "@/lib/hr-options";
import type { SalesCompany } from "@/lib/services/sales";

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .trim();
}

function getRecordText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function inferLocationCity(location: Record<string, unknown>) {
  const explicitCity = getRecordText(location, "city");
  if (explicitCity) return explicitCity;

  const normalizedName = normalizeText(location.name);
  return saudiCityOptions.find((city) => normalizedName.includes(normalizeText(city))) || "";
}

export function getSalesCompanyAliases(company?: SalesCompany | null) {
  if (!company) return [];
  const hints = [company.name, company.slug, company.code].filter(Boolean).map(String);
  const key = normalizeText(`${company.code || ""} ${company.slug || ""} ${company.name || ""}`);

  if (key.includes("lebara")) hints.push("ليبارا", "lebara");
  if (key.includes("virgin")) hints.push("فيرجن", "virgin");
  if (key.includes("salam")) hints.push("سلام", "سلام موبايل", "salam");
  if (key.includes("red") || key.includes("rbm")) hints.push("ريدبول", "ريد بول", "red bull", "redbull", "rbm");
  if (key.includes("mobily")) hints.push("موبايلي", "mobily");
  if (key.includes("zain")) hints.push("زين", "zain");
  if (key.includes("stc")) hints.push("stc", "اس تي سي", "إس تي سي", "الاتصالات السعودية");

  return Array.from(new Set(hints.map(normalizeText).filter(Boolean)));
}

export function locationMatchesCompany(location: Record<string, unknown>, company?: SalesCompany | null) {
  if (!company) return true;
  const locationProjectId = getRecordText(location, "project_id");
  if (locationProjectId && locationProjectId === company.id) return true;

  const relation = location.project as Record<string, unknown> | null | undefined;
  if (relation && getRecordText(relation, "id") === company.id) return true;

  const aliases = getSalesCompanyAliases(company);
  if (aliases.length === 0) return true;

  const projectText = normalizeText([
    location.project_name,
    relation?.name,
    relation?.slug,
    relation?.code,
    location.name,
  ].filter(Boolean).join(" "));

  return aliases.some((alias) => projectText.includes(alias));
}
