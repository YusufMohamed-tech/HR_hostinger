import "server-only";

import { Buffer } from "node:buffer";
import { readSheet } from "read-excel-file/node";
import { parseCsvRows } from "@/lib/product-inventory/workbook";

export async function readProductInventoryWorkbook(
  bytes: Uint8Array,
  sourceType: "excel" | "csv"
) {
  if (sourceType === "csv") {
    return parseCsvRows(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  }
  return await readSheet(Buffer.from(bytes)) as unknown[][];
}
