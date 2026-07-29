import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { deleteManagedFile } from "@/lib/server/personnel-storage";

type ManagedFile = {
  id: string;
  bucket_id: string;
  storage_path: string;
  storage_provider?: string | null;
  storage_container?: string | null;
  storage_version?: string | null;
  deletion_attempts: number;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function rpc(admin: ReturnType<typeof createAdminClient>, name: string, args: Record<string, unknown>) {
  return (admin as unknown as RpcClient).rpc(name, args);
}

export async function processFileRetentionBatch(workerId: string, batchSize = 25) {
  const admin = createAdminClient();
  const claimed = await rpc(admin, "claim_managed_file_retention", {
    p_worker_id: workerId,
    p_batch_size: Math.min(Math.max(Math.trunc(batchSize), 1), 100),
    p_as_of: new Date().toISOString().slice(0, 10),
  });
  if (claimed.error) throw new Error(`Unable to claim retained files: ${claimed.error.message}`);
  const files = (claimed.data || []) as ManagedFile[];
  const results = [] as Array<{ id: string; outcome: "deleted" | "failed" | "dead_letter" }>;
  for (const file of files) {
    try {
      await deleteManagedFile(admin, file);
      const completed = await rpc(admin, "complete_managed_file_retention", {
        p_file_id: file.id,
        p_worker_id: workerId,
      });
      if (completed.error) throw new Error(completed.error.message);
      results.push({ id: file.id, outcome: "deleted" });
    } catch (error) {
      const failed = await rpc(admin, "fail_managed_file_retention", {
        p_file_id: file.id,
        p_worker_id: workerId,
        p_error: error instanceof Error ? error.message : "Unknown deletion error",
      });
      if (failed.error) throw new Error(`Unable to record file-retention failure: ${failed.error.message}`);
      const row = ((failed.data || []) as Array<{ deletion_status?: string }>)[0];
      results.push({ id: file.id, outcome: row?.deletion_status === "dead_letter" ? "dead_letter" : "failed" });
    }
  }
  return {
    claimed: files.length,
    deleted: results.filter((item) => item.outcome === "deleted").length,
    failed: results.filter((item) => item.outcome === "failed").length,
    deadLettered: results.filter((item) => item.outcome === "dead_letter").length,
    results,
  };
}
