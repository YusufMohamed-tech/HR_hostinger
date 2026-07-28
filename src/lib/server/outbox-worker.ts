import "server-only";

import { z } from "zod";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  failOutboxEvent,
} from "@/lib/server/business-events";
import {
  autoCapitalizeAsset,
  autoPostPayrollMonth,
  autoPostSalesCashCollection,
  autoPostSalesLogRevision,
  autoPostSimSale,
  autoReverseSalesLogRevision,
  autoReverseSimSale,
} from "@/lib/accounting/auto-posting";
import {
  autoPostProductCollection,
  autoPostProductInventoryLoss,
  autoPostProductReceipt,
  autoPostProductSale,
  autoReverseProductSale,
} from "@/lib/accounting/product-inventory-posting";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

type OutboxEvent = Database["public"]["Tables"]["event_outbox"]["Row"];
type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const notificationPayload = z.object({
  userId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000).optional().nullable(),
  type: z.enum(["attendance", "task", "leave", "system", "sales", "accounting", "recruitment", "lms"]).default("system"),
  link: z.string().max(1000).optional().nullable(),
});

const employeeEventPayload = z.object({
  employee_id: z.string().uuid(),
  event_type: z.string().optional(),
  changed_fields: z.array(z.string()).optional(),
  effective_date: z.string().optional(),
});

const attendanceLocationMissingPayload = z.object({
  employee_id: z.string().uuid(),
  employee_name: z.string().min(1),
  employee_code: z.string().nullable().optional(),
  actor_user_id: z.string().uuid(),
  action: z.enum(["check_in", "check_out"]),
  business_date: z.string(),
  version: z.coerce.number().int().positive(),
});

const identityAuthSyncPayload = z.object({
  job_id: z.string().uuid(),
  action: z.enum(["ban", "unban", "delete"]),
  target_user_id: z.string().uuid(),
  source_type: z.string().min(1),
  source_id: z.string().min(1),
  reason: z.string().nullable().optional(),
  version: z.coerce.number().int().positive(),
});

const payrollEventPayload = z.object({
  payroll_run_id: z.string().uuid(),
  month: z.string(),
});

const accountingJournalEventPayload = z.object({
  journal_entry_id: z.string().uuid(),
  entry_no: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(["pending_approval", "posted", "reversed"]),
  source_module: z.string().min(1),
  source_id: z.string().uuid().optional(),
  total_debit: z.coerce.number().nonnegative(),
  total_credit: z.coerce.number().nonnegative(),
  version: z.coerce.number().int().nonnegative(),
  reversal_entry_id: z.string().uuid().optional(),
});

const accountingCustomerEventPayload = z.object({
  customer_id: z.string().uuid(),
  customer_name: z.string().min(1),
  sales_company_id: z.string().uuid().nullable(),
  prior_sales_company_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  version: z.coerce.number().int().nonnegative(),
});

const accountingRecordEventPayload = z.object({
  table_name: z.enum([
    "accounting_expenses", "accounting_invoices", "accounting_payments",
    "accounting_periods", "accounting_settings", "accounting_accounts",
    "accounting_cost_centers", "accounting_vendors", "accounting_journal_entries",
  ]),
  record_id: z.string().uuid(),
  operation: z.enum(["insert", "update"]),
  change: z.string().min(1),
  status: z.string().nullable().optional(),
  prior_status: z.string().nullable().optional(),
  paid_status: z.string().nullable().optional(),
  record_type: z.string().nullable().optional(),
  number: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  invoice_id: z.string().uuid().nullable().optional(),
  expense_id: z.string().uuid().nullable().optional(),
  payroll_id: z.string().uuid().nullable().optional(),
  source_module: z.string().nullable().optional(),
  version: z.coerce.number().int().positive(),
});

const advanceEventPayload = z.object({
  advance_request_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  requested_amount: z.coerce.number().optional(),
  approved_amount: z.coerce.number().nullable().optional(),
  amount: z.coerce.number().optional(),
});

const simSaleEventPayload = z.object({
  sale_id: z.string().uuid(),
  sim_unit_id: z.string().uuid(),
  seller_type: z.enum(["agent", "merchant"]),
  sale_price: z.coerce.number(),
  commission_accrual: z.coerce.number().optional(),
  commission_reversal: z.coerce.number().optional(),
  reason: z.string().optional().nullable(),
});

const commissionSettlementPayload = z.object({
  settlement_batch_id: z.string().uuid(),
  beneficiary_type: z.enum(["agent", "merchant"]),
  commission_count: z.coerce.number(),
  total_amount: z.coerce.number(),
});

const salesLogEventPayload = z.object({
  sales_log_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  previous_revision_id: z.string().uuid().optional(),
  revision_number: z.coerce.number().int().positive(),
  grand_total: z.coerce.number(),
  sales_agent_id: z.string().uuid(),
  log_date: z.string(),
  reason: z.string().optional().nullable(),
});

const salesLogEditEventPayload = z.object({
  edit_request_id: z.string().uuid(),
  sales_log_id: z.string().uuid(),
  company_id: z.string().uuid().nullable().optional(),
  sales_agent_id: z.string().uuid(),
  requested_changes: z.string().optional(),
  resolution_status: z.enum(["applied", "rejected"]).optional(),
  resolution_note: z.string().nullable().optional(),
  log_date: z.string(),
  grand_total: z.coerce.number().nonnegative(),
});

const salesShiftPromptEventPayload = z.object({
  prompt_id: z.string().uuid(),
  prompt_type: z.enum(["mid_shift", "end_shift"]),
  company_id: z.string().uuid(),
  company_name: z.string().min(1),
  sales_agent_id: z.string().uuid(),
  agent_name: z.string().min(1),
  prompt_date: z.string(),
  target_amount: z.coerce.number().nonnegative(),
  achieved_amount: z.coerce.number().nonnegative(),
  version: z.coerce.number().int().positive(),
});

const salesShiftReasonEventPayload = z.object({
  prompt_id: z.string().uuid(),
  company_id: z.string().uuid(),
  sales_agent_id: z.string().uuid(),
  prompt_date: z.string(),
  reason: z.string().trim().min(5),
  target_amount: z.coerce.number().nonnegative(),
  achieved_amount: z.coerce.number().nonnegative(),
  version: z.coerce.number().int().positive(),
});

const promoterLeadEventPayload = z.object({
  lead_id: z.string().uuid(),
  full_name: z.string().min(1),
  status: z.string().min(1),
  assigned_agent_id: z.string().uuid().nullable(),
  previous_assigned_agent_id: z.string().uuid().nullable(),
  assigned_agent_changed: z.boolean(),
  version: z.coerce.number().int().nonnegative(),
});

const recruitmentEventPayload = z.object({
  application_id: z.string().uuid(),
  job_posting_id: z.string().uuid(),
  candidate_user_id: z.string().uuid().nullable().optional(),
  stage: z.string().optional(),
  offer_status: z.string().nullable().optional(),
  interview_id: z.string().uuid().optional(),
  scheduled_at: z.string().optional(),
  type: z.string().optional(),
  location: z.string().nullable().optional(),
  candidate_name: z.string().optional(),
  posting_title: z.string().optional(),
  recipient_user_ids: z.array(z.string().uuid()).optional(),
});

const lmsCompletionPayload = z.object({
  enrollment_id: z.string().uuid(),
  course_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  certificate_id: z.string().uuid(),
});

const lmsLearningAssignedPayload = z.object({
  rule_id: z.string().uuid(),
  recipient_user_ids: z.array(z.string().uuid()),
  enrollment_count: z.coerce.number().int().nonnegative(),
});

const lmsSubmissionReviewedPayload = z.object({
  submission_id: z.string().uuid(),
  enrollment_id: z.string().uuid(),
  learner_user_id: z.string().uuid().nullable(),
  review_status: z.enum(["accepted", "rejected", "needs_revision"]),
  feedback: z.string().nullable().optional(),
});

const lmsAnnouncementPayload = z.object({
  announcement_id: z.string().uuid(),
  course_id: z.string().uuid(),
  title: z.string().trim().min(1),
  operation: z.enum(["insert", "update"]),
  version: z.coerce.number().int().positive(),
});

const lmsCommunityReplyPayload = z.object({
  comment_id: z.string().uuid(),
  post_id: z.string().uuid(),
  course_id: z.string().uuid(),
  author_employee_id: z.string().uuid(),
  post_employee_id: z.string().uuid(),
  body_preview: z.string().max(160),
  version: z.coerce.number().int().positive(),
});

const chatMessagePayload = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  sender_user_id: z.string().uuid(),
  recipient_user_ids: z.array(z.string().uuid()),
  body_preview: z.string(),
});

const taskEventPayload = z.object({
  task_id: z.string().uuid(),
  assignment_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().nullable().optional(),
  status: z.string(),
  title: z.string(),
  version: z.coerce.number().int().positive().optional(),
  note_preview: z.string().optional(),
  recipient_user_ids: z.array(z.string().uuid()).optional(),
  actor_user_id: z.string().uuid(),
});

const assetEventPayload = z.object({
  inventory_id: z.string().uuid(),
  assignment_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  employee_user_id: z.string().uuid().nullable().optional(),
  employee_name: z.string().optional(),
  asset_name: z.string(),
  purchase_price: z.coerce.number().optional(),
  paid_immediately: z.boolean().optional(),
  status: z.string().optional(),
  actor_user_id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const assetDepreciationPayload = z.object({
  journal_entry_id: z.string().uuid(),
  month: z.string(),
  assets_processed: z.coerce.number().int().nonnegative(),
});

const complianceDeadlinePayload = z.object({
  alert_id: z.string().uuid(),
  source_type: z.enum(["personnel_file", "contract_end", "probation_end"]),
  source_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  deadline_label: z.string(),
  deadline_date: z.string(),
  days_remaining: z.coerce.number().int(),
  business_date: z.string(),
});

const fileRetentionDeadLetterPayload = z.object({
  managed_file_id: z.string().uuid(),
  owner_type: z.string(),
  owner_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable().optional(),
  original_name: z.string(),
  attempts: z.coerce.number().int().positive(),
  last_error: z.string(),
});

const leaveSubmissionPayload = z.object({
  leave_request_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  days: z.coerce.number().int().positive(),
  recipient_user_ids: z.array(z.string().uuid()),
});

const leaveManagerApprovalPayload = z.object({
  leave_request_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  current_step: z.coerce.number().int().positive(),
  recipient_user_ids: z.array(z.string().uuid()),
});

const financialBalancePayload = z.object({
  balance_id: z.string().uuid(), employee_id: z.string().uuid(), balance_type: z.string(),
  amount: z.coerce.number().positive(), version: z.coerce.number().int().positive(),
  employee_user_id: z.string().uuid().optional(), employee_name: z.string().optional(),
});

const scheduleEventPayload = z.object({
  assignment_id: z.string().uuid().optional(),
  employee_user_id: z.string().uuid().nullable().optional(),
  shift_name: z.string().optional(),
});

const salesCashPayload = z.object({
  collection_type: z.enum(["agent", "merchant"]),
  collection_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "rejected"]),
  amount: z.coerce.number().positive(),
  payment_method: z.string(),
  collection_date: z.string(),
  version: z.coerce.number().int().positive(),
  actor_user_id: z.string().uuid(),
});

const productReceiptEventPayload = z.object({
  receipt_id: z.string().uuid(),
  receipt_no: z.string().min(1),
  ownership_type: z.enum(["purchased", "consignment"]),
  total_units: z.coerce.number().int().nonnegative(),
  total_cost: z.coerce.number().nonnegative(),
  expected_sales_value: z.coerce.number().nonnegative(),
  accounting_status: z.enum(["pending", "pending_approval", "not_required", "posted", "failed", "reversed"]).optional(),
  version: z.coerce.number().int().positive(),
});

const productHandoverEventPayload = z.object({
  handover_id: z.string().uuid(),
  handover_no: z.string().min(1),
  agent_id: z.string().uuid(),
  agent_user_id: z.string().uuid(),
  unit_count: z.coerce.number().int().positive(),
  status: z.enum(["issued", "accepted", "completed", "cancelled"]),
  version: z.coerce.number().int().positive(),
});

const productReturnEventPayload = z.object({
  return_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  unit_count: z.coerce.number().int().positive(),
  reason: z.string().min(1),
  version: z.coerce.number().int().positive(),
});

const productPriceOverrideEventPayload = z.object({
  request_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  requested_price: z.coerce.number().positive(),
  currency: z.string().length(3),
  decision: z.enum(["approved", "rejected"]).optional(),
  version: z.coerce.number().int().positive(),
});

const productSaleEventPayload = z.object({
  sale_id: z.string().uuid(),
  sale_no: z.string().min(1),
  unit_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  agent_user_id: z.string().uuid().optional(),
  total_amount: z.coerce.number().positive(),
  unit_cost: z.coerce.number().positive().optional(),
  gross_profit: z.coerce.number().optional(),
  return_disposition: z.enum(["sellable", "damaged"]).optional(),
  reason: z.string().optional(),
  version: z.coerce.number().int().positive(),
});

const productCollectionEventPayload = z.object({
  collection_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_method: z.string().min(1),
  collection_date: z.string().min(1),
  outstanding_after: z.coerce.number(),
  version: z.coerce.number().int().positive(),
});

const productInventoryLossEventPayload = z.object({
  loss_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  loss_type: z.enum(["damage", "loss"]),
  serial_number: z.string().min(1),
  product_name: z.string().min(1),
  unit_cost: z.coerce.number().positive(),
  ownership_type: z.enum(["purchased", "consignment"]),
  reason: z.string().min(1),
  version: z.coerce.number().int().positive(),
});

const productInventoryAccountingFailedPayload = z.object({
  source_type: z.enum(["receipt", "sale", "collection", "loss"]),
  source_id: z.string().uuid(),
  error: z.string().min(1),
  attempt_count: z.coerce.number().int().positive(),
  version: z.coerce.number().int().positive(),
});

const productCommissionSettledPayload = z.object({
  settlement_id: z.string().uuid(),
  commission_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
  payment_id: z.string().uuid(),
  journal_entry_id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

async function financeManagerUserId(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("org_members").select("user_id")
    .eq("org_id", orgId).eq("role", "finance_manager").limit(1).maybeSingle();
  if (error) throw new Error(`Finance Manager lookup failed: ${error.message}`);
  if (!data?.user_id) throw new Error("No Finance Manager is available for accounting event processing.");
  return data.user_id;
}

async function deliverNotifications(values: {
  orgId: string;
  sourceEventId: string;
  userIds: string[];
  title: string;
  body: string;
  type: "system" | "attendance" | "sales" | "accounting" | "recruitment" | "lms" | "task" | "leave";
  link: string;
}) {
  if (values.userIds.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").upsert(values.userIds.map((userId) => ({
    org_id: values.orgId,
    user_id: userId,
    source_event_id: values.sourceEventId,
    title: values.title,
    body: values.body,
    type: values.type,
    link: values.link,
    is_read: false,
  })), { onConflict: "source_event_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`Notification delivery failed: ${error.message}`);
}

async function financeUserIds(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("org_members").select("user_id")
    .eq("org_id", orgId).in("role", ["finance_manager", "accountant", "finance_viewer"]);
  if (error) throw new Error(`Finance recipient lookup failed: ${error.message}`);
  return (data || []).map((row) => row.user_id);
}

async function financeManagerUserIds(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("org_members").select("user_id")
    .eq("org_id", orgId).eq("role", "finance_manager");
  if (error) throw new Error(`Finance Manager recipient lookup failed: ${error.message}`);
  return (data || []).map((row) => row.user_id);
}

async function productInventoryManagerUserIds(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("org_members").select("user_id")
    .eq("org_id", orgId).in("role", ["admin", "sales_manager", "onground_agent_manager"]);
  if (error) throw new Error(`Product inventory manager recipient lookup failed: ${error.message}`);
  return (data || []).map((row) => row.user_id);
}

async function productAgentUserId(orgId: string, agentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("field_agents").select("user_id")
    .eq("organization_id", orgId).eq("id", agentId).maybeSingle();
  if (error) throw new Error(`Product field-agent recipient lookup failed: ${error.message}`);
  return typeof data?.user_id === "string" ? data.user_id : null;
}

async function employeeUserId(orgId: string, employeeId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("employees").select("user_id")
    .eq("org_id", orgId).eq("id", employeeId).maybeSingle();
  if (error) throw new Error(`Employee recipient lookup failed: ${error.message}`);
  return data?.user_id || null;
}

async function lmsCourseLearnerUserIds(orgId: string, courseId: string) {
  const admin = createAdminClient();
  const { data: enrollments, error: enrollmentError } = await admin.from("lms_enrollments")
    .select("employee_id")
    .eq("org_id", orgId).eq("course_id", courseId).neq("status", "cancelled");
  if (enrollmentError) throw new Error(`LMS learner recipient lookup failed: ${enrollmentError.message}`);
  const employeeIds = [...new Set((enrollments || [])
    .map((row) => String(row.employee_id || ""))
    .filter(Boolean))];
  if (employeeIds.length === 0) return [];
  const { data: employees, error: employeeError } = await admin.from("employees")
    .select("user_id").eq("org_id", orgId).in("id", employeeIds).not("user_id", "is", null);
  if (employeeError) throw new Error(`LMS learner user lookup failed: ${employeeError.message}`);
  return [...new Set((employees || []).map((row) => row.user_id).filter(Boolean))] as string[];
}

async function salesLogManagerRecipients(orgId: string, companyId: string, excludeUserId: string) {
  const admin = createAdminClient();
  const [companyManagers, orgManagers] = await Promise.all([
    admin.from("sales_company_assignments").select("user_id")
      .eq("organization_id", orgId).eq("company_id", companyId)
      .eq("assignment_role", "manager").eq("is_active", true),
    admin.from("org_members").select("user_id").eq("org_id", orgId)
      .in("role", ["admin", "hr_admin"]),
  ]);
  const error = companyManagers.error || orgManagers.error;
  if (error) throw new Error(`Sales-log recipient lookup failed: ${error.message}`);
  return [...new Set([
    ...(companyManagers.data || []).map((row) => String(row.user_id)),
    ...(orgManagers.data || []).map((row) => String(row.user_id)),
  ])].filter((userId) => userId !== excludeUserId);
}

async function notifySalesLogManagers(event: OutboxEvent, payload: z.infer<typeof salesLogEventPayload>) {
  const admin = createAdminClient();
  const [logResult, profileResult] = await Promise.all([
    admin.from("sales_logs").select("company_id, sales_agent_id, log_date, grand_total")
      .eq("organization_id", event.org_id).eq("id", payload.sales_log_id).single(),
    admin.from("profiles").select("full_name, email").eq("org_id", event.org_id)
      .eq("user_id", payload.sales_agent_id).maybeSingle(),
  ]);
  if (logResult.error) throw new Error(`Sales-log notification lookup failed: ${logResult.error.message}`);
  if (profileResult.error) throw new Error(`Sales agent profile lookup failed: ${profileResult.error.message}`);
  const log = logResult.data;
  const agentName = profileResult.data?.full_name || profileResult.data?.email || "بائع";
  await deliverNotifications({
    orgId: event.org_id,
    sourceEventId: event.business_event_id,
    userIds: await salesLogManagerRecipients(event.org_id, String(log.company_id), String(log.sales_agent_id)),
    title: `تقرير مبيعات جديد من ${agentName}`,
    body: `تم إرسال مبيعات بقيمة ${Number(log.grand_total || 0).toLocaleString("ar-SA")} ريال سعودي.`,
    type: "sales",
    link: `/sales/reports?agent=${log.sales_agent_id}&company=${log.company_id}&date_from=${log.log_date}&date_to=${log.log_date}`,
  });
}

const taskStatusLabels: Record<string, string> = {
  pending: "معلق",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  delayed: "متأخر",
};

async function deliverTaskActivity(event: OutboxEvent, action: "status" | "note") {
  const payload = taskEventPayload.parse(event.payload);
  const admin = createAdminClient();
  const [taskResult, actorResult, adminResult, assigneeResult] = await Promise.all([
    admin.from("tasks").select("created_by").eq("org_id", event.org_id).eq("id", payload.task_id).maybeSingle(),
    payload.employee_id
      ? admin.from("employees").select("full_name, manager_id").eq("org_id", event.org_id)
        .eq("id", payload.employee_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("org_members").select("user_id").eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]),
    admin.from("task_assignments").select("employee:employee_id(user_id)")
      .eq("org_id", event.org_id).eq("task_id", payload.task_id),
  ]);
  const lookupError = taskResult.error || actorResult.error || adminResult.error || assigneeResult.error;
  if (lookupError) throw new Error(`Task notification lookup failed: ${lookupError.message}`);

  const recipients = new Set((adminResult.data || []).map((member) => member.user_id));
  for (const userId of payload.recipient_user_ids || []) recipients.add(userId);
  for (const assignment of assigneeResult.data || []) {
    const employee = assignment.employee as unknown as { user_id?: string | null } | null;
    if (employee?.user_id) recipients.add(employee.user_id);
  }
  if (taskResult.data?.created_by) recipients.add(taskResult.data.created_by);
  if (actorResult.data?.manager_id) {
    const managerResult = await admin.from("employees").select("user_id").eq("org_id", event.org_id)
      .eq("id", actorResult.data.manager_id).maybeSingle();
    if (managerResult.error) throw new Error(`Task manager lookup failed: ${managerResult.error.message}`);
    if (managerResult.data?.user_id) recipients.add(managerResult.data.user_id);
  }
  recipients.delete(payload.actor_user_id);

  const actorName = actorResult.data?.full_name || "مستخدم";
  const statusLabel = taskStatusLabels[payload.status] || payload.status;
  await deliverNotifications({
    orgId: event.org_id,
    sourceEventId: event.business_event_id,
    userIds: [...recipients],
    title: action === "note"
      ? `رسالة جديدة على مهمة: ${payload.title}`
      : payload.status === "completed"
        ? `تم إكمال مهمة: ${payload.title}`
        : `تحديث حالة مهمة: ${payload.title}`,
    body: action === "note"
      ? `${actorName}: ${payload.note_preview || "تمت إضافة تحديث جديد."}`
      : `${actorName} غيّر حالة المهمة إلى ${statusLabel}.`,
    type: "task",
    link: `/tasks?task=${encodeURIComponent(payload.task_id)}`,
  });
}

async function deliverAdvanceDecision(event: OutboxEvent, title: string, amountLabel: "requested" | "approved" | "disbursed") {
  const payload = advanceEventPayload.parse(event.payload);
  const userId = await employeeUserId(event.org_id, payload.employee_id);
  if (!userId) return;
  const amount = amountLabel === "requested" ? payload.requested_amount
    : amountLabel === "approved" ? payload.approved_amount : payload.amount;
  await deliverNotifications({
    orgId: event.org_id,
    sourceEventId: event.business_event_id,
    userIds: [userId],
    title,
    body: amount === null || amount === undefined ? "تم تحديث طلب السلفة." : `المبلغ: ${amount.toFixed(2)} ر.س`,
    type: "system",
    link: "/balances",
  });
}

async function employeeEventRecipients(event: OutboxEvent, includeEmployee: boolean) {
  const payload = employeeEventPayload.parse(event.payload);
  const admin = createAdminClient();
  const [employeeResult, hrResult] = await Promise.all([
    admin.from("employees").select("user_id, full_name").eq("org_id", event.org_id).eq("id", payload.employee_id).maybeSingle(),
    admin.from("org_members").select("user_id").eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]),
  ]);
  if (employeeResult.error) throw new Error(`Employee event lookup failed: ${employeeResult.error.message}`);
  if (hrResult.error) throw new Error(`Employee event recipient lookup failed: ${hrResult.error.message}`);
  const userIds = new Set((hrResult.data ?? []).map((member) => member.user_id));
  if (includeEmployee && employeeResult.data?.user_id) userIds.add(employeeResult.data.user_id);
  return { admin, payload, employee: employeeResult.data, userIds: [...userIds] };
}

async function deliverEmployeeNotification(
  event: OutboxEvent,
  values: { title: string; body: (employeeName: string) => string; includeEmployee?: boolean; type?: "system" | "recruitment" }
) {
  const recipients = await employeeEventRecipients(event, values.includeEmployee ?? false);
  if (recipients.userIds.length === 0) return;
  const employeeName = recipients.employee?.full_name || "Employee";
  const { error } = await recipients.admin.from("notifications").upsert(recipients.userIds.map((userId) => ({
    org_id: event.org_id,
    user_id: userId,
    source_event_id: event.business_event_id,
    title: values.title,
    body: values.body(employeeName),
    type: values.type || "system",
    link: `/employees/${recipients.payload.employee_id}`,
    is_read: false,
  })), { onConflict: "source_event_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`Employee notification delivery failed: ${error.message}`);
}

const handlers: Record<string, OutboxHandler> = {
  "notification.create": async (event) => {
    const payload = notificationPayload.parse(event.payload);
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").upsert({
      org_id: event.org_id,
      user_id: payload.userId,
      source_event_id: event.business_event_id,
      title: payload.title,
      body: payload.body ?? null,
      type: payload.type,
      link: payload.link ?? null,
    }, { onConflict: "source_event_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`Notification delivery failed: ${error.message}`);
  },
  "employee.onboarding_started": (event) => deliverEmployeeNotification(event, {
    title: "Employee onboarding requires completion",
    body: (name) => `${name} has an onboarding record awaiting documents, assignments, account setup, and activation.`,
    type: "recruitment",
  }),
  "employee.onboarded": (event) => deliverEmployeeNotification(event, {
    title: "Employee onboarding completed",
    body: (name) => `${name} is now active in the workforce system.`,
    includeEmployee: true,
  }),
  "employee.offboarded": (event) => deliverEmployeeNotification(event, {
    title: "Employee offboarding completed",
    body: (name) => `${name}'s organization access and active assignments were closed while historical records were retained.`,
  }),
  "employee.updated": (event) => deliverEmployeeNotification(event, {
    title: "Employee record updated",
    body: (name) => `${name}'s employee master record was updated.`,
    includeEmployee: true,
  }),
  "attendance.location_missing": async (event) => {
    const payload = attendanceLocationMissingPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin"])
      .neq("user_id", payload.actor_user_id);
    if (error) throw new Error(`Attendance alert recipient lookup failed: ${error.message}`);
    const actionLabel = payload.action === "check_out" ? "تسجيل الانصراف" : "تسجيل الحضور";
    const employeeLabel = payload.employee_code
      ? `${payload.employee_name} (${payload.employee_code})`
      : payload.employee_name;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [...new Set((data || []).map((row) => row.user_id))],
      title: "موظف بدون موقع حضور",
      body: `حاول ${employeeLabel} ${actionLabel} لكن لا يوجد موقع حضور مسند له.`,
      type: "attendance",
      link: `/employees/${payload.employee_id}`,
    });
  },
  "identity.auth_sync_requested": async (event) => {
    const payload = identityAuthSyncPayload.parse(event.payload);
    const admin = createAdminClient();
    const start = await admin.rpc("start_identity_auth_sync_job", { p_job_id: payload.job_id });
    if (start.error) throw new Error(`Identity Auth sync claim failed: ${start.error.message}`);
    const job = start.data && typeof start.data === "object" && !Array.isArray(start.data)
      ? start.data as Record<string, unknown>
      : {};
    if (job.status === "completed" || job.status === "cancelled") return;
    let effectiveAction = payload.action;
    try {
      if (effectiveAction !== "delete") {
        const profile = await admin.from("profiles").select("account_status")
          .eq("org_id", event.org_id).eq("user_id", payload.target_user_id).maybeSingle();
        if (profile.error) throw new Error(`Identity profile lookup failed: ${profile.error.message}`);
        effectiveAction = String(profile.data?.account_status || "").trim().toLowerCase() === "active"
          ? "unban"
          : "ban";
      }
      if (effectiveAction === "delete") {
        const safetyCleanup = payload.source_type === "provisioning_safety";
        const membership = safetyCleanup
          ? await admin.from("org_members").select("user_id").eq("org_id", event.org_id)
            .eq("user_id", payload.target_user_id).maybeSingle()
          : { data: null, error: null };
        if (membership.error) throw new Error(`Identity membership lookup failed: ${membership.error.message}`);
        if (membership.data) {
          effectiveAction = "unban";
        } else {
          const deletion = await admin.auth.admin.deleteUser(payload.target_user_id);
          const missingUser = deletion.error?.message?.toLowerCase().includes("not found")
            || deletion.error?.message?.toLowerCase().includes("does not exist");
          if (deletion.error && !missingUser) throw deletion.error;
        }
      } else {
        const update = await admin.auth.admin.updateUserById(payload.target_user_id, {
          ban_duration: effectiveAction === "ban" ? "876000h" : "none",
        });
        if (update.error) throw update.error;
      }
      const completed = await admin.rpc("complete_identity_auth_sync_job", {
        p_job_id: payload.job_id,
        p_result: { requested_action: payload.action, effective_action: effectiveAction },
      });
      if (completed.error) throw new Error(`Identity Auth sync completion failed: ${completed.error.message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Identity Auth sync failed.";
      const failed = await admin.rpc("fail_identity_auth_sync_job", {
        p_job_id: payload.job_id,
        p_error: message,
      });
      if (failed.error) throw new Error(`${message}; job failure recording failed: ${failed.error.message}`);
      throw error;
    }
  },
  "accounting.journal_pending_approval": async (event) => {
    const payload = accountingJournalEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeManagerUserIds(event.org_id),
      title: "قيد محاسبي بانتظار الاعتماد",
      body: `${payload.entry_no}: ${payload.description}`,
      type: "accounting",
      link: `/accounting/journal-entries/${payload.journal_entry_id}`,
    });
  },
  "accounting.journal_posted": async (event) => {
    const payload = accountingJournalEventPayload.parse(event.payload);
    const inventorySourceType = ({
      product_inventory_receipt: "receipt",
      product_inventory_sale: "sale",
      product_inventory_collection: "collection",
      product_inventory_loss: "loss",
    } as const)[payload.source_module as
      | "product_inventory_receipt"
      | "product_inventory_sale"
      | "product_inventory_collection"
      | "product_inventory_loss"];
    if (inventorySourceType && payload.source_id) {
      const admin = createAdminClient();
      const { error: markError } = await admin.rpc("mark_product_inventory_accounting", {
        p_org_id: event.org_id,
        p_source_type: inventorySourceType,
        p_source_id: payload.source_id,
        p_status: "posted",
        p_journal_entry_id: payload.journal_entry_id,
        p_reversal_entry_id: null,
        p_error: null,
        p_amounts: {},
      });
      if (markError) throw new Error(`Inventory accounting activation failed: ${markError.message}`);
      if (inventorySourceType === "sale") {
        const { error: commissionError } = await admin.rpc(
          "record_product_agent_commission_accrual",
          {
            p_org_id: event.org_id,
            p_sale_id: payload.source_id,
            p_journal_entry_id: payload.journal_entry_id,
          }
        );
        if (commissionError) throw new Error(`Product commission activation failed: ${commissionError.message}`);
      }
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: payload.source_module === "reversal" ? "تم ترحيل قيد عكس محاسبي" : "تم ترحيل قيد محاسبي",
      body: `${payload.entry_no}: ${payload.description}`,
      type: "accounting",
      link: `/accounting/journal-entries/${payload.journal_entry_id}`,
    });
  },
  "accounting.journal_reversed": async (event) => {
    const payload = accountingJournalEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم عكس قيد محاسبي",
      body: `${payload.entry_no}: ${payload.description}`,
      type: "accounting",
      link: `/accounting/journal-entries/${payload.journal_entry_id}`,
    });
  },
  "accounting.customer_saved": async (event) => {
    const payload = accountingCustomerEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: payload.is_active ? "تم حفظ عميل محاسبي" : "تم تعطيل عميل محاسبي",
      body: payload.sales_company_id
        ? `${payload.customer_name} — تم توحيد الربط مع شركة المبيعات.`
        : payload.customer_name,
      type: "accounting",
      link: "/accounting/customers",
    });
  },
  "accounting.record_changed": async (event) => {
    const payload = accountingRecordEventPayload.parse(event.payload);
    if (payload.table_name === "accounting_payments"
        && (payload.invoice_id || payload.expense_id || payload.payroll_id)) return;
    const labels: Record<string, { title: string; link: string }> = {
      accounting_expenses: {
        title: payload.change === "created" ? "مصروف جديد"
          : payload.change === "approved" ? "تم اعتماد مصروف"
            : payload.change === "rejected" ? "تم رفض مصروف" : "تم سداد مصروف",
        link: `/accounting/expenses/${payload.record_id}`,
      },
      accounting_invoices: {
        title: payload.change === "issued" ? "تم إصدار فاتورة" : "تم تسجيل سداد فاتورة",
        link: `/accounting/invoices/${payload.record_id}`,
      },
      accounting_payments: {
        title: payload.record_type === "manual" ? "تم ترحيل دفعة يدوية" : "تم ترحيل دفعة",
        link: `/accounting/payments/${payload.record_id}`,
      },
      accounting_periods: {
        title: payload.change === "closed" ? "تم إغلاق فترة محاسبية" : "تمت إعادة فتح فترة محاسبية",
        link: "/accounting/settings",
      },
      accounting_settings: { title: "تم تحديث إعدادات المحاسبة", link: "/accounting/settings" },
      accounting_accounts: { title: "تم تحديث بيانات محاسبية", link: "/accounting/accounts" },
      accounting_cost_centers: { title: "تم تحديث بيانات محاسبية", link: "/accounting/cost-centers" },
      accounting_vendors: { title: "تم تحديث بيانات محاسبية", link: "/accounting/vendors" },
      accounting_journal_entries: {
        title: payload.change === "cancelled" ? "تم إلغاء قيد محاسبي" : "تم إنشاء مسودة قيد رواتب",
        link: `/accounting/journal-entries/${payload.record_id}`,
      },
    };
    const label = labels[payload.table_name];
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: label.title,
      body: payload.description || payload.number || payload.name || payload.change,
      type: "accounting",
      link: label.link,
    });
  },
  "accounting.entity_changed": async () => {},
  "finance.team_configured": async () => {},
  "platform.organization_created": async () => {},
  "platform.organization_updated": async () => {},
  "platform.organization_user_controlled": async () => {},
  "organization.settings_updated": async () => {},
  "promoter.lead_saved": async (event) => {
    const payload = promoterLeadEventPayload.parse(event.payload);
    if (!payload.assigned_agent_changed || !payload.assigned_agent_id) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [payload.assigned_agent_id],
      title: "عميل ترويجي جديد",
      body: payload.full_name,
      type: "sales",
      link: `/sales/leads?lead=${payload.lead_id}`,
    });
  },
  "promoter.configuration_saved": async () => {},
  "sales.shift_prompt_created": async (event) => {
    const payload = salesShiftPromptEventPayload.parse(event.payload);
    const managerLink = `/sales/reports?agent=${payload.sales_agent_id}&company=${payload.company_id}`
      + `&date_from=${payload.prompt_date}&date_to=${payload.prompt_date}`;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: payload.prompt_type === "mid_shift"
        ? [payload.sales_agent_id]
        : await salesLogManagerRecipients(event.org_id, payload.company_id, payload.sales_agent_id),
      title: payload.prompt_type === "mid_shift"
        ? "تنبيه هدف المبيعات"
        : `لم يحقق ${payload.agent_name} هدف المبيعات`,
      body: payload.prompt_type === "mid_shift"
        ? `لم تصل إلى 40% من هدف ${payload.company_name}.`
        : `حقق ${payload.achieved_amount} من أصل ${payload.target_amount} قبل نهاية الوردية.`,
      type: "sales",
      link: payload.prompt_type === "mid_shift"
        ? `/sales/log?company_id=${payload.company_id}`
        : managerLink,
    });
  },
  "sales.shift_reason_submitted": async (event) => {
    const payload = salesShiftReasonEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await salesLogManagerRecipients(event.org_id, payload.company_id, payload.sales_agent_id),
      title: "سبب عدم تحقيق هدف المبيعات",
      body: payload.reason,
      type: "sales",
      link: `/sales/reports?agent=${payload.sales_agent_id}&company=${payload.company_id}`
        + `&date_from=${payload.prompt_date}&date_to=${payload.prompt_date}`,
    });
  },
  "recruitment.application_submitted": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: payload.recipient_user_ids || [],
      title: "تقديم جديد على وظيفة",
      body: `${payload.candidate_name || "متقدم جديد"} قدم على وظيفة \"${payload.posting_title || ""}\".`,
      type: "recruitment", link: `/recruitment/${payload.job_posting_id}` });
  },
  "recruitment.application_transitioned": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    if (!payload.candidate_user_id) return;
    const admin = createAdminClient();
    const { data: posting, error } = await admin.from("job_postings").select("title")
      .eq("org_id", event.org_id).eq("id", payload.job_posting_id).maybeSingle();
    if (error) throw new Error(`Recruitment posting lookup failed: ${error.message}`);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [payload.candidate_user_id],
      title: payload.stage === "offer" ? "لديك عرض وظيفي" : "تحديث حالة طلبك",
      body: payload.stage === "offer"
        ? `تم إصدار عرض لوظيفة \"${posting?.title || ""}\". سجّل الدخول لقبوله أو رفضه.`
        : `تم تحديث طلبك لوظيفة \"${posting?.title || ""}\" إلى مرحلة ${payload.stage || "جديدة"}.`,
      type: "recruitment",
      link: "/candidate/applications",
    });
  },
  "recruitment.offer_accepted": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin", "hr_recruitment"]);
    if (error) throw new Error(`Recruitment recipient lookup failed: ${error.message}`);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: (data || []).map((row) => row.user_id),
      title: "تم قبول عرض وظيفي", body: "قبل المتقدم العرض وأصبح الطلب جاهزًا لبدء التعيين.",
      type: "recruitment", link: `/recruitment/${payload.job_posting_id}` });
  },
  "recruitment.interview_scheduled": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    if (!payload.candidate_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.candidate_user_id],
      title: "تم جدولة مقابلة", body: `موعد المقابلة: ${payload.scheduled_at || "راجع تفاصيل الطلب"}${payload.location ? ` — ${payload.location}` : ""}`,
      type: "recruitment", link: "/candidate/applications" });
  },
  "recruitment.offer_declined": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin", "hr_recruitment"]);
    if (error) throw new Error(`Recruitment recipient lookup failed: ${error.message}`);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: (data || []).map((row) => row.user_id),
      title: "تم رفض عرض وظيفي", body: "رفض المتقدم العرض الوظيفي.",
      type: "recruitment", link: `/recruitment/${payload.job_posting_id}` });
  },
  "recruitment.candidate_hired": async (event) => {
    const payload = recruitmentEventPayload.parse(event.payload);
    if (!payload.candidate_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.candidate_user_id],
      title: "بدأت إجراءات الانضمام", body: "تم تحويل طلبك إلى ملف موظف وأصبحت إجراءات الانضمام قيد الاستكمال.",
      type: "recruitment", link: "/candidate/applications" });
  },
  "lms.enrollment_completed": async (event) => {
    const payload = lmsCompletionPayload.parse(event.payload);
    const userId = await employeeUserId(event.org_id, payload.employee_id);
    if (!userId) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [userId],
      title: "تم إكمال الدورة وإصدار الشهادة", body: "اكتملت متطلبات الدورة وأصبحت شهادتك متاحة.",
      type: "lms", link: "/lms/certificates" });
  },
  "lms.learning_assigned": async (event) => {
    const payload = lmsLearningAssignedPayload.parse(event.payload);
    if (payload.recipient_user_ids.length === 0) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: payload.recipient_user_ids,
      title: "تم إسناد تدريب جديد",
      body: payload.enrollment_count > 1
        ? `تم إسناد ${payload.enrollment_count} دورات تدريبية جديدة لك.`
        : "لديك دورة تدريبية جديدة في منصة التعلم.",
      type: "lms",
      link: "/lms/my",
    });
  },
  "lms.submission_reviewed": async (event) => {
    const payload = lmsSubmissionReviewedPayload.parse(event.payload);
    if (!payload.learner_user_id) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [payload.learner_user_id],
      title: "تمت مراجعة مهمة تدريبية",
      body: payload.feedback || "راجع نتيجة وملاحظات المدرب على تسليمك.",
      type: "lms",
      link: `/lms/player/${payload.enrollment_id}`,
    });
  },
  "lms.announcement_published": async (event) => {
    const payload = lmsAnnouncementPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await lmsCourseLearnerUserIds(event.org_id, payload.course_id),
      title: payload.operation === "insert" ? "إعلان جديد في الدورة" : "تم تحديث إعلان الدورة",
      body: payload.title,
      type: "lms",
      link: `/lms/community?course=${encodeURIComponent(payload.course_id)}`,
    });
  },
  "lms.community_replied": async (event) => {
    const payload = lmsCommunityReplyPayload.parse(event.payload);
    if (payload.author_employee_id === payload.post_employee_id) return;
    const postOwnerUserId = await employeeUserId(event.org_id, payload.post_employee_id);
    if (!postOwnerUserId) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [postOwnerUserId],
      title: "رد جديد في مجتمع الدورة",
      body: payload.body_preview,
      type: "lms",
      link: `/lms/community?course=${encodeURIComponent(payload.course_id)}`,
    });
  },
  "lms.rubric_saved": async () => {},
  "chat.message_sent": async (event) => {
    const payload = chatMessagePayload.parse(event.payload);
    if (payload.recipient_user_ids.length === 0) return;
    const admin = createAdminClient();
    const { data: sender, error } = await admin.from("profiles").select("full_name, email")
      .eq("org_id", event.org_id).eq("user_id", payload.sender_user_id).maybeSingle();
    if (error) throw new Error(`Chat sender lookup failed: ${error.message}`);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: payload.recipient_user_ids,
      title: "رسالة شات جديدة", body: `${sender?.full_name || sender?.email || "مستخدم"}: ${payload.body_preview}`,
      type: "system", link: `/chat?conversation=${encodeURIComponent(payload.conversation_id)}` });
  },
  "task.status_changed": (event) => deliverTaskActivity(event, "status"),
  "task.update_added": (event) => deliverTaskActivity(event, "note"),
  "task.created": (event) => deliverTaskActivity(event, "note"),
  "task.updated": (event) => deliverTaskActivity(event, "note"),
  "asset.inventory_created": async (event) => {
    const payload = assetEventPayload.parse(event.payload);
    if (!payload.purchase_price || payload.purchase_price <= 0) return;
    const posting = await autoCapitalizeAsset(createAdminClient(), event.org_id,
      await financeManagerUserId(event.org_id), {
        id: payload.inventory_id,
        asset_name: payload.asset_name,
        purchase_price: payload.purchase_price,
        paid_immediately: payload.paid_immediately,
        command_id: event.business_event_id,
        request_id: event.business_event_id,
      });
    if (!posting.success) throw new Error(posting.error || "Asset capitalization failed.");
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تمت رسملة أصل جديد",
      body: `${payload.asset_name}: ${payload.purchase_price.toFixed(2)} ر.س`,
      type: "accounting",
      link: posting.journalEntryId ? `/accounting/journal-entries/${posting.journalEntryId}` : "/assets",
    });
  },
  "asset.assigned": async (event) => {
    const payload = assetEventPayload.parse(event.payload);
    if (!payload.employee_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.employee_user_id],
      title: "تم تسليم عهدة جديدة", body: `تم تسجيل عهدة جديدة لك: ${payload.asset_name}. راجعها ووقّع بالاستلام.`,
      type: "system", link: "/assets" });
  },
  "asset.status_changed": async (event) => {
    const payload = assetEventPayload.parse(event.payload);
    if (!payload.employee_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.employee_user_id],
      title: "تم تحديث حالة العهدة", body: `${payload.asset_name}: ${payload.status || "تم التحديث"}.`,
      type: "system", link: "/assets" });
  },
  "asset.acknowledged": async (event) => {
    const payload = assetEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]);
    if (error) throw new Error(`Asset acknowledgement recipient lookup failed: ${error.message}`);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: (data || []).map((member) => member.user_id),
      title: "تم توقيع استلام عهدة", body: `${payload.employee_name || "الموظف"} وقّع استلام: ${payload.asset_name}.`,
      type: "system", link: "/assets" });
  },
  "asset.depreciation_posted": async (event) => {
    const payload = assetDepreciationPayload.parse(event.payload);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم ترحيل إهلاك الأصول", body: `تم ترحيل إهلاك ${payload.assets_processed} أصل لشهر ${payload.month}.`,
      type: "accounting", link: `/accounting/journal-entries/${payload.journal_entry_id}` });
  },
  "compliance.deadline": async (event) => {
    const payload = complianceDeadlinePayload.parse(event.payload);
    const admin = createAdminClient();
    const [members, employee] = await Promise.all([
      admin.from("org_members").select("user_id").eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]),
      admin.from("employees").select("user_id").eq("org_id", event.org_id).eq("id", payload.employee_id).maybeSingle(),
    ]);
    if (members.error) throw new Error(`Compliance recipient lookup failed: ${members.error.message}`);
    if (employee.error) throw new Error(`Compliance employee lookup failed: ${employee.error.message}`);
    const recipients = new Set((members.data || []).map((member) => member.user_id));
    if (employee.data?.user_id) recipients.add(employee.data.user_id);
    const timing = payload.days_remaining > 0
      ? `متبقٍ ${payload.days_remaining} يوم`
      : payload.days_remaining === 0 ? "الموعد اليوم" : `متأخر ${Math.abs(payload.days_remaining)} يوم`;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [...recipients],
      title: `تنبيه امتثال: ${payload.deadline_label}`,
      body: `${payload.employee_name} — ${payload.deadline_date} (${timing}).`,
      type: "sales",
      link: "/personnel",
    });
  },
  "file.retention_dead_letter": async (event) => {
    const payload = fileRetentionDeadLetterPayload.parse(event.payload);
    const admin = createAdminClient();
    const members = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]);
    if (members.error) throw new Error(`File-retention recipient lookup failed: ${members.error.message}`);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: (members.data || []).map((member) => member.user_id),
      title: "تعذر حذف ملف منتهي الاحتفاظ",
      body: `${payload.original_name} فشل حذفه بعد ${payload.attempts} محاولات ويحتاج تدخلاً تشغيليًا.`,
      type: "sales",
      link: "/personnel",
    });
  },
  "leave.request_submitted": async (event) => {
    const payload = leaveSubmissionPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: payload.recipient_user_ids,
      title: "طلب إجازة جديد",
      body: `${payload.employee_name} — ${payload.start_date} إلى ${payload.end_date} (${payload.days} يوم).`,
      type: "sales",
      link: "/leave",
    });
  },
  "leave.manager_approved": async (event) => {
    const payload = leaveManagerApprovalPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: payload.recipient_user_ids,
      title: "طلب إجازة بانتظار HR",
      body: `تمت موافقة المدير على طلب إجازة ${payload.employee_name}. الطلب الآن بانتظار مراجعة HR.`,
      type: "leave",
      link: "/leave",
    });
  },
  "financial.balance_created": async (event) => {
    const payload = financialBalancePayload.parse(event.payload);
    if (!payload.employee_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.employee_user_id],
      title: "تم تسجيل رصيد مالي", body: `${payload.balance_type}: ${payload.amount.toFixed(2)} ر.س`,
      type: "system", link: "/balances" });
  },
  "financial.balance_acknowledged": async (event) => {
    const payload = financialBalancePayload.parse(event.payload);
    const admin = createAdminClient();
    const members = await admin.from("org_members").select("user_id").eq("org_id", event.org_id)
      .in("role", ["admin", "hr_admin"]);
    if (members.error) throw new Error(`Financial-balance recipient lookup failed: ${members.error.message}`);
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: (members.data || []).map((item) => item.user_id),
      title: "تم إقرار رصيد مالي", body: `${payload.employee_name || "الموظف"}: ${payload.amount.toFixed(2)} ر.س`,
      type: "system", link: "/balances" });
  },
  "schedule.shift_created": async () => {},
  "schedule.shift_updated": async () => {},
  "schedule.shift_deleted": async () => {},
  "schedule.assignment_assigned": async (event) => {
    const payload = scheduleEventPayload.parse(event.payload);
    if (!payload.employee_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.employee_user_id],
      title: "تم إسناد وردية جديدة", body: `الوردية: ${payload.shift_name || "راجع جدولك"}.`,
      type: "system", link: "/schedule" });
  },
  "schedule.assignment_removed": async (event) => {
    const payload = scheduleEventPayload.parse(event.payload);
    if (!payload.employee_user_id) return;
    await deliverNotifications({ orgId: event.org_id, sourceEventId: event.business_event_id,
      userIds: [payload.employee_user_id],
      title: "تم إلغاء إسناد وردية", body: `الوردية: ${payload.shift_name || "راجع جدولك"}.`,
      type: "system", link: "/schedule" });
  },
  "organization.department_created": async () => {},
  "organization.department_updated": async () => {},
  "organization.department_deleted": async () => {},
  "organization.department_members_changed": async () => {},
  "organization.location_created": async () => {},
  "organization.location_updated": async () => {},
  "organization.location_deleted": async () => {},
  "sales.identity_provisioned": async () => {},
  "sales.team_configured": async () => {},
  "product_inventory.workbook_previewed": async () => {},
  "product_inventory.workbook_committed": async () => {},
  "product_inventory.photo_previewed": async () => {},
  "product_inventory.photo_committed": async () => {},
  "product_inventory.receipt_draft_saved": async () => {},
  "product_inventory.receipt_cancelled": async () => {},
  "product_inventory.receipt_confirmed": async (event) => {
    const payload = productReceiptEventPayload.parse(event.payload);
    const posting = await autoPostProductReceipt(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.receipt_id
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product receipt accounting failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: `تم تأكيد استلام منتجات ${payload.receipt_no}`,
      body: `${payload.total_units} وحدة، تكلفة ${payload.total_cost.toFixed(2)} ر.س، وقيمة بيع مخططة ${payload.expected_sales_value.toFixed(2)} ر.س.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.handover_issued": async (event) => {
    const payload = productHandoverEventPayload.parse(event.payload);
    if (payload.status !== "issued") return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [payload.agent_user_id],
      title: `عهدة منتجات جديدة ${payload.handover_no}`,
      body: `${payload.unit_count} وحدة مسلسلة تنتظر مراجعتك وتأكيد الاستلام.`,
      type: "sales",
      link: "/agent/products/receive",
    });
  },
  "product_inventory.handover_accepted": async (event) => {
    const payload = productHandoverEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await productInventoryManagerUserIds(event.org_id),
      title: `تم استلام العهدة ${payload.handover_no}`,
      body: `أكد المندوب استلام ${payload.unit_count} وحدة مسلسلة.`,
      type: "sales",
      link: "/sales/inventory/assignments",
    });
  },
  "product_inventory.agent_returned": async (event) => {
    const payload = productReturnEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await productInventoryManagerUserIds(event.org_id),
      title: "تم إرجاع منتجات إلى المخزن",
      body: `${payload.unit_count} وحدة — ${payload.reason}`,
      type: "sales",
      link: "/sales/inventory/assignments",
    });
  },
  "product_inventory.price_override_requested": async (event) => {
    const payload = productPriceOverrideEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await productInventoryManagerUserIds(event.org_id),
      title: "طلب استثناء سعر منتج",
      body: `السعر المطلوب ${payload.requested_price.toFixed(2)} ${payload.currency}.`,
      type: "sales",
      link: "/sales/inventory/assignments",
    });
  },
  "product_inventory.price_override_reviewed": async (event) => {
    const payload = productPriceOverrideEventPayload.parse(event.payload);
    const agentUserId = await productAgentUserId(event.org_id, payload.agent_id);
    if (!agentUserId) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [agentUserId],
      title: payload.decision === "approved" ? "تم اعتماد سعر المنتج" : "تم رفض سعر المنتج",
      body: `السعر المطلوب ${payload.requested_price.toFixed(2)} ${payload.currency}.`,
      type: "sales",
      link: "/agent/products/sell",
    });
  },
  "product_inventory.sale_recorded": async (event) => {
    const payload = productSaleEventPayload.parse(event.payload);
    const posting = await autoPostProductSale(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.sale_id
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product sale accounting failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: `مبيعة منتج جديدة ${payload.sale_no}`,
      body: `قيمة البيع ${payload.total_amount.toFixed(2)} ر.س، والتكلفة ${Number(payload.unit_cost || 0).toFixed(2)} ر.س.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.sale_voided": async (event) => {
    const payload = productSaleEventPayload.parse(event.payload);
    const posting = await autoReverseProductSale(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.sale_id,
      payload.reason || "Product sale voided."
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product sale reversal failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: `إلغاء مبيعة منتج ${payload.sale_no}`,
      body: `${payload.total_amount.toFixed(2)} ر.س — ${payload.reason || "بدون تفاصيل"}.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.collection_posted": async (event) => {
    const payload = productCollectionEventPayload.parse(event.payload);
    const posting = await autoPostProductCollection(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.collection_id
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product collection accounting failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تحصيل جديد من مندوب منتجات",
      body: `${payload.amount.toFixed(2)} ر.س — المتبقي ${payload.outstanding_after.toFixed(2)} ر.س.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.damage_recorded": async (event) => {
    const payload = productInventoryLossEventPayload.parse(event.payload);
    const posting = await autoPostProductInventoryLoss(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.loss_id
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product damage accounting failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: `إثبات تلف ${payload.product_name}`,
      body: `${payload.serial_number} — تكلفة ${payload.unit_cost.toFixed(2)} ر.س.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.loss_recorded": async (event) => {
    const payload = productInventoryLossEventPayload.parse(event.payload);
    const posting = await autoPostProductInventoryLoss(
      createAdminClient(),
      event.org_id,
      await financeManagerUserId(event.org_id),
      payload.loss_id
    );
    if (!posting.success) {
      throw new Error(posting.error || "Product loss accounting failed.");
    }
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: `إثبات فقد ${payload.product_name}`,
      body: `${payload.serial_number} — تكلفة ${payload.unit_cost.toFixed(2)} ر.س.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.accounting_failed": async (event) => {
    const payload = productInventoryAccountingFailedPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeManagerUserIds(event.org_id),
      title: "تعذر ترحيل حركة مخزون منتجات",
      body: `${payload.source_type} — المحاولة ${payload.attempt_count}: ${payload.error}`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "product_inventory.commission_settled": async (event) => {
    const payload = productCommissionSettledPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم سداد عمولة مندوب منتجات",
      body: `${payload.amount.toFixed(2)} ${payload.currency} — مرتبطة بالمبيعة ${payload.sale_id}.`,
      type: "accounting",
      link: "/accounting/inventory",
    });
  },
  "sales.cash_submitted": async () => {},
  "sales.cash_rejected": async () => {},
  "sales.cash_confirmed": async (event) => {
    const payload = salesCashPayload.parse(event.payload);
    const admin = createAdminClient();
    const posting = await autoPostSalesCashCollection(admin, event.org_id,
      await financeManagerUserId(event.org_id), {
        collection_id: payload.collection_id,
        collection_type: payload.collection_type,
        amount: payload.amount,
        payment_method: payload.payment_method,
        collection_date: payload.collection_date,
      }, { commandId: event.business_event_id, requestId: event.business_event_id });
    const { error: markError } = await admin.rpc("mark_sales_cash_accounting", {
      p_org_id: event.org_id,
      p_collection_type: payload.collection_type,
      p_collection_id: payload.collection_id,
      p_status: posting.success ? "posted" : "failed",
      p_journal_entry_id: posting.journalEntryId || null,
      p_error: posting.error || null,
    });
    if (markError) throw new Error(`Sales cash accounting status failed: ${markError.message}`);
    if (!posting.success) throw new Error(posting.error || "Sales cash accounting posting failed.");
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم ترحيل تحصيل مبيعات",
      body: `${payload.amount.toFixed(2)} ر.س — ${payload.payment_method}`,
      type: "accounting",
      link: posting.journalEntryId ? `/accounting/journal-entries/${posting.journalEntryId}` : "/accounting",
    });
  },
  "payroll.deduction_policy_saved": async () => {},
  "payroll.deduction_policy_deleted": async () => {},
  "payroll.run_approved": async (event) => {
    const payload = payrollEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data: financeManager, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).eq("role", "finance_manager").limit(1).maybeSingle();
    if (error) throw new Error(`Payroll posting actor lookup failed: ${error.message}`);
    if (!financeManager?.user_id) throw new Error("No Finance Manager is available to post approved payroll.");
    const posting = await autoPostPayrollMonth(
      admin,
      event.org_id,
      financeManager.user_id,
      payload.month.slice(0, 7),
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!posting.success) throw new Error(posting.error || "Approved payroll posting failed.");
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم اعتماد مسير الرواتب",
      body: `تم اعتماد مسير ${payload.month.slice(0, 7)}${posting.journalEntryId ? " وترحيله محاسبيًا" : ""}.`,
      type: "accounting",
      link: "/payroll",
    });
  },
  "payroll.run_paid": async (event) => {
    const payload = payrollEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم سداد مسير الرواتب",
      body: `تم تسجيل سداد مسير ${payload.month.slice(0, 7)} وربطه بالقيد المحاسبي.`,
      type: "accounting",
      link: "/payroll",
    });
  },
  "advance.request_submitted": async (event) => {
    const payload = advanceEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const { data, error } = await admin.from("org_members").select("user_id")
      .eq("org_id", event.org_id).in("role", ["admin", "hr_admin"]);
    if (error) throw new Error(`Advance reviewer lookup failed: ${error.message}`);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: (data || []).map((row) => row.user_id),
      title: "طلب سلفة جديد",
      body: `تم تقديم طلب بقيمة ${Number(payload.requested_amount || 0).toFixed(2)} ر.س`,
      type: "system",
      link: "/balances",
    });
  },
  "advance.request_approved": (event) => deliverAdvanceDecision(event, "تم اعتماد طلب السلفة", "approved"),
  "advance.request_partial_approved": (event) => deliverAdvanceDecision(event, "تم اعتماد جزء من طلب السلفة", "approved"),
  "advance.request_rejected": (event) => deliverAdvanceDecision(event, "تم رفض طلب السلفة", "approved"),
  "advance.request_disbursed": (event) => deliverAdvanceDecision(event, "تم صرف السلفة", "disbursed"),
  "sales_log.submitted": async (event) => {
    const payload = salesLogEventPayload.parse(event.payload);
    const posting = await autoPostSalesLogRevision(
      createAdminClient(), event.org_id, await financeManagerUserId(event.org_id), payload.revision_id,
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!posting.success) throw new Error(posting.error || "Sales log accounting posting failed.");
    await notifySalesLogManagers(event, payload);
  },
  "sales_log.corrected": async (event) => {
    const payload = salesLogEventPayload.parse(event.payload);
    if (!payload.previous_revision_id) throw new Error("Corrected sales log event has no previous revision.");
    const userId = await financeManagerUserId(event.org_id);
    const reversal = await autoReverseSalesLogRevision(
      createAdminClient(), event.org_id, userId, payload.previous_revision_id,
      `Sales log ${payload.sales_log_id} was corrected by revision ${payload.revision_number}.`,
      { commandId: event.id, requestId: event.business_event_id }
    );
    if (!reversal.success) throw new Error(reversal.error || "Previous sales log revision reversal failed.");
    const posting = await autoPostSalesLogRevision(
      createAdminClient(), event.org_id, userId, payload.revision_id,
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!posting.success) throw new Error(posting.error || "Corrected sales log revision posting failed.");
  },
  "sales_log.voided": async (event) => {
    const payload = salesLogEventPayload.parse(event.payload);
    if (!payload.previous_revision_id) throw new Error("Voided sales log event has no previous revision.");
    const reversal = await autoReverseSalesLogRevision(
      createAdminClient(), event.org_id, await financeManagerUserId(event.org_id), payload.previous_revision_id,
      payload.reason || `Sales log ${payload.sales_log_id} was voided.`,
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!reversal.success) throw new Error(reversal.error || "Voided sales log revision reversal failed.");
    const userId = payload.sales_agent_id;
    if (userId) await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [userId],
      title: "تم إلغاء تقرير المبيعات",
      body: payload.reason || "تم إلغاء التقرير بعد المراجعة.",
      type: "system",
      link: `/sales/history?date=${payload.log_date || ""}`,
    });
  },
  "sales_log.edit_requested": async (event) => {
    const payload = salesLogEditEventPayload.parse(event.payload);
    const admin = createAdminClient();
    const profileResult = await admin.from("profiles").select("full_name, email")
      .eq("org_id", event.org_id).eq("user_id", payload.sales_agent_id).maybeSingle();
    if (profileResult.error) throw new Error(`Sales agent profile lookup failed: ${profileResult.error.message}`);
    const agentName = profileResult.data?.full_name || profileResult.data?.email || "بائع";
    if (!payload.company_id) return;
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await salesLogManagerRecipients(event.org_id, payload.company_id, payload.sales_agent_id),
      title: `طلب تعديل تقرير مبيعات من ${agentName}`,
      body: payload.requested_changes || "تم إرسال طلب تعديل جديد.",
      type: "system",
      link: `/sales/reports?agent=${payload.sales_agent_id}&company=${payload.company_id}&date=${payload.log_date}`,
    });
  },
  "sales_log.edit_resolved": async (event) => {
    const payload = salesLogEditEventPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: [payload.sales_agent_id],
      title: payload.resolution_status === "applied"
        ? "تم تطبيق تعديل تقرير المبيعات"
        : "تم رفض طلب تعديل تقرير المبيعات",
      body: payload.resolution_status === "applied"
        ? `تم تحديث التقرير بإجمالي ${payload.grand_total.toLocaleString("ar-SA")} ريال سعودي.`
        : payload.resolution_note || "راجع مدير المبيعات لمعرفة سبب الرفض.",
      type: "system",
      link: `/sales/history?date=${payload.log_date}`,
    });
  },
  "sim.sale_recorded": async (event) => {
    const payload = simSaleEventPayload.parse(event.payload);
    const posting = await autoPostSimSale(
      createAdminClient(), event.org_id, await financeManagerUserId(event.org_id), payload.sale_id,
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!posting.success) throw new Error(posting.error || "SIM sale accounting posting failed.");
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم تسجيل بيع شريحة",
      body: `قيمة البيع ${payload.sale_price.toFixed(2)} ر.س${posting.journalEntryId ? " وتم ترحيله محاسبيًا" : ""}.`,
      type: "accounting",
      link: "/accounting/commissions",
    });
  },
  "sim.sale_voided": async (event) => {
    const payload = simSaleEventPayload.parse(event.payload);
    const reversal = await autoReverseSimSale(
      createAdminClient(), event.org_id, await financeManagerUserId(event.org_id), payload.sale_id,
      payload.reason || "SIM sale voided",
      { commandId: event.business_event_id, requestId: event.business_event_id }
    );
    if (!reversal.success) throw new Error(reversal.error || "SIM sale accounting reversal failed.");
  },
  "sim.inventory_returned": async () => {},
  "sim.inventory_imported": async () => {},
  "sim.inventory_box_imported": async () => {},
  "sim.inventory_assigned": async () => {},
  "sim.inventory_assigned_to_merchant": async () => {},
  "commission.settlement_posted": async (event) => {
    const payload = commissionSettlementPayload.parse(event.payload);
    await deliverNotifications({
      orgId: event.org_id,
      sourceEventId: event.business_event_id,
      userIds: await financeUserIds(event.org_id),
      title: "تم ترحيل تسوية عمولات",
      body: `تم سداد ${payload.commission_count} عمولة بإجمالي ${payload.total_amount.toFixed(2)} ر.س وربطها بالدفع والقيد.`,
      type: "accounting",
      link: "/accounting/commissions",
    });
  },
};

export async function processOutboxBatch(workerId: string, batchSize = 25) {
  const events = await claimOutboxEvents(workerId, batchSize);
  const results = await Promise.all(events.map(async (event) => {
    const handler = handlers[event.topic];
    try {
      if (!handler) throw new Error(`No outbox handler is registered for topic ${event.topic}.`);
      await handler(event);
      await completeOutboxEvent(event, workerId);
      return { id: event.id, topic: event.topic, outcome: "completed" as const };
    } catch (error) {
      const updated = await failOutboxEvent(event, workerId, error);
      return {
        id: event.id,
        topic: event.topic,
        outcome: updated.status as "failed" | "dead_letter",
      };
    }
  }));

  return {
    claimed: events.length,
    completed: results.filter((result) => result.outcome === "completed").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    deadLettered: results.filter((result) => result.outcome === "dead_letter").length,
    results,
  };
}

export function outboxNotificationPayload(values: z.input<typeof notificationPayload>): Json {
  return notificationPayload.parse(values) as Json;
}
