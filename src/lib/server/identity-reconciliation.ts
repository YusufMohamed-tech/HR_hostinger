import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function armIdentityDeletion(
  admin: AdminClient,
  values: {
    orgId: string;
    userId: string;
    sourceType: string;
    sourceId: string;
    reason: string;
    actorUserId?: string | null;
    requestId?: string | null;
    delaySeconds?: number;
  }
) {
  const { data, error } = await admin.rpc("enqueue_identity_auth_sync_job", {
    p_org_id: values.orgId,
    p_target_user_id: values.userId,
    p_action: "delete",
    p_source_type: values.sourceType,
    p_source_id: values.sourceId,
    p_reason: values.reason,
    p_actor_user_id: values.actorUserId || null,
    p_request_id: values.requestId || null,
    p_delay_seconds: values.delaySeconds ?? 600,
  });
  if (error) throw new Error(`Unable to arm identity cleanup: ${error.message}`);
  const jobId = String(record(data).id || "");
  if (!jobId) throw new Error("Identity cleanup command returned no job id.");
  return jobId;
}

export async function cancelIdentityDeletion(admin: AdminClient, jobId: string, reason: string) {
  const { error } = await admin.rpc("cancel_identity_auth_sync_job", {
    p_job_id: jobId,
    p_reason: reason,
  });
  if (error) throw new Error(`Unable to cancel identity cleanup: ${error.message}`);
}

export async function queueIdentityDeletion(
  admin: AdminClient,
  values: Omit<Parameters<typeof armIdentityDeletion>[1], "delaySeconds">
) {
  return armIdentityDeletion(admin, { ...values, delaySeconds: 0 });
}
