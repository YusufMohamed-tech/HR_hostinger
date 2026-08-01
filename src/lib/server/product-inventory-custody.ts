import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type {
  ProductEmployeeCustodyDashboardData,
  ProductEmployeeCustodyManagerData,
  ProductEmployeeCustodyReportRow,
  ProductHandover,
  ProductHandoverLine,
  ProductInventoryCustodianEmployee,
  ProductInventoryLocation,
  ProductInventoryOperationalAssignment,
  ProductInventoryProject,
  ProductInventoryStockRow,
  ProductInventoryWarehouse,
} from "@/types/product-inventory";

type AdminClient = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

function fail(error: { message?: string; code?: string } | null) {
  if (error) throw Object.assign(new Error(error.message || "Inventory custody query failed."), { code: error.code });
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []) as T[];
}

function joinAssignmentRelations(
  assignments: ProductInventoryOperationalAssignment[],
  employees: ProductInventoryCustodianEmployee[],
  projects: ProductInventoryProject[],
  locations: ProductInventoryLocation[]
) {
  return assignments.map((assignment) => ({
    ...assignment,
    employee: employees.find((employee) => employee.id === assignment.employee_id) ?? null,
    project: projects.find((project) => project.id === assignment.project_id) ?? null,
    location: locations.find((location) => location.id === assignment.location_id) ?? null,
  }));
}

function joinHandoverLines(handovers: ProductHandover[], lines: ProductHandoverLine[]) {
  return handovers.map((handover) => ({
    ...handover,
    lines: lines.filter((line) => line.handover_id === handover.id),
  }));
}

const unitSelect = "id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, commission_type_snapshot, commission_value_snapshot, commission_base_snapshot, commercial_terms_revision_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, current_custodian_assignment_id, current_custodian_employee_id, current_project_id, current_location_id, current_city_snapshot, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en)";
const handoverSelect = "id, handover_no, warehouse_id, agent_id, handover_type, recipient_assignment_id, recipient_employee_id, recipient_user_id_snapshot, recipient_name_snapshot, recipient_responsibility_snapshot, position_code_snapshot, project_id, project_name_snapshot, location_id, city_snapshot, status, require_acknowledgment, notes, issued_at, accepted_at, completed_at, version, warehouse:warehouse_id(id, code, name_ar, name_en, is_default)";
const handoverLineSelect = "id, handover_id, unit_id, product_id, planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price, commission_type_snapshot, commission_value_snapshot, commission_base_snapshot, commercial_terms_revision_snapshot, currency, tax_included, line_status, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, currency, current_custodian_employee_id, current_handover_id, assigned_at, created_at, product:product_id(name, sku, model))";

export async function loadProductEmployeeCustodyManagerData(
  admin: AdminClient,
  orgId: string
): Promise<ProductEmployeeCustodyManagerData> {
  const db = productInventoryDb(admin);
  const [
    assignmentsResult,
    employeesResult,
    projectsResult,
    locationsResult,
    warehousesResult,
    unitsResult,
    handoversResult,
    linesResult,
    reportResult,
  ] = await Promise.all([
    db.from("product_inventory_operational_assignments")
      .select("*").eq("organization_id", orgId)
      .order("status").order("created_at", { ascending: false }),
    db.from("employees")
      .select("id, user_id, employee_code, full_name, job_title, work_city")
      .eq("org_id", orgId).not("user_id", "is", null)
      .ilike("status", "active").eq("lifecycle_status", "active")
      .order("full_name"),
    db.from("sales_companies")
      .select("id, name, code").eq("organization_id", orgId)
      .eq("is_active", true).order("name"),
    db.from("locations")
      .select("id, name, city, project_id").eq("org_id", orgId).order("name"),
    db.from("inventory_warehouses")
      .select("id, code, name_ar, name_en, is_default")
      .eq("organization_id", orgId).eq("is_active", true)
      .order("is_default", { ascending: false }).order("name_ar"),
    db.from("product_inventory_units")
      .select(unitSelect).eq("organization_id", orgId).eq("status", "in_stock")
      .order("created_at", { ascending: false }).limit(1000),
    db.from("product_handovers")
      .select(handoverSelect).eq("organization_id", orgId)
      .eq("handover_type", "employee_custody")
      .order("issued_at", { ascending: false }).limit(500),
    db.from("product_handover_lines")
      .select(handoverLineSelect).eq("organization_id", orgId)
      .order("created_at", { ascending: false }).limit(5000),
    db.rpc("get_product_inventory_employee_custody_report", { p_org_id: orgId }),
  ]);
  [
    assignmentsResult, employeesResult, projectsResult, locationsResult,
    warehousesResult, unitsResult, handoversResult, linesResult, reportResult,
  ].forEach((result) => fail(result.error));

  const employees = rows<ProductInventoryCustodianEmployee>(employeesResult.data);
  const projects = rows<ProductInventoryProject>(projectsResult.data);
  const locations = rows<ProductInventoryLocation>(locationsResult.data);
  const assignments = joinAssignmentRelations(
    rows<ProductInventoryOperationalAssignment>(assignmentsResult.data),
    employees,
    projects,
    locations
  );
  const employeeHandovers = rows<ProductHandover>(handoversResult.data);
  const handoverIds = new Set(employeeHandovers.map((handover) => handover.id));
  const lines = rows<ProductHandoverLine>(linesResult.data).filter((line) => handoverIds.has(line.handover_id));
  const report = rows<Row>(reportResult.data).map((row) => ({
    ...row,
    received_units: Number(row.received_units || 0),
    ready_to_sell_units: Number(row.ready_to_sell_units || 0),
    return_pending_units: Number(row.return_pending_units || 0),
    awaiting_delivery_units: Number(row.awaiting_delivery_units || 0),
    physically_held_units: Number(row.physically_held_units || 0),
    sold_units: Number(row.sold_units || 0),
    returned_units: Number(row.returned_units || 0),
  })) as ProductEmployeeCustodyReportRow[];

  return {
    assignments,
    employees,
    projects,
    locations,
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    available_units: rows<ProductInventoryStockRow>(unitsResult.data),
    handovers: joinHandoverLines(employeeHandovers, lines),
    report,
  };
}

export async function loadProductEmployeeCustodyDashboard(
  admin: AdminClient,
  orgId: string,
  userId: string
): Promise<ProductEmployeeCustodyDashboardData> {
  const db = productInventoryDb(admin);
  const employeeResult = await db.from("employees")
    .select("id, user_id, employee_code, full_name, job_title, work_city")
    .eq("org_id", orgId).eq("user_id", userId)
    .ilike("status", "active").eq("lifecycle_status", "active").maybeSingle();
  fail(employeeResult.error);
  if (!employeeResult.data) {
    throw Object.assign(new Error("لا يوجد ملف موظف نشط مرتبط بهذا الحساب."), { code: "P0002" });
  }
  const employee = employeeResult.data as ProductInventoryCustodianEmployee;
  const [assignmentsResult, handoversResult, linesResult, unitsResult] = await Promise.all([
    db.from("product_inventory_operational_assignments")
      .select("*").eq("organization_id", orgId).eq("employee_id", employee.id)
      .order("created_at", { ascending: false }),
    db.from("product_handovers").select(handoverSelect)
      .eq("organization_id", orgId).eq("handover_type", "employee_custody")
      .eq("recipient_user_id_snapshot", userId)
      .order("issued_at", { ascending: false }).limit(250),
    db.from("product_handover_lines").select(handoverLineSelect)
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(3000),
    db.from("product_inventory_units").select(unitSelect)
      .eq("organization_id", orgId).eq("current_custodian_employee_id", employee.id)
      .in("status", ["in_transit", "with_custodian", "return_pending", "return_approved"])
      .order("assigned_at", { ascending: false }).limit(1000),
  ]);
  [assignmentsResult, handoversResult, linesResult, unitsResult].forEach((result) => fail(result.error));
  const handovers = rows<ProductHandover>(handoversResult.data);
  const handoverIds = new Set(handovers.map((handover) => handover.id));
  const lines = rows<ProductHandoverLine>(linesResult.data).filter((line) => handoverIds.has(line.handover_id));
  const hydrated = joinHandoverLines(handovers, lines);

  return {
    employee,
    assignments: rows<ProductInventoryOperationalAssignment>(assignmentsResult.data),
    pending_handovers: hydrated.filter((handover) => handover.status === "issued"),
    handovers: hydrated,
    units: rows<ProductInventoryStockRow>(unitsResult.data),
  };
}
