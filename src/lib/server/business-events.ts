import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashEventPayload } from "@/lib/event-payload";
import type { BusinessEventStatus, Database, Json, OrgRole } from "@/types/database";

type BusinessEvent = Database["public"]["Tables"]["business_events"]["Row"];
type OutboxEvent = Database["public"]["Tables"]["event_outbox"]["Row"];

export class IdempotencyConflictError extends Error {
  constructor(message = "The idempotency key was already used with a different payload.") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class BusinessEventStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessEventStateError";
  }
}

function requiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000);
}

export async function createBusinessEvent(values: {
  orgId: string;
  sourceType: string;
  businessKey: string;
  payload: Json;
  requestId?: string | null;
  correlationId?: string | null;
  actorUserId?: string | null;
  eventVersion?: number;
  occurredAt?: string;
}): Promise<{ event: BusinessEvent; replayed: boolean }> {
  const admin = createAdminClient();
  const sourceType = requiredText(values.sourceType, "sourceType");
  const businessKey = requiredText(values.businessKey, "businessKey");
  const payloadHash = hashEventPayload(values.payload);
  const { data, error } = await admin
    .from("business_events")
    .insert({
      org_id: values.orgId,
      source_type: sourceType,
      business_key: businessKey,
      event_version: values.eventVersion ?? 1,
      payload: values.payload,
      payload_hash: payloadHash,
      request_id: values.requestId ?? null,
      correlation_id: values.correlationId ?? null,
      actor_user_id: values.actorUserId ?? null,
      occurred_at: values.occurredAt,
    })
    .select("*")
    .single();

  if (!error && data) return { event: data, replayed: false };
  if (error?.code !== "23505") {
    throw new Error(`Unable to create business event: ${error?.message ?? "Unknown error"}`);
  }

  const existingResult = await admin
    .from("business_events")
    .select("*")
    .eq("org_id", values.orgId)
    .eq("source_type", sourceType)
    .eq("business_key", businessKey)
    .single();

  if (existingResult.error || !existingResult.data) {
    throw new Error(`Unable to load idempotent business event: ${existingResult.error?.message ?? "Not found"}`);
  }
  if (existingResult.data.payload_hash !== payloadHash) throw new IdempotencyConflictError();

  return { event: existingResult.data, replayed: true };
}

export async function claimBusinessEvent(orgId: string, eventId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_business_event", {
    target_event_id: eventId,
    target_org_id: orgId,
  });
  if (error) throw new Error(`Unable to claim business event: ${error.message}`);
  const event = data?.[0];
  if (!event) throw new BusinessEventStateError("Business event is already being processed or is terminal.");
  return event;
}

export async function completeBusinessEvent(orgId: string, eventId: string) {
  return updateBusinessEventStatus(orgId, eventId, "completed");
}

export async function failBusinessEvent(
  orgId: string,
  eventId: string,
  error: unknown,
  deadLetter = false
) {
  return updateBusinessEventStatus(orgId, eventId, deadLetter ? "dead_letter" : "failed", error);
}

async function updateBusinessEventStatus(
  orgId: string,
  eventId: string,
  status: Extract<BusinessEventStatus, "completed" | "failed" | "dead_letter">,
  error?: unknown
) {
  const admin = createAdminClient();
  const terminal = status === "completed" || status === "dead_letter";
  const { data, error: updateError } = await admin
    .from("business_events")
    .update({
      status,
      last_error: error === undefined ? null : messageFor(error),
      processed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", eventId)
    .eq("org_id", orgId)
    .eq("status", "processing")
    .select("*")
    .maybeSingle();

  if (updateError) throw new Error(`Unable to update business event: ${updateError.message}`);
  if (!data) throw new BusinessEventStateError("Business event is not in the processing state.");
  return data;
}

export async function enqueueOutboxEvent(values: {
  orgId: string;
  businessEventId: string;
  topic: string;
  payload: Json;
  availableAt?: string;
}): Promise<{ outboxEvent: OutboxEvent; replayed: boolean }> {
  const admin = createAdminClient();
  const topic = requiredText(values.topic, "topic");
  const payloadHash = hashEventPayload(values.payload);
  const { data, error } = await admin
    .from("event_outbox")
    .insert({
      org_id: values.orgId,
      business_event_id: values.businessEventId,
      topic,
      payload: values.payload,
      payload_hash: payloadHash,
      available_at: values.availableAt,
    })
    .select("*")
    .single();

  if (!error && data) return { outboxEvent: data, replayed: false };
  if (error?.code !== "23505") {
    throw new Error(`Unable to enqueue outbox event: ${error?.message ?? "Unknown error"}`);
  }

  const existingResult = await admin
    .from("event_outbox")
    .select("*")
    .eq("business_event_id", values.businessEventId)
    .eq("topic", topic)
    .single();
  if (existingResult.error || !existingResult.data) {
    throw new Error(`Unable to load idempotent outbox event: ${existingResult.error?.message ?? "Not found"}`);
  }
  if (existingResult.data.org_id !== values.orgId || existingResult.data.payload_hash !== payloadHash) {
    throw new IdempotencyConflictError("The outbox topic was already used with a different payload or tenant.");
  }

  return { outboxEvent: existingResult.data, replayed: true };
}

export async function claimOutboxEvents(workerId: string, batchSize = 25) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_event_outbox", {
    worker_id: requiredText(workerId, "workerId"),
    batch_size: Math.min(Math.max(Math.trunc(batchSize), 1), 100),
  });
  if (error) throw new Error(`Unable to claim outbox events: ${error.message}`);
  return data ?? [];
}

export async function completeOutboxEvent(event: OutboxEvent, workerId: string) {
  return updateOutboxEvent(event, workerId, "completed");
}

export async function failOutboxEvent(event: OutboxEvent, workerId: string, error: unknown) {
  const terminal = event.attempts >= 10;
  return updateOutboxEvent(event, workerId, terminal ? "dead_letter" : "failed", error);
}

async function updateOutboxEvent(
  event: OutboxEvent,
  workerId: string,
  status: Extract<BusinessEventStatus, "completed" | "failed" | "dead_letter">,
  error?: unknown
) {
  const admin = createAdminClient();
  const completed = status === "completed";
  const retryDelaySeconds = Math.min(2 ** Math.max(event.attempts, 1) * 15, 3600);
  const { data, error: updateError } = await admin
    .from("event_outbox")
    .update({
      status,
      last_error: error === undefined ? null : messageFor(error),
      sent_at: completed ? new Date().toISOString() : null,
      available_at: status === "failed"
        ? new Date(Date.now() + retryDelaySeconds * 1000).toISOString()
        : event.available_at,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", event.id)
    .eq("org_id", event.org_id)
    .eq("status", "processing")
    .eq("locked_by", workerId)
    .eq("attempts", event.attempts)
    .select("*")
    .maybeSingle();

  if (updateError) throw new Error(`Unable to update outbox event: ${updateError.message}`);
  if (!data) throw new BusinessEventStateError("Outbox event lock is no longer owned by this worker.");
  return data;
}

export async function recordOperationalAudit(values: {
  orgId?: string | null;
  requestId: string;
  correlationId?: string | null;
  actorUserId?: string | null;
  actorRole?: OrgRole | "superadmin" | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "success" | "denied" | "failed";
  statusCode?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  metadata?: Json;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("operational_audit_logs").insert({
    org_id: values.orgId ?? null,
    request_id: values.requestId,
    correlation_id: values.correlationId ?? null,
    actor_user_id: values.actorUserId ?? null,
    actor_role: values.actorRole ?? null,
    action: requiredText(values.action, "action"),
    target_type: values.targetType ?? null,
    target_id: values.targetId ?? null,
    outcome: values.outcome,
    status_code: values.statusCode ?? null,
    duration_ms: values.durationMs ?? null,
    error_code: values.errorCode ?? null,
    metadata: values.metadata ?? {},
  });
  if (error) throw new Error(`Unable to record operational audit log: ${error.message}`);
}
