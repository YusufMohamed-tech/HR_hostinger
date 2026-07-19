import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export type ComplianceJobResult = {
  runId: string;
  alertsEnqueued: number;
  completedAt: string;
};

export async function enqueueComplianceAlerts(values: {
  runId?: string;
  requestId?: string;
  now?: string;
} = {}) {
  const runId = values.runId || crypto.randomUUID();
  const requestId = values.requestId || crypto.randomUUID();
  const result = await (createAdminClient() as unknown as RpcClient).rpc("enqueue_compliance_alerts", {
    p_run_id: runId,
    p_request_id: requestId,
    p_now: values.now || new Date().toISOString(),
  });
  if (result.error) throw new Error(`Compliance job failed: ${result.error.message}`);
  return result.data as ComplianceJobResult;
}
