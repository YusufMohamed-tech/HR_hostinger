const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeCatalogIdentifier(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[٠-٩]/gu, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/\s+/gu, "")
    .toUpperCase();
}
export function normalizeCatalogText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[ـ\s\-_./\\]+/gu, " ")
    .trim();
}

export function catalogProductMatchKey(value: {
  name?: unknown;
  model?: unknown;
}) {
  return `${normalizeCatalogText(value.name)}|${normalizeCatalogText(value.model)}`;
}
