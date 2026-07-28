import type {
  ManualReceiptInput,
  ProductInventoryCompany,
  ProductInventoryProduct,
  ProductInventoryStockRow,
  ProductInventoryImportRow,
  ProductInventoryWorkbookPreview,
  ProductInventoryWarehouse,
  ProductReceipt,
} from "@/types/product-inventory";

type ApiResult<T> = { data: T | null; error: string | null };

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: T;
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      return { data: null, error: payload.message || payload.error || "تعذر تنفيذ طلب المخزون." };
    }
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

export function newInventoryCommandId() {
  return crypto.randomUUID();
}

export function getProductInventorySetup() {
  return apiFetch<{
    companies: ProductInventoryCompany[];
    warehouses: ProductInventoryWarehouse[];
    products: ProductInventoryProduct[];
  }>("/api/sales/inventory/setup");
}

export function getProductReceipts() {
  return apiFetch<ProductReceipt[]>("/api/sales/inventory/receipts");
}

export function getProductReceipt(receiptId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}`);
}

export function saveManualReceipt(input: ManualReceiptInput & { command_id: string }) {
  return apiFetch<ProductReceipt>("/api/sales/inventory/receipts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmProductReceipt(receiptId: string, expectedVersion: number, commandId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, command_id: commandId }),
  });
}

export function cancelProductReceipt(receiptId: string, expectedVersion: number, reason: string, commandId: string) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, reason, command_id: commandId }),
  });
}

export function getProductStock() {
  return apiFetch<{ rows: ProductInventoryStockRow[]; totals: { units: number; cost: number; expectedSales: number; margin: number } }>(
    "/api/sales/inventory/stock"
  );
}

export function getFinanceProductInventory() {
  return apiFetch<{
    receipts: ProductReceipt[];
    totals: { units: number; cost: number; expectedSales: number; margin: number };
  }>("/api/accounting/inventory");
}

export async function previewProductInventoryWorkbook(
  receiptId: string,
  file: File,
  values: {
    source_id: string;
    managed_file_id: string;
    command_id: string;
    supplier_company_id: string;
    warehouse_id: string;
    ownership_type: "purchased" | "consignment";
    receipt_date: string;
    currency: string;
    delivery_note_no?: string;
    supplier_invoice_no?: string;
    notes?: string;
  }
): Promise<ApiResult<ProductInventoryWorkbookPreview>> {
  try {
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(values)) form.set(key, String(value ?? ""));
    const response = await fetch(`/api/sales/inventory/receipts/${receiptId}/excel-preview`, {
      method: "POST",
      body: form,
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: ProductInventoryWorkbookPreview;
      message?: string;
    };
    if (!response.ok) return { data: null, error: payload.message || "تعذر تحليل الملف." };
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر رفع الملف." };
  }
}

export function commitProductInventoryWorkbook(
  receiptId: string,
  values: {
    source_id: string;
    expected_version: number;
    command_id: string;
    rows: ProductInventoryImportRow[];
  }
) {
  const rows = values.rows.map((row) => ({
    row_number: row.row_number,
    product_sku: row.product_sku,
    product_name: row.product_name,
    model: row.model,
    product_id: row.product_id,
    serial_number: row.serial_number,
    normalized_serial: row.normalized_serial,
    barcode: row.barcode,
    unit_cost: row.unit_cost,
    planned_sale_price: row.planned_sale_price,
    currency: row.currency,
    condition: row.condition,
    status: row.status,
    confidence: row.confidence,
    validation_errors: row.validation_errors,
    validation_warnings: row.validation_warnings,
  }));
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/excel-commit`, {
    method: "POST",
    body: JSON.stringify({ ...values, rows }),
  });
}

export async function openProductInventorySource(receiptId: string, sourceId: string) {
  const evidenceWindow = window.open("about:blank", "_blank");
  if (evidenceWindow) evidenceWindow.opener = null;
  const result = await apiFetch<{ signed_url: string; original_name: string }>(
    `/api/sales/inventory/receipts/${receiptId}/sources/${sourceId}`
  );
  if (result.data?.signed_url) {
    if (evidenceWindow) evidenceWindow.location.replace(result.data.signed_url);
    else window.location.assign(result.data.signed_url);
  } else {
    evidenceWindow?.close();
  }
  return result;
}
