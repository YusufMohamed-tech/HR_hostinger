import type { ProductInventoryWorkbookCell } from "@/lib/product-inventory/workbook";
import type { ProductInventoryWorkbookSheet } from "@/lib/product-inventory/workbook-recognition";
import {
  catalogProductMatchKey,
  normalizeCatalogIdentifier,
  normalizeCatalogText,
} from "@/lib/product-catalog/normalization";

export const PRODUCT_CATALOG_ALGORITHM_VERSION = "product-catalog-v1";

export const PRODUCT_CATALOG_FIELDS = [
  "product_name",
  "sku",
  "barcode",
  "model",
  "description",
  "unit",
  "category",
  "planned_sale_price",
  "default_cost",
  "commission_type",
  "commission_value",
  "revenue_account_code",
  "is_active",
  "notes",
] as const;

export type ProductCatalogField = typeof PRODUCT_CATALOG_FIELDS[number];
export type ProductCatalogRowClassification =
  | "new"
  | "existing_unchanged"
  | "existing_update"
  | "ambiguous"
  | "identifier_conflict"
  | "duplicate_in_file"
  | "invalid";

export type CatalogRecognitionProduct = {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  unit?: string | null;
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
  model?: string | null;
  price: number;
  default_cost?: number | null;
  revenue_account_id?: string | null;
  agent_commission_type?: "flat" | "percentage" | null;
  agent_commission_value?: number | null;
  inventory_version: number;
  is_active: boolean;
};

export type ProductCatalogRecognizedRow = {
  row_id: string;
  source_sheet: string;
  source_row: number;
  raw_values: Record<string, string | number | boolean | null>;
  normalized_values: {
    product_name: string;
    sku: string | null;
    barcode: string | null;
    model: string | null;
    description: string | null;
    unit: string;
    category: string | null;
    planned_sale_price: number | null;
    default_cost: number;
    commission_type: "none" | "flat" | "percentage";
    commission_value: number;
    revenue_account_code: string | null;
    revenue_account_id: string | null;
    is_active: boolean;
    notes: string | null;
  };
  classification: ProductCatalogRowClassification;
  errors: string[];
  warnings: string[];
  matched_product_id: string | null;
  matched_inventory_version: number | null;
  suggested_changes: Record<string, { before: unknown; after: unknown }>;
};

export type ProductCatalogWorkbookRecognition = {
  algorithm_version: string;
  status: "ready" | "needs_review";
  sheet_name: string;
  sheet_index: number;
  header_row: number;
  confidence: number;
  header_mapping: Partial<Record<ProductCatalogField, string>>;
  blocking_errors: string[];
  warnings: string[];
  summary: Record<ProductCatalogRowClassification, number> & { total: number };
  rows: ProductCatalogRecognizedRow[];
};

const aliases: Record<ProductCatalogField, string[]> = {
  product_name: ["اسم المنتج", "المنتج", "الصنف", "product name", "product", "item name"],
  sku: ["sku", "كود المنتج", "كود الصنف", "product sku", "item code", "product code"],
  barcode: ["الباركود", "باركود", "barcode", "ean", "upc"],
  model: ["الموديل", "موديل", "الطراز", "model", "device model"],
  description: ["الوصف", "وصف المنتج", "description", "product description"],
  unit: ["الوحدة", "وحده", "وحدة القياس", "unit", "uom"],
  category: ["الفئة", "التصنيف", "category", "product category"],
  planned_sale_price: ["سعر البيع", "سعر البيع المخطط", "السعر", "sale price", "planned sale price", "price"],
  default_cost: ["التكلفة", "تكلفة الوحدة", "سعر التكلفة", "cost", "unit cost", "default cost"],
  commission_type: ["نوع العمولة", "commission type"],
  commission_value: ["قيمة العمولة", "نسبة العمولة", "commission value", "commission amount", "commission"],
  revenue_account_code: ["كود حساب الإيراد", "حساب الإيراد", "revenue account code", "revenue account"],
  is_active: ["نشط", "الحالة", "فعال", "active", "status", "enabled"],
  notes: ["ملاحظات", "ملاحظة", "notes", "note"],
};

const normalizedAliases = Object.fromEntries(
  Object.entries(aliases).map(([field, values]) => [field, values.map(normalizeCatalogText)])
) as Record<ProductCatalogField, string[]>;

function cellText(value: ProductInventoryWorkbookCell) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "").trim();
}

function isBlankRow(row: ProductInventoryWorkbookCell[]) {
  return row.every((cell) => !cellText(cell));
}

function headerField(value: ProductInventoryWorkbookCell) {
  const normalized = normalizeCatalogText(cellText(value));
  if (!normalized) return null;
  let best: { field: ProductCatalogField; score: number } | null = null;
  for (const field of PRODUCT_CATALOG_FIELDS) {
    for (const alias of normalizedAliases[field]) {
      const score = normalized === alias ? 1 : normalized.includes(alias) || alias.includes(normalized) ? 0.76 : 0;
      if (score > (best?.score ?? 0)) best = { field, score };
    }
  }
  return best;
}

function detectHeader(sheets: ProductInventoryWorkbookSheet[]) {
  type HeaderCandidate = {
    sheetIndex: number;
    rowIndex: number;
    score: number;
    columns: Map<ProductCatalogField, number>;
  };
  let best: HeaderCandidate | null = null;
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex]!;
    const candidateRows = sheet.rows.slice(0, 100);
    for (let rowIndex = 0; rowIndex < candidateRows.length; rowIndex += 1) {
      const row = candidateRows[rowIndex]!;
      const columns = new Map<ProductCatalogField, number>();
      let score = 0;
      row.forEach((cell, columnIndex) => {
        const match = headerField(cell);
        if (!match || columns.has(match.field)) return;
        columns.set(match.field, columnIndex);
        score += match.score;
      });
      if (columns.has("product_name")) score += 2;
      if (columns.has("planned_sale_price")) score += 2;
      if (columns.has("sku") || columns.has("barcode")) score += 2;
      const dataRows = sheet.rows.slice(rowIndex + 1, rowIndex + 11).filter((candidate) => !isBlankRow(candidate)).length;
      score += Math.min(1, dataRows / 5);
      if (!best || score > best.score) best = { sheetIndex, rowIndex, score, columns };
    }
  }
  return best;
}

function localizedNumber(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeCatalogIdentifier(raw)
    .replace(/[،,](?=\d{3}(?:\D|$))/gu, "")
    .replace(/،/gu, ".")
    .replace(/[^0-9.\-]/gu, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeValue(value: unknown) {
  const normalized = normalizeCatalogText(value);
  if (!normalized) return true;
  return !["لا", "غير نشط", "متوقف", "inactive", "disabled", "false", "0"].includes(normalized);
}

function commissionType(value: unknown): "none" | "flat" | "percentage" {
  const normalized = normalizeCatalogText(value);
  if (["percentage", "percent", "نسبه", "نسبه مئويه", "%"].includes(normalized)) return "percentage";
  if (["flat", "fixed", "ثابت", "قيمه ثابته", "مبلغ"].includes(normalized)) return "flat";
  return "none";
}

function comparable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" ? Number(value.toFixed(2)) : normalizeCatalogText(value);
}

export function recognizeProductCatalogWorkbook(
  sheets: ProductInventoryWorkbookSheet[],
  options: {
    companyId: string;
    products: CatalogRecognitionProduct[];
    revenueAccounts?: Array<{ id: string; code: string }>;
  }
): ProductCatalogWorkbookRecognition {
  const detected = detectHeader(sheets);
  const emptySummary = {
    total: 0,
    new: 0,
    existing_unchanged: 0,
    existing_update: 0,
    ambiguous: 0,
    identifier_conflict: 0,
    duplicate_in_file: 0,
    invalid: 0,
  };
  if (!detected) {
    return {
      algorithm_version: PRODUCT_CATALOG_ALGORITHM_VERSION,
      status: "needs_review",
      sheet_name: "",
      sheet_index: -1,
      header_row: 0,
      confidence: 0,
      header_mapping: {},
      blocking_errors: ["تعذر العثور على صف عناوين واضح داخل الملف."],
      warnings: [],
      summary: emptySummary,
      rows: [],
    };
  }
  const sheet = sheets[detected.sheetIndex]!;
  const headerMapping: Partial<Record<ProductCatalogField, string>> = {};
  detected.columns.forEach((column, field) => {
    headerMapping[field] = cellText(sheet.rows[detected.rowIndex]?.[column] ?? null);
  });
  const blockingErrors: string[] = [];
  if (!detected.columns.has("product_name")) blockingErrors.push("عمود اسم المنتج مطلوب.");
  if (!detected.columns.has("planned_sale_price")) blockingErrors.push("عمود سعر البيع مطلوب.");
  if (!detected.columns.has("sku") && !detected.columns.has("barcode")) {
    blockingErrors.push("يجب اكتشاف عمود SKU أو الباركود على الأقل.");
  }
  const requiredCoverage = 3 - blockingErrors.length;
  const confidence = Math.min(1, Math.max(0, (detected.score / 10) * 0.7 + (requiredCoverage / 3) * 0.3));
  if (blockingErrors.length > 0) {
    return {
      algorithm_version: PRODUCT_CATALOG_ALGORITHM_VERSION,
      status: "needs_review",
      sheet_name: sheet.name,
      sheet_index: detected.sheetIndex,
      header_row: detected.rowIndex + 1,
      confidence,
      header_mapping: headerMapping,
      blocking_errors: blockingErrors,
      warnings: [],
      summary: emptySummary,
      rows: [],
    };
  }

  const barcodeMap = new Map<string, CatalogRecognitionProduct[]>();
  const skuMap = new Map<string, CatalogRecognitionProduct[]>();
  const nameModelMap = new Map<string, CatalogRecognitionProduct[]>();
  for (const product of options.products) {
    const barcode = normalizeCatalogIdentifier(product.barcode);
    if (barcode) barcodeMap.set(barcode, [...(barcodeMap.get(barcode) ?? []), product]);
    if (product.company_id === options.companyId) {
      const sku = normalizeCatalogIdentifier(product.sku);
      if (sku) skuMap.set(sku, [...(skuMap.get(sku) ?? []), product]);
      const key = catalogProductMatchKey(product);
      nameModelMap.set(key, [...(nameModelMap.get(key) ?? []), product]);
    }
  }
  const accountByCode = new Map((options.revenueAccounts ?? []).map((account) => [normalizeCatalogIdentifier(account.code), account]));
  const rows: ProductCatalogRecognizedRow[] = [];
  const rawRows = sheet.rows.slice(detected.rowIndex + 1);
  rawRows.forEach((row, rowOffset) => {
    if (isBlankRow(row)) return;
    const raw: Record<string, string | number | boolean | null> = {};
    const value = (field: ProductCatalogField) => {
      const column = detected.columns.get(field);
      const cell = column === undefined ? null : row[column] ?? null;
      raw[field] = cell instanceof Date ? cell.toISOString() : cell;
      return cell;
    };
    const productName = cellText(value("product_name"));
    const sku = normalizeCatalogIdentifier(value("sku")) || null;
    const barcode = normalizeCatalogIdentifier(value("barcode")) || null;
    const model = cellText(value("model")) || null;
    const description = cellText(value("description")) || null;
    const unit = cellText(value("unit")) || "جهاز";
    const category = cellText(value("category")) || null;
    const plannedSalePrice = localizedNumber(value("planned_sale_price"));
    const defaultCost = localizedNumber(value("default_cost")) ?? 0;
    const commission = commissionType(value("commission_type"));
    const commissionAmount = localizedNumber(value("commission_value")) ?? 0;
    const revenueAccountCode = normalizeCatalogIdentifier(value("revenue_account_code")) || null;
    const account = revenueAccountCode ? accountByCode.get(revenueAccountCode) : null;
    const isActive = activeValue(value("is_active"));
    const notes = cellText(value("notes")) || null;
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const [field, rawValue] of Object.entries(raw)) {
      if (typeof rawValue === "string" && /^[=+@]/u.test(rawValue.trim())) {
        errors.push(`القيمة في ${field} تبدأ بعلامة صيغة غير مسموحة.`);
      }
    }
    if (productName.length < 2) errors.push("اسم المنتج مطلوب.");
    if (!sku && !barcode) errors.push("SKU أو الباركود مطلوب.");
    if (plannedSalePrice === null || plannedSalePrice < 0 || (isActive && plannedSalePrice <= 0)) errors.push("سعر البيع غير صالح.");
    if (defaultCost < 0) errors.push("التكلفة لا يمكن أن تكون أقل من صفر.");
    if (commission === "none" && commissionAmount !== 0) errors.push("قيمة العمولة تتطلب نوع عمولة.");
    if (commission === "percentage" && commissionAmount > 100) errors.push("نسبة العمولة لا يمكن أن تتجاوز 100٪.");
    if (revenueAccountCode && !account) errors.push("كود حساب الإيراد غير موجود أو غير نشط.");

    const barcodeMatches = barcode ? barcodeMap.get(barcode) ?? [] : [];
    const skuMatches = sku ? skuMap.get(sku) ?? [] : [];
    let classification: ProductCatalogRowClassification = "new";
    let matched: CatalogRecognitionProduct | null = null;
    if (barcodeMatches.some((product) => product.company_id !== options.companyId)) {
      classification = "identifier_conflict";
      errors.push("الباركود مرتبط بمنتج لدى مورد آخر.");
    } else if (barcodeMatches.length > 1 || skuMatches.length > 1) {
      classification = "identifier_conflict";
      errors.push("المعرف يطابق أكثر من منتج موجود.");
    } else if (barcodeMatches[0] && skuMatches[0] && barcodeMatches[0].id !== skuMatches[0].id) {
      classification = "identifier_conflict";
      errors.push("SKU والباركود يشيران إلى منتجين مختلفين.");
    } else {
      matched = barcodeMatches[0] || skuMatches[0] || null;
      if (!matched) {
        const suggestions = nameModelMap.get(catalogProductMatchKey({ name: productName, model })) ?? [];
        if (suggestions.length > 0) {
          classification = "ambiguous";
          warnings.push("يوجد منتج بنفس الاسم والموديل؛ راجع المعرفات قبل الإنشاء.");
          matched = suggestions.length === 1 ? suggestions[0]! : null;
        }
      }
    }
    const normalizedValues = {
      product_name: productName,
      sku,
      barcode,
      model,
      description,
      unit,
      category,
      planned_sale_price: plannedSalePrice,
      default_cost: defaultCost,
      commission_type: commission,
      commission_value: commissionAmount,
      revenue_account_code: revenueAccountCode,
      revenue_account_id: account?.id ?? null,
      is_active: isActive,
      notes,
    };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (matched && classification !== "identifier_conflict" && classification !== "ambiguous") {
      const comparisons: Array<[string, unknown, unknown]> = [
        ["name", matched.name, productName],
        ["sku", matched.sku, sku],
        ["barcode", matched.barcode, barcode],
        ["model", matched.model, model],
        ["description", matched.description, description],
        ["unit", matched.unit, unit],
        ["category", matched.category, category],
        ["price", Number(matched.price), plannedSalePrice],
        ["default_cost", Number(matched.default_cost || 0), defaultCost],
        ["agent_commission_type", matched.agent_commission_type || "none", commission],
        ["agent_commission_value", Number(matched.agent_commission_value || 0), commissionAmount],
        ["revenue_account_id", matched.revenue_account_id, account?.id ?? null],
        ["is_active", matched.is_active, isActive],
      ];
      for (const [field, before, after] of comparisons) {
        if (comparable(before) !== comparable(after)) changes[field] = { before, after };
      }
      classification = Object.keys(changes).length > 0 ? "existing_update" : "existing_unchanged";
    }
    if (errors.length > 0 && classification !== "identifier_conflict") classification = "invalid";
    rows.push({
      row_id: `${detected.sheetIndex + 1}:${detected.rowIndex + rowOffset + 2}`,
      source_sheet: sheet.name,
      source_row: detected.rowIndex + rowOffset + 2,
      raw_values: raw,
      normalized_values: normalizedValues,
      classification,
      errors,
      warnings,
      matched_product_id: matched?.id ?? null,
      matched_inventory_version: matched?.inventory_version ?? null,
      suggested_changes: changes,
    });
  });

  const skuCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.normalized_values.sku) skuCounts.set(row.normalized_values.sku, (skuCounts.get(row.normalized_values.sku) ?? 0) + 1);
    if (row.normalized_values.barcode) barcodeCounts.set(row.normalized_values.barcode, (barcodeCounts.get(row.normalized_values.barcode) ?? 0) + 1);
  }
  for (const row of rows) {
    const duplicateSku = row.normalized_values.sku && (skuCounts.get(row.normalized_values.sku) ?? 0) > 1;
    const duplicateBarcode = row.normalized_values.barcode && (barcodeCounts.get(row.normalized_values.barcode) ?? 0) > 1;
    if (duplicateSku || duplicateBarcode) {
      row.classification = "duplicate_in_file";
      row.errors.push("SKU أو الباركود مكرر داخل الملف.");
    }
  }
  const summary = { ...emptySummary, total: rows.length };
  for (const row of rows) summary[row.classification] += 1;
  return {
    algorithm_version: PRODUCT_CATALOG_ALGORITHM_VERSION,
    status: confidence >= 0.72 ? "ready" : "needs_review",
    sheet_name: sheet.name,
    sheet_index: detected.sheetIndex,
    header_row: detected.rowIndex + 1,
    confidence,
    header_mapping: headerMapping,
    blocking_errors: blockingErrors,
    warnings: confidence < 0.72 ? ["ثقة التعرف منخفضة؛ راجع الأعمدة قبل الحفظ."] : [],
    summary,
    rows,
  };
}
