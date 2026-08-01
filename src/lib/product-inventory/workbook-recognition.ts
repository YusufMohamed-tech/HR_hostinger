import { createHash } from "node:crypto";
import {
  normalizeProductMatchValue,
  normalizeWorkbookHeader,
  PRODUCT_INVENTORY_HEADER_ALIASES,
  PRODUCT_INVENTORY_WORKBOOK_HEADERS,
  type CatalogAlias,
  type ProductInventoryWorkbookCell,
  type ProductInventoryWorkbookField,
} from "@/lib/product-inventory/workbook";
import type { ProductInventoryProduct } from "@/types/product-inventory";

export const PRODUCT_INVENTORY_RECOGNITION_VERSION = "product-inventory-recognition-v1";

export type ProductInventoryWorkbookSheet = {
  name: string;
  rows: ProductInventoryWorkbookCell[][];
};

export type ProductInventoryWorkbookShape =
  | "row_per_device"
  | "continuation_rows"
  | "serial_columns";

export type ProductInventoryFieldRecognitionStatus =
  | "confirmed"
  | "needs_review"
  | "unrecognized";

export type ProductInventoryFieldProposal = {
  field: ProductInventoryWorkbookField;
  header: string;
  column_index: number;
  column_letter: string;
  confidence: number;
  status: ProductInventoryFieldRecognitionStatus;
  evidence: string[];
};

export type ProductInventorySheetScore = {
  sheet_name: string;
  sheet_index: number;
  header_row: number;
  confidence: number;
  data_rows: number;
  recognized_fields: number;
  required_coverage: number;
};

export type ProductInventoryWorkbookRecognition = {
  algorithm_version: string;
  status: "ready" | "needs_review";
  sheet_name: string;
  sheet_index: number;
  header_row: number;
  shape: ProductInventoryWorkbookShape;
  layout_fingerprint: string;
  confidence: number;
  headers: string[];
  header_mapping: Record<string, ProductInventoryWorkbookField>;
  field_proposals: ProductInventoryFieldProposal[];
  serial_column_indexes: number[];
  unrecognized_headers: Array<{ header: string; column_index: number; column_letter: string }>;
  compatible_sheets: string[];
  metadata: Record<string, string>;
  sample_rows: Array<{ row_number: number; values: ProductInventoryWorkbookCell[] }>;
  sheet_scores: ProductInventorySheetScore[];
  blocking_errors: string[];
  warnings: string[];
};

type RecognitionContext = {
  products?: ProductInventoryProduct[];
  aliases?: CatalogAlias[];
  approvedMappings?: Array<Record<string, string>>;
  requiredFields?: ProductInventoryWorkbookField[];
};

type ColumnCandidate = {
  field: ProductInventoryWorkbookField;
  columnIndex: number;
  header: string;
  confidence: number;
  lexical: number;
  data: number;
  evidence: string[];
};

type HeaderCandidate = {
  sheetIndex: number;
  sheetName: string;
  rowIndex: number;
  confidence: number;
  dataRows: number;
  proposals: ColumnCandidate[];
  serialColumns: number[];
  requiredCoverage: number;
};

const DEFAULT_REQUIRED_FIELDS: ProductInventoryWorkbookField[] = [
  "serial_number",
  "unit_cost",
  "planned_sale_price",
];
const PRODUCT_IDENTIFIER_FIELDS = new Set<ProductInventoryWorkbookField>([
  "product_sku",
  "product_name",
  "barcode",
]);
const MONEY_FIELDS = new Set<ProductInventoryWorkbookField>([
  "unit_cost",
  "planned_sale_price",
  "minimum_sale_price",
  "maximum_sale_price",
  "commission_value",
]);

const METADATA_ALIASES: Record<string, string[]> = {
  supplier_code: ["supplier code", "supplier", "كود المورد", "رمز المورد", "المورد"],
  receipt_reference: ["receipt reference", "reference", "مرجع الاستلام", "رقم الاستلام"],
  supplier_invoice_no: ["invoice number", "supplier invoice", "رقم الفاتورة", "فاتورة المورد"],
  delivery_note_no: ["delivery note", "delivery note number", "إذن التسليم", "رقم إذن التسليم"],
  receipt_date: ["receipt date", "delivery date", "تاريخ الاستلام", "تاريخ التسليم"],
  currency: ["currency", "currency code", "العملة"],
  warehouse: ["warehouse", "warehouse code", "المستودع", "كود المستودع"],
  ownership_type: ["ownership", "ownership type", "نوع الملكية"],
};

function text(value: ProductInventoryWorkbookCell) {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundConfidence(value: number) {
  return Number(clamp(value).toFixed(4));
}

function columnLetter(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function diceSimilarity(leftValue: string, rightValue: string) {
  const left = normalizeWorkbookHeader(leftValue);
  const right = normalizeWorkbookHeader(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const available = pairs.get(pair) ?? 0;
    if (available > 0) {
      overlap += 1;
      pairs.set(pair, available - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function profileFieldForHeader(
  header: string,
  approvedMappings: Array<Record<string, string>>
) {
  const normalized = normalizeWorkbookHeader(header);
  for (const mapping of approvedMappings) {
    for (const [knownHeader, field] of Object.entries(mapping)) {
      if (
        normalizeWorkbookHeader(knownHeader) === normalized
        && PRODUCT_INVENTORY_WORKBOOK_HEADERS.includes(field as ProductInventoryWorkbookField)
      ) {
        return field as ProductInventoryWorkbookField;
      }
    }
  }
  return null;
}

function lexicalScore(
  header: string,
  field: ProductInventoryWorkbookField,
  approvedMappings: Array<Record<string, string>>
) {
  const normalized = normalizeWorkbookHeader(header);
  if (!normalized) return { score: 0, evidence: "" };
  if (profileFieldForHeader(header, approvedMappings) === field) {
    return { score: 1, evidence: "Matches an approved organization profile" };
  }
  if (normalized === normalizeWorkbookHeader(field)) {
    return { score: 1, evidence: "Matches the canonical field name" };
  }
  const aliases = PRODUCT_INVENTORY_HEADER_ALIASES[field]
    .map((alias) => normalizeWorkbookHeader(alias));
  if (aliases.includes(normalized)) {
    return { score: 0.98, evidence: "Matches a supported Arabic/English header alias" };
  }
  const containedAlias = aliases
    .filter((alias) => alias.length >= 3 && (normalized.startsWith(alias) || normalized.endsWith(alias)))
    .sort((left, right) => right.length - left.length)[0];
  if (containedAlias) {
    return { score: 0.9, evidence: "Header contains a supported field alias" };
  }
  const similarity = Math.max(
    diceSimilarity(header, field),
    ...PRODUCT_INVENTORY_HEADER_ALIASES[field].map((alias) => diceSimilarity(header, alias))
  );
  if (similarity >= 0.84) {
    return {
      score: Math.min(0.88, 0.64 + similarity * 0.26),
      evidence: "Header is strongly similar to a supported field name",
    };
  }
  if (similarity >= 0.7) {
    return {
      score: 0.48 + similarity * 0.24,
      evidence: "Header is partially similar to a supported field name",
    };
  }
  return { score: 0, evidence: "" };
}

function nonEmptyValues(rows: ProductInventoryWorkbookCell[][], columnIndex: number) {
  return rows
    .map((row) => row[columnIndex])
    .filter((value) => text(value).length > 0)
    .slice(0, 50);
}

function ratio(values: ProductInventoryWorkbookCell[], predicate: (value: ProductInventoryWorkbookCell) => boolean) {
  if (values.length === 0) return 0;
  return values.filter(predicate).length / values.length;
}

function finiteNumber(value: ProductInventoryWorkbookCell) {
  if (value instanceof Date || typeof value === "boolean") return null;
  const parsed = Number(String(value ?? "").trim().replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function catalogMatchRatio(
  values: ProductInventoryWorkbookCell[],
  products: ProductInventoryProduct[],
  key: "sku" | "barcode" | "name" | "model"
) {
  const catalog = new Set(
    products.map((product) => normalizeProductMatchValue(product[key])).filter(Boolean)
  );
  if (catalog.size === 0 || values.length === 0) return 0;
  return ratio(values, (value) => catalog.has(normalizeProductMatchValue(value)));
}

function dataScore(
  field: ProductInventoryWorkbookField,
  values: ProductInventoryWorkbookCell[],
  products: ProductInventoryProduct[],
  aliases: CatalogAlias[]
) {
  if (values.length === 0) return { score: 0, evidence: "" };
  const numericRatio = ratio(values, (value) => finiteNumber(value) !== null);
  const stringRatio = ratio(values, (value) => typeof value === "string");
  const normalized = values.map(normalizeProductMatchValue).filter(Boolean);
  const uniqueness = normalized.length === 0 ? 0 : new Set(normalized).size / normalized.length;
  const identifierRatio = ratio(values, (value) => /^[\p{L}\p{N}._\-/ ]{2,160}$/u.test(text(value)));
  const digitRatio = ratio(values, (value) => /^\d{8,18}$/u.test(text(value).replaceAll(/\s+/gu, "")));
  const numbers = values.map(finiteNumber).filter((value): value is number => value !== null);

  if (field === "serial_number") {
    const score = clamp(uniqueness * 0.5 + identifierRatio * 0.35 + stringRatio * 0.15);
    return { score, evidence: "Values are unique device-like identifiers" };
  }
  if (field === "barcode") {
    const catalog = catalogMatchRatio(values, products, "barcode");
    return {
      score: clamp(catalog * 0.75 + digitRatio * 0.25),
      evidence: catalog > 0 ? "Values match catalog barcodes" : "Values look like barcodes",
    };
  }
  if (field === "product_sku") {
    const catalog = catalogMatchRatio(values, products, "sku");
    return {
      score: clamp(catalog * 0.8 + (1 - uniqueness) * identifierRatio * 0.2),
      evidence: catalog > 0 ? "Values match catalog SKUs" : "Values look like repeated product codes",
    };
  }
  if (field === "product_name") {
    const catalog = catalogMatchRatio(values, products, "name");
    const aliasSet = new Set(aliases.map((alias) => alias.normalized_value));
    const aliasRatio = normalized.length === 0
      ? 0
      : normalized.filter((value) => aliasSet.has(value)).length / normalized.length;
    return {
      score: clamp(catalog * 0.75 + aliasRatio * 0.2 + stringRatio * 0.05),
      evidence: catalog > 0 || aliasRatio > 0 ? "Values match product names or approved aliases" : "Values are text",
    };
  }
  if (field === "model") {
    const catalog = catalogMatchRatio(values, products, "model");
    return {
      score: clamp(catalog * 0.85 + (1 - uniqueness) * identifierRatio * 0.15),
      evidence: catalog > 0 ? "Values match catalog models" : "Values look like model identifiers",
    };
  }
  if (MONEY_FIELDS.has(field)) {
    let score = numericRatio * 0.82;
    if (numbers.some((value) => value < 0)) score *= 0.4;
    if (field === "commission_value" && numbers.every((value) => value >= 0 && value <= 100)) {
      score += 0.08;
    }
    return { score: clamp(score), evidence: "Values are non-negative monetary numbers" };
  }
  if (field === "commission_type") {
    const allowed = new Set(["flat", "fixed", "percentage", "percent", "pct", "none", "ثابت", "مبلغ", "نسبة", "بدون"]);
    return {
      score: ratio(values, (value) => allowed.has(text(value).toLowerCase())) * 0.98,
      evidence: "Values use supported commission categories",
    };
  }
  if (field === "commission_base") {
    const allowed = new Set(["gross", "net", "grossamount", "netamount", "الإجمالي", "الصافي"]);
    return {
      score: ratio(values, (value) => allowed.has(normalizeWorkbookHeader(value))) * 0.98,
      evidence: "Values use supported net/gross commission bases",
    };
  }
  if (field === "currency") {
    return {
      score: ratio(values, (value) => /^[A-Za-z]{3}$/u.test(text(value))) * 0.98,
      evidence: "Values use three-letter currency codes",
    };
  }
  if (field === "condition") {
    const allowed = new Set(["new", "openbox", "opened", "refurbished", "renewed", "جديد", "مفتوح", "مجدد"]);
    return {
      score: ratio(values, (value) => allowed.has(normalizeWorkbookHeader(value))) * 0.95,
      evidence: "Values use supported device-condition categories",
    };
  }
  if (field === "supplier_code" || field === "receipt_reference" || field === "tax_code") {
    return { score: identifierRatio * 0.55, evidence: "Values look like business reference identifiers" };
  }
  if (field === "notes") {
    const longTextRatio = ratio(values, (value) => text(value).length >= 8);
    return { score: longTextRatio * 0.45, evidence: "Values look like free-text notes" };
  }
  return { score: 0, evidence: "" };
}

function buildColumnCandidates(
  headers: ProductInventoryWorkbookCell[],
  dataRows: ProductInventoryWorkbookCell[][],
  context: RecognitionContext
) {
  const products = context.products ?? [];
  const aliases = context.aliases ?? [];
  const approvedMappings = context.approvedMappings ?? [];
  const candidates: ColumnCandidate[] = [];
  headers.forEach((rawHeader, columnIndex) => {
    const header = text(rawHeader);
    if (!header) return;
    const values = nonEmptyValues(dataRows, columnIndex);
    for (const field of PRODUCT_INVENTORY_WORKBOOK_HEADERS) {
      const lexical = lexicalScore(header, field, approvedMappings);
      const data = dataScore(field, values, products, aliases);
      let confidence = lexical.score > 0
        ? lexical.score * 0.78 + data.score * 0.22
        : data.score * 0.68;
      if (lexical.score >= 0.98 && values.length >= 1) confidence = Math.max(confidence, 0.93);
      if (field === "serial_number" && typeof values[0] === "number") confidence = Math.min(confidence, 0.86);
      if (confidence < 0.45) continue;
      const evidence = [lexical.evidence, data.evidence].filter(Boolean);
      candidates.push({
        field,
        columnIndex,
        header,
        confidence: roundConfidence(confidence),
        lexical: lexical.score,
        data: data.score,
        evidence,
      });
    }
  });
  return candidates;
}

function selectOneToOneCandidates(candidates: ColumnCandidate[]) {
  const assignedFields = new Set<ProductInventoryWorkbookField>();
  const assignedColumns = new Set<number>();
  const selected: ColumnCandidate[] = [];
  const requiredPriority = new Set<ProductInventoryWorkbookField>([
    "serial_number", "product_sku", "product_name", "barcode", "unit_cost", "planned_sale_price",
  ]);
  const ordered = [...candidates].sort((left, right) => {
    const confidence = right.confidence - left.confidence;
    if (Math.abs(confidence) > 0.0001) return confidence;
    return Number(requiredPriority.has(right.field)) - Number(requiredPriority.has(left.field));
  });
  for (const candidate of ordered) {
    if (candidate.confidence < 0.55) continue;
    if (assignedFields.has(candidate.field) || assignedColumns.has(candidate.columnIndex)) continue;
    assignedFields.add(candidate.field);
    assignedColumns.add(candidate.columnIndex);
    selected.push(candidate);
  }
  return selected.sort((left, right) => left.columnIndex - right.columnIndex);
}

function dataRowsBelow(rows: ProductInventoryWorkbookCell[][], rowIndex: number) {
  return rows.slice(rowIndex + 1, rowIndex + 51)
    .filter((row) => row.some((value) => text(value).length > 0));
}

function requiredCoverage(proposals: ColumnCandidate[], requiredFields: ProductInventoryWorkbookField[]) {
  const confidentFields = new Set(
    proposals.filter((proposal) => proposal.confidence >= 0.75).map((proposal) => proposal.field)
  );
  const direct = requiredFields.filter((field) => confidentFields.has(field)).length;
  const productIdentifier = proposals.some(
    (proposal) => PRODUCT_IDENTIFIER_FIELDS.has(proposal.field) && proposal.confidence >= 0.75
  );
  return (direct + Number(productIdentifier)) / (requiredFields.length + 1);
}

function evaluateHeaderCandidate(
  sheet: ProductInventoryWorkbookSheet,
  sheetIndex: number,
  rowIndex: number,
  context: RecognitionContext
): HeaderCandidate {
  const headers = sheet.rows[rowIndex] ?? [];
  const dataRows = dataRowsBelow(sheet.rows, rowIndex);
  const candidates = buildColumnCandidates(headers, dataRows, context);
  const proposals = selectOneToOneCandidates(candidates);
  const requiredFields = context.requiredFields ?? DEFAULT_REQUIRED_FIELDS;
  const coverage = requiredCoverage(proposals, requiredFields);
  const recognized = proposals.filter((proposal) => proposal.confidence >= 0.75);
  const average = recognized.length === 0
    ? 0
    : recognized.reduce((sum, proposal) => sum + proposal.confidence, 0) / recognized.length;
  const nonEmptyHeaderCount = headers.filter((value) => text(value).length > 0).length;
  const headerUsefulness = nonEmptyHeaderCount === 0
    ? 0
    : Math.min(1, recognized.length / Math.min(nonEmptyHeaderCount, 8));
  const rowEvidence = Math.min(1, dataRows.length / 5);
  const serialColumns = candidates
    .filter((candidate) => candidate.field === "serial_number" && candidate.confidence >= 0.72)
    .sort((left, right) => right.confidence - left.confidence)
    .map((candidate) => candidate.columnIndex);
  const confidence = roundConfidence(
    coverage * 0.43 + average * 0.29 + headerUsefulness * 0.18 + rowEvidence * 0.1
  );
  return {
    sheetIndex,
    sheetName: sheet.name,
    rowIndex,
    confidence,
    dataRows: dataRows.length,
    proposals,
    serialColumns: [...new Set(serialColumns)],
    requiredCoverage: roundConfidence(coverage),
  };
}

function bestHeaderForSheet(
  sheet: ProductInventoryWorkbookSheet,
  sheetIndex: number,
  context: RecognitionContext
) {
  const candidates = sheet.rows
    .slice(0, 100)
    .map((_, rowIndex) => evaluateHeaderCandidate(sheet, sheetIndex, rowIndex, context))
    .sort((left, right) => right.confidence - left.confidence || left.rowIndex - right.rowIndex);
  return candidates[0] ?? evaluateHeaderCandidate(sheet, sheetIndex, 0, context);
}

function proposalStatus(confidence: number): ProductInventoryFieldRecognitionStatus {
  if (confidence >= 0.92) return "confirmed";
  if (confidence >= 0.75) return "needs_review";
  return "unrecognized";
}

function detectShape(
  rows: ProductInventoryWorkbookCell[][],
  headerRowIndex: number,
  proposals: ColumnCandidate[],
  serialColumns: number[]
): ProductInventoryWorkbookShape {
  if (serialColumns.length > 1) return "serial_columns";
  const serialColumn = proposals.find((proposal) => proposal.field === "serial_number")?.columnIndex;
  const productColumns = proposals
    .filter((proposal) => PRODUCT_IDENTIFIER_FIELDS.has(proposal.field))
    .map((proposal) => proposal.columnIndex);
  if (serialColumn === undefined || productColumns.length === 0) return "row_per_device";
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 101)
    .filter((row) => text(row[serialColumn]).length > 0);
  if (dataRows.length < 2) return "row_per_device";
  const continuationRatio = dataRows.filter(
    (row) => productColumns.every((columnIndex) => text(row[columnIndex]).length === 0)
  ).length / dataRows.length;
  return continuationRatio >= 0.2 ? "continuation_rows" : "row_per_device";
}

function detectMetadata(rows: ProductInventoryWorkbookCell[][], headerRowIndex: number) {
  const metadata: Record<string, string> = {};
  const aliases = Object.fromEntries(
    Object.entries(METADATA_ALIASES).map(([field, values]) => [
      field,
      new Set(values.map(normalizeWorkbookHeader)),
    ])
  ) as Record<string, Set<string>>;
  for (const row of rows.slice(0, Math.min(headerRowIndex + 1, 100))) {
    for (let index = 0; index < row.length; index += 1) {
      const label = normalizeWorkbookHeader(row[index]);
      if (!label) continue;
      const nextValue = text(row[index + 1]);
      if (!nextValue) continue;
      for (const [field, supported] of Object.entries(aliases)) {
        if (!metadata[field] && supported.has(label)) metadata[field] = nextValue;
      }
    }
  }
  return metadata;
}

function layoutFingerprint(
  headers: string[],
  proposals: ColumnCandidate[],
  shape: ProductInventoryWorkbookShape,
  serialColumns: number[]
) {
  const canonical = JSON.stringify({
    version: PRODUCT_INVENTORY_RECOGNITION_VERSION,
    shape,
    headers: headers.map(normalizeWorkbookHeader),
    mapping: proposals
      .filter((proposal) => proposal.confidence >= 0.75)
      .map((proposal) => [proposal.columnIndex, proposal.field]),
    serialColumns,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function blockingState(
  selected: HeaderCandidate,
  sheetAmbiguous: boolean,
  requiredFields: ProductInventoryWorkbookField[]
) {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const proposals = selected.proposals;
  const proposalByField = new Map(proposals.map((proposal) => [proposal.field, proposal]));
  if (sheetAmbiguous) warnings.push("More than one worksheet has a similar inventory-table score; confirm the intended sheet.");
  for (const field of requiredFields) {
    const proposal = proposalByField.get(field);
    if (!proposal || proposal.confidence < 0.75) {
      blockingErrors.push(`Required field ${field} could not be recognized safely.`);
    } else if (proposal.confidence < 0.92) {
      warnings.push(`Confirm the proposed ${field} column.`);
    }
  }
  const productProposal = proposals
    .filter((proposal) => PRODUCT_IDENTIFIER_FIELDS.has(proposal.field))
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (!productProposal || productProposal.confidence < 0.75) {
    blockingErrors.push("A product SKU, barcode, or product-name column is required.");
  } else if (productProposal.confidence < 0.92) {
    warnings.push(`Confirm the proposed ${productProposal.field} product column.`);
  }
  if (selected.dataRows === 0) blockingErrors.push("The detected table has no data rows.");
  return { blockingErrors, warnings };
}

export function recognizeProductInventoryWorkbook(
  sheets: ProductInventoryWorkbookSheet[],
  context: RecognitionContext = {}
): ProductInventoryWorkbookRecognition {
  if (sheets.length === 0 || sheets.every((sheet) => sheet.rows.length === 0)) {
    throw new Error("Workbook is empty.");
  }
  const scored = sheets
    .map((sheet, sheetIndex) => bestHeaderForSheet(sheet, sheetIndex, context))
    .sort((left, right) => right.confidence - left.confidence || left.sheetIndex - right.sheetIndex);
  const selected = scored[0];
  if (!selected) throw new Error("Workbook has no readable worksheets.");
  const runnerUp = scored[1];
  const sheetAmbiguous = Boolean(
    runnerUp
      && runnerUp.confidence >= 0.68
      && selected.confidence - runnerUp.confidence < 0.08
  );
  const sheet = sheets[selected.sheetIndex]!;
  const rawHeaders = sheet.rows[selected.rowIndex] ?? [];
  const headers = rawHeaders.map(text);
  const shape = detectShape(sheet.rows, selected.rowIndex, selected.proposals, selected.serialColumns);
  const requiredFields = context.requiredFields ?? DEFAULT_REQUIRED_FIELDS;
  const { blockingErrors, warnings } = blockingState(selected, sheetAmbiguous, requiredFields);
  const fieldProposals = selected.proposals.map<ProductInventoryFieldProposal>((proposal) => ({
    field: proposal.field,
    header: proposal.header,
    column_index: proposal.columnIndex,
    column_letter: columnLetter(proposal.columnIndex),
    confidence: proposal.confidence,
    status: proposalStatus(proposal.confidence),
    evidence: proposal.evidence,
  }));
  const mappedColumns = new Set(selected.proposals.map((proposal) => proposal.columnIndex));
  const headerMapping = Object.fromEntries(
    selected.proposals
      .filter((proposal) => proposal.confidence >= 0.75)
      .map((proposal) => [proposal.header, proposal.field])
  ) as Record<string, ProductInventoryWorkbookField>;
  const requiredProposals = selected.proposals.filter(
    (proposal) => requiredFields.includes(proposal.field) || PRODUCT_IDENTIFIER_FIELDS.has(proposal.field)
  );
  const overallConfidence = requiredProposals.length === 0
    ? selected.confidence
    : Math.min(selected.confidence, ...requiredProposals.map((proposal) => proposal.confidence));
  const allRequiredConfirmed = blockingErrors.length === 0
    && requiredFields.every((field) => selected.proposals.some(
      (proposal) => proposal.field === field && proposal.confidence >= 0.92
    ))
    && selected.proposals.some(
      (proposal) => PRODUCT_IDENTIFIER_FIELDS.has(proposal.field) && proposal.confidence >= 0.92
    )
    && !sheetAmbiguous;
  const sampleRows = sheet.rows
    .slice(selected.rowIndex + 1)
    .map((values, offset) => ({ row_number: selected.rowIndex + offset + 2, values }))
    .filter((row) => row.values.some((value) => text(value).length > 0))
    .slice(0, 20);
  const compatibleSheets = scored
    .filter((candidate) => candidate.confidence >= 0.72)
    .filter((candidate) => {
      const candidateFields = new Set(
        candidate.proposals.filter((proposal) => proposal.confidence >= 0.75).map((proposal) => proposal.field)
      );
      return selected.proposals
        .filter((proposal) => proposal.confidence >= 0.75)
        .every((proposal) => candidateFields.has(proposal.field));
    })
    .map((candidate) => candidate.sheetName);
  return {
    algorithm_version: PRODUCT_INVENTORY_RECOGNITION_VERSION,
    status: allRequiredConfirmed ? "ready" : "needs_review",
    sheet_name: selected.sheetName,
    sheet_index: selected.sheetIndex,
    header_row: selected.rowIndex + 1,
    shape,
    layout_fingerprint: layoutFingerprint(headers, selected.proposals, shape, selected.serialColumns),
    confidence: roundConfidence(overallConfidence),
    headers,
    header_mapping: headerMapping,
    field_proposals: fieldProposals,
    serial_column_indexes: selected.serialColumns,
    unrecognized_headers: headers
      .map((header, columnIndex) => ({ header, column_index: columnIndex, column_letter: columnLetter(columnIndex) }))
      .filter((column) => column.header && !mappedColumns.has(column.column_index)),
    compatible_sheets: compatibleSheets,
    metadata: detectMetadata(sheet.rows, selected.rowIndex),
    sample_rows: sampleRows,
    sheet_scores: scored.map((candidate) => ({
      sheet_name: candidate.sheetName,
      sheet_index: candidate.sheetIndex,
      header_row: candidate.rowIndex + 1,
      confidence: candidate.confidence,
      data_rows: candidate.dataRows,
      recognized_fields: candidate.proposals.filter((proposal) => proposal.confidence >= 0.75).length,
      required_coverage: candidate.requiredCoverage,
    })),
    blocking_errors: blockingErrors,
    warnings,
  };
}
