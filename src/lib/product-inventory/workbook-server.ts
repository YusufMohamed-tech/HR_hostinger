import "server-only";

import { Buffer } from "node:buffer";
import readWorkbook, { readSheet } from "read-excel-file/node";
import {
  parseCsvRows,
  type ProductInventoryWorkbookCell,
} from "@/lib/product-inventory/workbook";
import type { ProductInventoryWorkbookSheet } from "@/lib/product-inventory/workbook-recognition";

export async function readProductInventoryWorkbookSheets(
  bytes: Uint8Array,
  sourceType: "excel" | "csv"
): Promise<ProductInventoryWorkbookSheet[]> {
  if (sourceType === "csv") {
    return [{
      name: "CSV",
      rows: parseCsvRows(new TextDecoder("utf-8", { fatal: false }).decode(bytes)),
    }];
  }
  const sheets = await readWorkbook(Buffer.from(bytes));
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data as ProductInventoryWorkbookCell[][],
  }));
}

export async function readProductInventoryWorkbook(
  bytes: Uint8Array,
  sourceType: "excel" | "csv"
) {
  if (sourceType === "csv") {
    return parseCsvRows(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  }
  return await readSheet(Buffer.from(bytes)) as ProductInventoryWorkbookCell[][];
}
