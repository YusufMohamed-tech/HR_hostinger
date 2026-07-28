import { normalizeSerial } from "@/lib/product-inventory/normalization";
import type {
  ProductInventoryImportRow,
  ProductInventoryImportRowStatus,
  ProductInventoryProduct,
} from "@/types/product-inventory";

export const PRODUCT_INVENTORY_WORKBOOK_VERSION = "product-inventory-workbook-v1";
export const PRODUCT_INVENTORY_WORKBOOK_HEADERS = [
  "supplier_code",
  "receipt_reference",
  "product_sku",
  "product_name",
  "model",
  "serial_number",
  "barcode",
  "unit_cost",
  "planned_sale_price",
  "currency",
  "tax_code",
  "condition",
  "notes",
] as const;

type WorkbookField = typeof PRODUCT_INVENTORY_WORKBOOK_HEADERS[number];
type RawCell = string | number | boolean | Date | null | undefined;
type CatalogAlias = { product_id: string; normalized_value: string };

const HEADER_ALIASES: Record<WorkbookField, string[]> = {
  supplier_code: ["supplier_code", "supplier", "suppliercode", "رمز المورد", "كود المورد", "المورد"],
  receipt_reference: ["receipt_reference", "receipt", "reference", "مرجع الاستلام", "رقم الاستلام"],
  product_sku: ["product_sku", "sku", "product code", "رمز المنتج", "كود المنتج"],
  product_name: ["product_name", "product", "name", "اسم المنتج", "المنتج"],
  model: ["model", "variant", "الموديل", "الطراز"],
  serial_number: ["serial_number", "serial", "serial no", "sn", "الرقم التسلسلي", "السيريال"],
  barcode: ["barcode", "bar code", "الباركود"],
  unit_cost: ["unit_cost", "cost", "acquisition cost", "تكلفة الوحدة", "التكلفة"],
  planned_sale_price: ["planned_sale_price", "sale_price", "selling price", "سعر البيع المخطط", "سعر البيع"],
  currency: ["currency", "currency_code", "العملة"],
  tax_code: ["tax_code", "vat", "vat_code", "رمز الضريبة", "الضريبة"],
  condition: ["condition", "item_condition", "حالة المنتج", "الحالة"],
  notes: ["notes", "note", "ملاحظات", "ملاحظة"],
};

export function normalizeWorkbookHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeProductMatchValue(value: unknown) {
  return normalizeWorkbookHeader(value);
}

function headerMap(row: RawCell[]) {
  const normalized = row.map(normalizeWorkbookHeader);
  const mapping = new Map<WorkbookField, number>();
  for (const field of PRODUCT_INVENTORY_WORKBOOK_HEADERS) {
    const aliases = new Set(HEADER_ALIASES[field].map(normalizeWorkbookHeader));
    const index = normalized.findIndex((header) => aliases.has(header));
    if (index >= 0) mapping.set(field, index);
  }
  if (!mapping.has("serial_number")) {
    throw new Error("Workbook must contain a serial_number column (الرقم التسلسلي).");
  }
  if (!mapping.has("product_sku") && !mapping.has("product_name") && !mapping.has("barcode")) {
    throw new Error("Workbook must contain product_sku, product_name, or barcode.");
  }
  return mapping;
}

function rawCell(row: RawCell[], mapping: Map<WorkbookField, number>, field: WorkbookField) {
  const index = mapping.get(field);
  return index === undefined ? null : row[index] ?? null;
}

function textCell(value: RawCell) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function formulaLike(value: RawCell) {
  return typeof value === "string" && /^[=+@]/u.test(value.trim());
}

function moneyCell(value: RawCell) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (formulaLike(value)) return Number.NaN;
  const normalized = String(value).trim().replaceAll(",", "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function conditionCell(value: RawCell): ProductInventoryImportRow["condition"] {
  const normalized = normalizeWorkbookHeader(value);
  if (["openbox", "opened", "مفتوح", "مفتوحالصندوق"].includes(normalized)) return "open_box";
  if (["refurbished", "renewed", "مجدد", "معادتجديده"].includes(normalized)) return "refurbished";
  return "new";
}

function originalData(row: RawCell[], headers: RawCell[]) {
  const data: ProductInventoryImportRow["raw_data"] = {};
  for (let index = 0; index < headers.length; index += 1) {
    const key = textCell(headers[index]) || `column_${index + 1}`;
    const value = row[index];
    data[key] = value instanceof Date ? value.toISOString() : value ?? null;
  }
  return data;
}

function matchProduct(
  values: { sku: string; name: string; barcode: string; model: string },
  products: ProductInventoryProduct[],
  aliases: CatalogAlias[]
) {
  const sku = normalizeProductMatchValue(values.sku);
  const barcode = normalizeProductMatchValue(values.barcode);
  const name = normalizeProductMatchValue(values.name);
  const model = normalizeProductMatchValue(values.model);
  let matches: ProductInventoryProduct[] = [];
  let confidence = 0;

  if (sku) {
    matches = products.filter((product) => normalizeProductMatchValue(product.sku) === sku);
    confidence = 1;
  }
  if (matches.length === 0 && barcode) {
    matches = products.filter((product) => normalizeProductMatchValue(product.barcode) === barcode);
    confidence = 1;
  }
  if (matches.length === 0 && name) {
    matches = products.filter((product) => normalizeProductMatchValue(product.name) === name);
    confidence = 0.95;
  }
  if (matches.length === 0 && (sku || barcode || name)) {
    const candidates = new Set(
      aliases
        .filter((alias) => [sku, barcode, name].includes(alias.normalized_value))
        .map((alias) => alias.product_id)
    );
    matches = products.filter((product) => candidates.has(product.id));
    confidence = 0.9;
  }
  if (matches.length > 1 && model) {
    const narrowed = matches.filter((product) => normalizeProductMatchValue(product.model) === model);
    if (narrowed.length > 0) matches = narrowed;
  }
  return { product: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1, confidence };
}

function statusFor(errors: string[], warnings: string[], unmatched: boolean, duplicate: boolean): ProductInventoryImportRowStatus {
  if (duplicate) return "duplicate";
  if (unmatched) return "unmatched";
  if (errors.length > 0) return "invalid";
  if (warnings.length > 0) return "warning";
  return "valid";
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

export function parseProductInventoryWorkbookRows(
  rows: RawCell[][],
  context: {
    products: ProductInventoryProduct[];
    aliases?: CatalogAlias[];
    defaultCurrency?: string;
  }
) {
  if (rows.length < 2) throw new Error("Workbook is empty.");
  const headers = rows[0];
  const mapping = headerMap(headers);
  const aliases = context.aliases ?? [];
  const parsed: ProductInventoryImportRow[] = [];
  const seen = new Set<string>();

  for (const [offset, row] of rows.slice(1).entries()) {
    if (row.every((value) => textCell(value) === "")) continue;
    const rowNumber = offset + 2;
    const sku = textCell(rawCell(row, mapping, "product_sku"));
    const productName = textCell(rawCell(row, mapping, "product_name"));
    const model = textCell(rawCell(row, mapping, "model"));
    const barcode = textCell(rawCell(row, mapping, "barcode"));
    const serialValue = rawCell(row, mapping, "serial_number");
    const serial = textCell(serialValue);
    const normalizedSerial = normalizeSerial(serial);
    const unitCost = moneyCell(rawCell(row, mapping, "unit_cost"));
    const plannedSalePrice = moneyCell(rawCell(row, mapping, "planned_sale_price"));
    const currency = (textCell(rawCell(row, mapping, "currency")) || context.defaultCurrency || "SAR").toUpperCase();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof serialValue === "number") {
      errors.push("Serial number must be formatted as text to preserve leading zeros.");
    }
    if (!serial || normalizedSerial.length < 1 || normalizedSerial.length > 160 || formulaLike(serialValue)) {
      errors.push("Serial number is missing or invalid.");
    }
    if (formulaLike(rawCell(row, mapping, "product_sku")) || formulaLike(rawCell(row, mapping, "product_name"))) {
      errors.push("Formula-like product cells are not allowed.");
    }
    if (unitCost === null || !Number.isFinite(unitCost) || unitCost <= 0) {
      errors.push("Unit cost must be greater than zero.");
    }
    if (plannedSalePrice === null || !Number.isFinite(plannedSalePrice) || plannedSalePrice <= 0) {
      errors.push("Planned sale price must be greater than zero.");
    }
    if (!/^[A-Z]{3}$/u.test(currency)) errors.push("Currency must be a three-letter code.");

    const match = matchProduct({ sku, name: productName, barcode, model }, context.products, aliases);
    if (match.ambiguous) warnings.push("Product match is ambiguous; select the correct catalog product.");
    const duplicate = Boolean(normalizedSerial && seen.has(normalizedSerial));
    if (duplicate) errors.push("Serial number is duplicated inside this workbook.");
    if (normalizedSerial) seen.add(normalizedSerial);
    const unmatched = !match.product;
    if (unmatched) errors.push("Product could not be matched to the selected supplier catalog.");

    parsed.push({
      row_number: rowNumber,
      raw_data: originalData(row, headers),
      supplier_code: textCell(rawCell(row, mapping, "supplier_code")),
      receipt_reference: textCell(rawCell(row, mapping, "receipt_reference")),
      product_sku: sku,
      product_name: productName,
      model,
      product_id: match.product?.id || "",
      serial_number: serial,
      normalized_serial: normalizedSerial,
      barcode,
      unit_cost: Number.isFinite(unitCost) ? unitCost : null,
      planned_sale_price: Number.isFinite(plannedSalePrice) ? plannedSalePrice : null,
      currency,
      tax_code: textCell(rawCell(row, mapping, "tax_code")),
      condition: conditionCell(rawCell(row, mapping, "condition")),
      notes: textCell(rawCell(row, mapping, "notes")),
      status: statusFor(errors, warnings, unmatched, duplicate),
      confidence: match.product ? match.confidence : 0,
      validation_errors: errors,
      validation_warnings: warnings,
    });
  }
  if (parsed.length === 0) throw new Error("Workbook contains no data rows.");
  return { rows: parsed, headers: headers.map(textCell) };
}

function safeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildInventoryImportCsv(rows: ProductInventoryImportRow[], errorsOnly = false) {
  const headers = [...PRODUCT_INVENTORY_WORKBOOK_HEADERS, "row_status", "errors", "warnings"];
  const selected = errorsOnly
    ? rows.filter((row) => !["valid", "warning"].includes(row.status))
    : rows;
  const lines = selected.map((row) => [
    row.supplier_code,
    row.receipt_reference,
    row.product_sku,
    row.product_name,
    row.model,
    row.serial_number,
    row.barcode,
    row.unit_cost,
    row.planned_sale_price,
    row.currency,
    row.tax_code,
    row.condition,
    row.notes,
    row.status,
    row.validation_errors.join("; "),
    row.validation_warnings.join("; "),
  ].map(safeCsvCell).join(","));
  return `\uFEFF${headers.map(safeCsvCell).join(",")}\n${lines.join("\n")}\n`;
}
