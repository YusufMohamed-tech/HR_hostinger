import {
  normalizeWorkbookHeader,
  PRODUCT_INVENTORY_WORKBOOK_HEADERS,
  type ProductInventoryWorkbookCell,
  type ProductInventoryWorkbookField,
} from "@/lib/product-inventory/workbook";
import type {
  ProductInventoryWorkbookRecognition,
  ProductInventoryWorkbookSheet,
} from "@/lib/product-inventory/workbook-recognition";

const FORWARD_FILL_FIELDS = new Set<ProductInventoryWorkbookField>([
  "supplier_code",
  "receipt_reference",
  "product_sku",
  "product_name",
  "model",
  "barcode",
  "unit_cost",
  "planned_sale_price",
  "minimum_sale_price",
  "maximum_sale_price",
  "commission_type",
  "commission_value",
  "commission_base",
  "currency",
  "tax_code",
  "condition",
]);

function text(value: ProductInventoryWorkbookCell) {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

function isRepeatedHeader(
  row: ProductInventoryWorkbookCell[],
  headers: ProductInventoryWorkbookCell[]
) {
  const populated = headers
    .map((header, index) => [normalizeWorkbookHeader(header), index] as const)
    .filter(([header]) => Boolean(header));
  return populated.length >= 3
    && populated.filter(([header, index]) => normalizeWorkbookHeader(row[index]) === header).length
      >= Math.min(3, populated.length);
}

function mappedColumns(
  recognition: ProductInventoryWorkbookRecognition,
  headers: ProductInventoryWorkbookCell[],
  approvedHeaderMapping?: Record<string, string>
) {
  const byField = new Map<ProductInventoryWorkbookField, number>();
  for (const proposal of recognition.field_proposals) {
    if (proposal.confidence >= 0.75) byField.set(proposal.field, proposal.column_index);
  }
  if (approvedHeaderMapping) {
    const approved = new Map(
      Object.entries(approvedHeaderMapping).map(([header, field]) => [normalizeWorkbookHeader(header), field])
    );
    headers.forEach((header, columnIndex) => {
      const field = approved.get(normalizeWorkbookHeader(header));
      if (PRODUCT_INVENTORY_WORKBOOK_HEADERS.includes(field as ProductInventoryWorkbookField)) {
        byField.set(field as ProductInventoryWorkbookField, columnIndex);
      }
    });
  }
  return byField;
}

export type ProductInventoryRecognizedSheet = {
  sheet: ProductInventoryWorkbookSheet;
  recognition: ProductInventoryWorkbookRecognition;
  approvedHeaderMapping?: Record<string, string>;
};

export function normalizeRecognizedProductInventorySheets(
  inputs: ProductInventoryRecognizedSheet[]
) {
  const headers: ProductInventoryWorkbookCell[] = [
    ...PRODUCT_INVENTORY_WORKBOOK_HEADERS,
    "__source_sheet",
    "__source_row",
  ];
  const normalizedRows: ProductInventoryWorkbookCell[][] = [headers];

  for (const { sheet, recognition, approvedHeaderMapping } of inputs) {
    const headerIndex = recognition.header_row - 1;
    const sourceHeaders = sheet.rows[headerIndex] ?? [];
    const columns = mappedColumns(recognition, sourceHeaders, approvedHeaderMapping);
    const detectedSerialColumns = recognition.serial_column_indexes.length > 0
      ? recognition.serial_column_indexes
      : columns.has("serial_number") ? [columns.get("serial_number")!] : [];
    const serialColumns = [...new Set(detectedSerialColumns)];
    const carried = new Map<ProductInventoryWorkbookField, ProductInventoryWorkbookCell>();

    for (let rowIndex = headerIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
      const sourceRow = sheet.rows[rowIndex] ?? [];
      if (sourceRow.every((value) => text(value) === "")) continue;
      if (isRepeatedHeader(sourceRow, sourceHeaders)) continue;

      if (recognition.shape === "continuation_rows") {
        for (const field of FORWARD_FILL_FIELDS) {
          const columnIndex = columns.get(field);
          if (columnIndex === undefined) continue;
          const value = sourceRow[columnIndex];
          if (text(value) !== "") carried.set(field, value);
        }
      }

      const serialValues = serialColumns
        .map((columnIndex) => sourceRow[columnIndex])
        .filter((value) => text(value) !== "");
      const expandedSerials = serialValues.length > 0 ? serialValues : [null];

      for (const serialValue of expandedSerials) {
        const canonical = PRODUCT_INVENTORY_WORKBOOK_HEADERS.map((field) => {
          if (field === "serial_number") return serialValue;
          const columnIndex = columns.get(field);
          const direct = columnIndex === undefined ? null : sourceRow[columnIndex] ?? null;
          if (recognition.shape === "continuation_rows" && text(direct) === "") {
            return carried.get(field) ?? direct;
          }
          return direct;
        });
        normalizedRows.push([...canonical, sheet.name, rowIndex + 1]);
      }
    }
  }

  return {
    rows: normalizedRows,
    headerMapping: Object.fromEntries(
      PRODUCT_INVENTORY_WORKBOOK_HEADERS.map((field) => [field, field])
    ) as Record<string, ProductInventoryWorkbookField>,
  };
}
