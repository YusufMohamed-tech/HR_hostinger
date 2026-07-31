import "server-only";

import { processOutboxBatch } from "@/lib/server/outbox-worker";
import { enqueueComplianceAlerts } from "@/lib/server/compliance-jobs";
import { processFileRetentionBatch } from "@/lib/server/file-retention";

let started = false;

function runOutbox() {
  processOutboxBatch(`scheduler:outbox:${Date.now()}`, 50).catch((error) => {
    console.error("[scheduler] outbox batch failed", error instanceof Error ? error.message : error);
  });
}

function runCompliance() {
  enqueueComplianceAlerts({ requestId: `scheduler:compliance:${Date.now()}` }).catch((error) => {
    console.error("[scheduler] compliance alerts failed", error instanceof Error ? error.message : error);
  });
}

function runFileRetention() {
  processFileRetentionBatch(`scheduler:retention:${Date.now()}`, 25).catch((error) => {
    console.error("[scheduler] file retention failed", error instanceof Error ? error.message : error);
  });
}

export function startBackgroundScheduler() {
  if (started) return;
  started = true;

  console.log("[scheduler] Background scheduler started");

  // Process outbox every 30 seconds
  setInterval(runOutbox, 30_000);

  // Process compliance alerts every hour
  setInterval(runCompliance, 3_600_000);

  // Process file retention every 6 hours
  setInterval(runFileRetention, 21_600_000);

  // Run outbox immediately on startup after a short delay
  setTimeout(runOutbox, 5_000);
}
