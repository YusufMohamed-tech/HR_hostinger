import { createAdminClient } from "@/lib/supabase/admin";

export interface CarrierVerificationRunResult {
  id: string;
  import_id: string;
  run_version: number;
  status: "processing" | "completed" | "failed";
  checked_count: number;
  discrepancy_count: number;
  error_message: string | null;
  source_cutoff: string;
}

export async function runVerification(
  orgId: string,
  importId: string,
  actorUserId: string,
  requestId: string
): Promise<CarrierVerificationRunResult> {
  // The Carrier RPCs are newer than the generated client declaration in some deployments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin.rpc("run_carrier_verification", {
    p_org_id: orgId,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
    p_import_id: importId,
  });
  if (error) throw new Error(error.message);
  const run = (Array.isArray(data) ? data[0] : data) as CarrierVerificationRunResult | null;
  if (!run) throw new Error("Carrier verification returned no run record.");
  if (run.status !== "completed") throw new Error(run.error_message || "Carrier verification failed.");
  return run;
}
