import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type {
  ProductInventoryStockRow,
  ProductInventoryWarehouse,
  ProductReturnApproval,
  ProductReturnAttachment,
  ProductReturnReceipt,
  ProductReturnReportRow,
  ProductReturnRequest,
  ProductReturnRequestLine,
  ProductReturnWorkspaceData,
} from "@/types/product-inventory";

type AdminClient = ReturnType<typeof createAdminClient>;

function fail(error: { message?: string; code?: string } | null) {
  if (error) {
    throw Object.assign(new Error(error.message || "Product return query failed."), { code: error.code });
  }
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []) as T[];
}

const eligibleUnitSelect = "id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, commission_type_snapshot, commission_value_snapshot, commission_base_snapshot, commercial_terms_revision_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, current_custodian_assignment_id, current_custodian_employee_id, current_project_id, current_location_id, current_city_snapshot, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en)";

export async function loadProductReturnWorkspace(
  admin: AdminClient,
  values: { orgId: string; userId: string; role: string }
): Promise<ProductReturnWorkspaceData> {
  const db = productInventoryDb(admin);
  const employeeResult = await db.from("employees")
    .select("id").eq("org_id", values.orgId).eq("user_id", values.userId)
    .ilike("status", "active").eq("lifecycle_status", "active").maybeSingle();
  fail(employeeResult.error);
  const employeeId = String(employeeResult.data?.id || "");

  const [settingsResult, warehousesResult, requestsResult, linesResult, attachmentsResult, approvalsResult, receiptsResult, unitsResult, reportResult] = await Promise.all([
    db.from("product_inventory_commerce_settings")
      .select("employee_custody_returns_enabled, return_approval_mode, require_return_photo, minimum_return_photos, maximum_return_photos")
      .eq("organization_id", values.orgId).maybeSingle(),
    db.from("inventory_warehouses")
      .select("id, code, name_ar, name_en, is_default")
      .eq("organization_id", values.orgId).eq("is_active", true)
      .order("is_default", { ascending: false }).order("name_ar"),
    db.from("product_return_requests").select("*")
      .eq("organization_id", values.orgId).order("submitted_at", { ascending: false }).limit(500),
    db.from("product_return_request_lines").select("*")
      .eq("organization_id", values.orgId).order("created_at").limit(5000),
    db.from("product_return_attachments")
      .select("id, return_request_id, return_line_id, original_name, detected_mime, size_bytes, sha256, evidence_type, captured_at, created_at")
      .eq("organization_id", values.orgId).order("created_at").limit(5000),
    db.from("product_return_approvals")
      .select("id, return_request_id, approver_type, assigned_approver_user_id, decision, decision_note, decided_by, decided_at, version")
      .eq("organization_id", values.orgId).order("created_at").limit(1000),
    db.from("product_return_receipts")
      .select("id, return_request_id, warehouse_id, received_by, received_at, notes, status")
      .eq("organization_id", values.orgId).order("received_at").limit(1000),
    employeeId
      ? db.from("product_inventory_units").select(eligibleUnitSelect)
        .eq("organization_id", values.orgId).eq("current_custodian_employee_id", employeeId)
        .eq("status", "with_custodian").is("active_return_request_line_id", null)
        .is("current_sale_id", null).order("assigned_at", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    db.rpc("get_product_inventory_return_report", {
      p_org_id: values.orgId,
      p_date_from: null,
      p_date_to: null,
    }),
  ]);
  [settingsResult, warehousesResult, requestsResult, linesResult, attachmentsResult, approvalsResult, receiptsResult, unitsResult, reportResult]
    .forEach((result) => fail(result.error));

  const approvals = rows<ProductReturnApproval>(approvalsResult.data);
  const visibleRequestIds = new Set(
    rows<ProductReturnRequest>(requestsResult.data)
      .filter((request) => (
        values.role === "admin"
        || values.role === "finance_manager"
        || request.requester_user_id === values.userId
        || approvals.some((approval) => (
          approval.return_request_id === request.id
          && approval.assigned_approver_user_id === values.userId
        ))
      ))
      .map((request) => request.id)
  );
  const attachments = rows<ProductReturnAttachment>(attachmentsResult.data);
  const lines = rows<ProductReturnRequestLine>(linesResult.data)
    .filter((line) => visibleRequestIds.has(line.return_request_id))
    .map((line) => ({
      ...line,
      attachments: attachments.filter((attachment) => attachment.return_line_id === line.id),
    }));
  const receipts = rows<ProductReturnReceipt>(receiptsResult.data);
  const requests = rows<ProductReturnRequest>(requestsResult.data)
    .filter((request) => visibleRequestIds.has(request.id))
    .map((request) => ({
      ...request,
      lines: lines.filter((line) => line.return_request_id === request.id),
      approvals: approvals.filter((approval) => approval.return_request_id === request.id).map((approval) => ({
        ...approval,
        is_assigned_to_me: approval.assigned_approver_user_id === values.userId,
      })),
      receipts: receipts.filter((receipt) => receipt.return_request_id === request.id),
      can_cancel: request.requester_user_id === values.userId && request.status === "pending_approval",
    }));
  const setting = settingsResult.data as ProductReturnWorkspaceData["settings"] | null;

  const returnsEnabled = setting?.employee_custody_returns_enabled ?? true;
  return {
    access: {
      role: values.role,
      can_submit: Boolean(employeeId) && returnsEnabled,
      can_review_finance: values.role === "admin" || values.role === "finance_manager",
      can_receive: values.role === "admin" || values.role === "finance_manager",
    },
    settings: setting ?? {
      employee_custody_returns_enabled: true,
      return_approval_mode: "both",
      require_return_photo: true,
      minimum_return_photos: 1,
      maximum_return_photos: 3,
    },
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    eligible_units: rows<ProductInventoryStockRow>(unitsResult.data),
    requests,
    report: rows<Record<string, unknown>>(reportResult.data).map((row) => ({
      ...row,
      total_requests: Number(row.total_requests || 0),
      pending_approval: Number(row.pending_approval || 0),
      awaiting_delivery: Number(row.awaiting_delivery || 0),
      received_requests: Number(row.received_requests || 0),
      rejected_requests: Number(row.rejected_requests || 0),
      cancelled_requests: Number(row.cancelled_requests || 0),
      total_units: Number(row.total_units || 0),
      received_sellable: Number(row.received_sellable || 0),
      received_quarantine: Number(row.received_quarantine || 0),
      received_damaged: Number(row.received_damaged || 0),
      average_approval_hours: row.average_approval_hours === null ? null : Number(row.average_approval_hours),
      average_delivery_hours: row.average_delivery_hours === null ? null : Number(row.average_delivery_hours),
    })) as ProductReturnReportRow[],
  };
}

export async function loadProductReturnAttachment(
  admin: AdminClient,
  values: { orgId: string; userId: string; role: string; requestId: string; attachmentId: string }
) {
  const db = productInventoryDb(admin);
  const attachmentResult = await db.from("product_return_attachments")
    .select("id, return_request_id, managed_file_id, original_name, detected_mime")
    .eq("organization_id", values.orgId).eq("return_request_id", values.requestId)
    .eq("id", values.attachmentId).maybeSingle();
  fail(attachmentResult.error);
  if (!attachmentResult.data) throw Object.assign(new Error("صورة المرتجع غير موجودة."), { code: "P0002" });
  const [requestResult, approvalResult, fileResult] = await Promise.all([
    db.from("product_return_requests").select("requester_user_id")
      .eq("organization_id", values.orgId).eq("id", attachmentResult.data.return_request_id).maybeSingle(),
    db.from("product_return_approvals").select("id")
      .eq("organization_id", values.orgId).eq("return_request_id", attachmentResult.data.return_request_id)
      .eq("assigned_approver_user_id", values.userId).limit(1),
    db.from("managed_files").select("bucket_id, storage_path, scan_status")
      .eq("org_id", values.orgId).eq("id", attachmentResult.data.managed_file_id).maybeSingle(),
  ]);
  [requestResult, approvalResult, fileResult].forEach((result) => fail(result.error));
  const allowed = values.role === "admin" || values.role === "finance_manager"
    || requestResult.data?.requester_user_id === values.userId
    || rows(approvalResult.data).length > 0;
  if (!allowed) throw Object.assign(new Error("لا تملك صلاحية عرض هذه الصورة."), { code: "42501" });
  if (!fileResult.data || fileResult.data.scan_status !== "clean") {
    throw Object.assign(new Error("ملف الإثبات غير متاح."), { code: "P0002" });
  }
  return {
    bucket: String(fileResult.data.bucket_id),
    path: String(fileResult.data.storage_path),
    name: String(attachmentResult.data.original_name),
    contentType: String(attachmentResult.data.detected_mime),
  };
}
