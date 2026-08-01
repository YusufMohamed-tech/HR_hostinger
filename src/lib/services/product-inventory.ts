import type {
  AgentProductCollection,
  AgentProductSale,
  ManualReceiptInput,
  ProductAgentDashboardData,
  ProductCommerceManagerData,
  ProductInventoryCompany,
  ProductInventoryProduct,
  ProductInventoryStockRow,
  ProductInventoryImportRow,
  ProductInventoryPhotoCandidate,
  ProductInventoryPhotoPreview,
  ProductInventoryAccountingPosting,
  ProductInventoryAccountingSettings,
  ProductAgentCommission,
  ProductInventoryWorkbookPreview,
  ProductInventoryWarehouse,
  ProductInventoryImportProfile,
  ProductInventoryCommercialTermInput,
  ProductReceipt,
} from "@/types/product-inventory";

type ApiResult<T> = { data: T | null; error: string | null };
export type ProductInventoryPagination = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

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

export function getProductReceipts(page = 1, pageSize = 20) {
  return apiFetch<{ rows: ProductReceipt[]; pagination: ProductInventoryPagination }>(
    `/api/sales/inventory/receipts?page=${page}&page_size=${pageSize}`
  );
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

export function getProductStock(page = 1, pageSize = 20) {
  return apiFetch<{
    rows: ProductInventoryStockRow[];
    totals: { units: number; cost: number; expectedSales: number; margin: number };
    pagination: ProductInventoryPagination;
  }>(
    `/api/sales/inventory/stock?page=${page}&page_size=${pageSize}`
  );
}

export function getFinanceProductInventory() {
  return apiFetch<{
    receipts: ProductReceipt[];
    inventory: ProductInventoryStockRow[];
    sales: AgentProductSale[];
    collections: AgentProductCollection[];
    losses: Array<Record<string, unknown>>;
    commissions: ProductAgentCommission[];
    postings: ProductInventoryAccountingPosting[];
    postingExceptions: ProductInventoryAccountingPosting[];
    settings: ProductInventoryAccountingSettings;
    totals: {
      units: number;
      cost: number;
      expectedSales: number;
      margin: number;
      salesRevenue: number;
      salesCost: number;
      grossProfit: number;
      vat: number;
      collected: number;
      outstanding: number;
      consignmentUnits: number;
      consignmentMemoCost: number;
      companyOwnedSalesRevenue: number;
      consignmentSalesRevenue: number;
      commission: number;
      commissionAccrued: number;
      commissionSettled: number;
      failedPostings: number;
      pendingPostings: number;
    };
    reconciliation: {
      stockUnits: number;
      stockCost: number;
      inventoryGlBalance: number;
      inventoryDifference: number;
      operationalAgentReceivable: number;
      agentReceivableGlBalance: number;
      agentReceivableDifference: number;
      consignmentUnits: number;
      consignmentMemoCost: number;
      consignmentSalesRevenue: number;
      collectionAllocationBlocked: boolean;
      balanced: boolean;
    };
  }>("/api/accounting/inventory");
}

export function getProductInventoryAccountingSettings() {
  return apiFetch<{
    settings: ProductInventoryAccountingSettings;
    accounts: Array<{
      id: string;
      code: string;
      name_ar: string;
      name_en: string | null;
      type: string;
      subtype: string | null;
      normal_balance: string;
      is_active: boolean;
    }>;
    can_manage: boolean;
  }>("/api/accounting/inventory/settings");
}

export function updateProductInventoryAccountingSettings(
  values: Partial<ProductInventoryAccountingSettings> & { expected_version: number }
) {
  return apiFetch<ProductInventoryAccountingSettings>("/api/accounting/inventory/settings", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export function retryProductInventoryAccounting(
  sourceType: "receipt" | "sale" | "collection" | "loss",
  sourceId: string
) {
  return apiFetch<Record<string, unknown>>(
    `/api/accounting/inventory/${sourceType}/${sourceId}/retry-posting`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function settleProductAgentCommission(
  commissionId: string,
  values: {
    command_id: string;
    payment_method: "cash" | "bank_transfer";
    payment_date: string;
    payment_reference?: string;
    finance_notes?: string;
    account_id?: string;
  }
) {
  return apiFetch<Record<string, unknown>>(
    `/api/accounting/inventory/commissions/${commissionId}/settle`,
    { method: "POST", body: JSON.stringify(values) }
  );
}

export function getProductCommerceManager(
  options: { page?: number; pageSize?: number; search?: string; warehouseId?: string } = {}
) {
  const params = new URLSearchParams({
    page: String(options.page || 1),
    page_size: String(options.pageSize || 200),
  });
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.warehouseId?.trim()) params.set("warehouse_id", options.warehouseId.trim());
  return apiFetch<ProductCommerceManagerData>(
    `/api/sales/inventory/handovers?${params.toString()}`
  );
}

export function createProductHandover(values: {
  handover_id: string;
  command_id: string;
  warehouse_id: string;
  agent_id: string;
  require_acknowledgment?: boolean;
  notes?: string;
  units: Array<{
    unit_id: string;
    minimum_sale_price?: number;
    maximum_sale_price?: number;
  }>;
}) {
  return apiFetch<Record<string, unknown>>("/api/sales/inventory/handovers", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function acceptProductHandover(handoverId: string, expectedVersion: number, commandId: string, signatureData: string) {
  return apiFetch<Record<string, unknown>>(`/api/sales/inventory/handovers/${handoverId}/accept`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, command_id: commandId, signature_data: signatureData }),
  });
}

export function returnAgentProducts(values: {
  return_id: string;
  command_id: string;
  warehouse_id: string;
  unit_ids: string[];
  reason: string;
}) {
  return apiFetch<Record<string, unknown>>("/api/sales/inventory/returns", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getProductAgentDashboard() {
  return apiFetch<ProductAgentDashboardData>("/api/sales/inventory/me/dashboard");
}

export function requestProductPriceOverride(values: {
  request_id: string;
  command_id: string;
  unit_id: string;
  requested_price: number;
  reason: string;
}) {
  return apiFetch<Record<string, unknown>>("/api/sales/inventory/price-overrides", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function reviewProductPriceOverride(
  requestId: string,
  values: {
    command_id: string;
    expected_version: number;
    decision: "approved" | "rejected";
    review_note?: string;
  }
) {
  return apiFetch<Record<string, unknown>>(`/api/sales/inventory/price-overrides/${requestId}/review`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function recordAgentProductSale(values: {
  sale_id: string;
  command_id: string;
  unit_id: string;
  actual_sale_price: number;
  sale_date: string;
  payment_method: "cash" | "bank_transfer" | "card" | "electronic" | "agent_credit";
  customer_name?: string;
  customer_phone?: string;
  customer_reference?: string;
  price_override_request_id?: string;
}) {
  return apiFetch<AgentProductSale>("/api/sales/inventory/agent-sales", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function voidAgentProductSale(
  saleId: string,
  values: {
    command_id: string;
    expected_version: number;
    reason: string;
    return_disposition: "sellable" | "damaged";
  }
) {
  return apiFetch<Record<string, unknown>>(`/api/sales/inventory/agent-sales/${saleId}/void`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function recordAgentProductCollection(values: {
  collection_id: string;
  command_id: string;
  agent_id: string;
  amount: number;
  payment_method: "cash" | "bank_transfer" | "card" | "electronic";
  reference?: string;
  collection_date: string;
  notes?: string;
}) {
  return apiFetch<AgentProductCollection>("/api/sales/inventory/agent-collections", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getProductInventoryMovements(page = 1, pageSize = 50) {
  return apiFetch<{
    rows: Array<Record<string, unknown>>;
    pagination: ProductInventoryPagination;
  }>(`/api/sales/inventory/movements?page=${page}&page_size=${pageSize}`);
}

export function recordProductInventoryLoss(values: {
  loss_id: string;
  command_id: string;
  unit_id: string;
  loss_type: "damage" | "loss";
  reason: string;
}) {
  return apiFetch<Record<string, unknown>>("/api/sales/inventory/losses", {
    method: "POST",
    body: JSON.stringify(values),
  });
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
    minimum_sale_price: row.minimum_sale_price,
    maximum_sale_price: row.maximum_sale_price,
    commission_type: row.commission_type,
    commission_value: row.commission_value,
    commission_base: row.commission_base,
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

export async function previewProductInventoryPhotos(
  receiptId: string,
  values: {
    command_id: string;
    supplier_company_id: string;
    warehouse_id: string;
    ownership_type: "purchased" | "consignment";
    receipt_date: string;
    currency: string;
    delivery_note_no?: string;
    supplier_invoice_no?: string;
    notes?: string;
    photos: Array<{
      file: File;
      source_id: string;
      managed_file_id: string;
      extraction: {
        raw_text: string;
        ocr_confidence: number | null;
        barcode_values: string[];
        bounding_boxes: Array<{
          text: string;
          confidence: number;
          x0: number;
          y0: number;
          x1: number;
          y1: number;
        }>;
        engine: string;
        version: string;
      };
    }>;
  }
): Promise<ApiResult<ProductInventoryPhotoPreview>> {
  try {
    const form = new FormData();
    const manifest = values.photos.map((photo, index) => {
      const field = `photo_${index}`;
      form.set(field, photo.file);
      return {
        field,
        source_id: photo.source_id,
        managed_file_id: photo.managed_file_id,
        extraction: photo.extraction,
      };
    });
    form.set("manifest", JSON.stringify(manifest));
    for (const [key, value] of Object.entries(values)) {
      if (key !== "photos") form.set(key, String(value ?? ""));
    }
    const response = await fetch(`/api/sales/inventory/receipts/${receiptId}/photo-preview`, {
      method: "POST",
      body: form,
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: ProductInventoryPhotoPreview;
      message?: string;
    };
    if (!response.ok) return { data: null, error: payload.message || "تعذر تحليل صور المنتجات." };
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر رفع صور المنتجات." };
  }
}

export function commitProductInventoryPhotos(
  receiptId: string,
  values: {
    expected_version: number;
    command_id: string;
    warnings_accepted: boolean;
    candidates: ProductInventoryPhotoCandidate[];
  }
) {
  return apiFetch<ProductReceipt>(`/api/sales/inventory/receipts/${receiptId}/photo-commit`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getProductInventoryCommercialTerms(receiptId: string) {
  return apiFetch<{
    receipt: Pick<ProductReceipt, "id" | "receipt_no" | "status" | "version" | "currency">;
    lines: NonNullable<ProductReceipt["lines"]>;
    history: Array<Record<string, unknown>>;
  }>(`/api/sales/inventory/receipts/${receiptId}/commercial-terms`);
}

export function updateProductInventoryCommercialTerms(
  receiptId: string,
  expectedVersion: number,
  terms: ProductInventoryCommercialTermInput[]
) {
  return apiFetch<{ receipt: ProductReceipt; terms: Array<Record<string, unknown>> }>(
    `/api/sales/inventory/receipts/${receiptId}/commercial-terms`,
    {
      method: "PATCH",
      body: JSON.stringify({ command_id: newInventoryCommandId(), expected_version: expectedVersion, terms }),
    }
  );
}

export function getProductInventoryImportProfiles() {
  return apiFetch<ProductInventoryImportProfile[]>("/api/sales/inventory/import-profiles");
}

export function createProductInventoryImportProfile(values: {
  profile_id: string;
  name: string;
  supplier_company_id?: string;
  sheet_name?: string;
  use_first_sheet: boolean;
  header_row: number;
  header_mapping: Record<string, string>;
  required_fields: string[];
  default_currency: string;
  default_condition: "new" | "open_box" | "refurbished";
  default_ownership_type: "purchased" | "consignment";
  is_active: boolean;
  sample_file_sha256?: string;
  approval_note?: string;
}) {
  return apiFetch<ProductInventoryImportProfile>("/api/sales/inventory/import-profiles", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function activateProductInventoryImportProfile(profileId: string) {
  return apiFetch<ProductInventoryImportProfile>(
    `/api/sales/inventory/import-profiles/${profileId}/activate`,
    { method: "POST", body: JSON.stringify({}) }
  );
}
