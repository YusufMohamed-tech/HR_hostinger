import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestIdFromHeaders } from "@/lib/request-id";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.OUTBOX_WORKER_SECRET?.trim() ?? "";
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/iu, "")
    .trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return unauthorized();
  const requestId = requestIdFromHeaders(request.headers);
  const admin = createAdminClient();
  // Generated Supabase types intentionally lag the forward-only inventory migrations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recognitionWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const approvalOverdueBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const deliveryOverdueBefore = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const lowConfidenceAlertThreshold = 10;

  try {
    const [
      outboxPending,
      outboxProcessing,
      outboxFailed,
      outboxDeadLetter,
      overdueOutbox,
      failedPostings,
      pendingPostings,
      overduePostings,
      staleReceiptCommands,
      staleWorkbookCommands,
      stalePhotoCommands,
      staleCustodyCommands,
      overdueReturnApprovals,
      overdueReturnDeliveries,
      failedReturnDamageAccounting,
      overdueReturnDamageAccounting,
      staleRecognitionAnalyses,
      failedRecognitionAnalyses,
      lowConfidenceRecognitionAnalyses,
      overdueRecognitionSampleCleanup,
      oldestException,
      oldestReturnException,
      oldestRecognitionException,
    ] = await Promise.all([
      db.from("event_outbox").select("id", { head: true, count: "exact" })
        .like("topic", "product_inventory.%").eq("status", "pending"),
      db.from("event_outbox").select("id", { head: true, count: "exact" })
        .like("topic", "product_inventory.%").eq("status", "processing"),
      db.from("event_outbox").select("id", { head: true, count: "exact" })
        .like("topic", "product_inventory.%").eq("status", "failed"),
      db.from("event_outbox").select("id", { head: true, count: "exact" })
        .like("topic", "product_inventory.%").eq("status", "dead_letter"),
      db.from("event_outbox").select("id", { head: true, count: "exact" })
        .like("topic", "product_inventory.%")
        .in("status", ["pending", "failed"])
        .lt("available_at", staleBefore),
      db.from("product_inventory_accounting_postings")
        .select("id", { head: true, count: "exact" })
        .eq("status", "failed"),
      db.from("product_inventory_accounting_postings")
        .select("id", { head: true, count: "exact" })
        .in("status", ["pending", "pending_approval"]),
      db.from("product_inventory_accounting_postings")
        .select("id", { head: true, count: "exact" })
        .in("status", ["pending", "pending_approval"])
        .lt("updated_at", staleBefore),
      db.from("product_inventory_commands").select("id", { head: true, count: "exact" })
        .eq("status", "processing").lt("created_at", staleBefore),
      db.from("product_inventory_import_commands").select("id", { head: true, count: "exact" })
        .eq("status", "processing").lt("created_at", staleBefore),
      db.from("product_inventory_photo_commands").select("id", { head: true, count: "exact" })
        .eq("status", "processing").lt("created_at", staleBefore),
      db.from("product_inventory_custody_commands").select("id", { head: true, count: "exact" })
        .eq("status", "processing").lt("created_at", staleBefore),
      db.from("product_return_requests").select("id", { head: true, count: "exact" })
        .eq("status", "pending_approval").lt("submitted_at", approvalOverdueBefore),
      db.from("product_return_requests").select("id", { head: true, count: "exact" })
        .in("status", ["approved_awaiting_delivery", "partially_received"])
        .lt("approved_at", deliveryOverdueBefore),
      db.from("product_inventory_loss_records").select("id", { head: true, count: "exact" })
        .not("return_request_id", "is", null).eq("accounting_status", "failed"),
      db.from("product_inventory_loss_records").select("id", { head: true, count: "exact" })
        .not("return_request_id", "is", null)
        .in("accounting_status", ["pending", "pending_approval"])
        .lt("created_at", staleBefore),
      db.from("product_inventory_import_analyses").select("id", { head: true, count: "exact" })
        .eq("status", "analyzing").lt("updated_at", staleBefore),
      db.from("product_inventory_import_analyses").select("id", { head: true, count: "exact" })
        .eq("status", "failed").gte("updated_at", recognitionWindowStart),
      db.from("product_inventory_import_analyses").select("id", { head: true, count: "exact" })
        .in("status", ["needs_review", "ready"])
        .lt("confidence", 0.75).gte("created_at", recognitionWindowStart),
      db.from("managed_files").select("id", { head: true, count: "exact" })
        .eq("owner_type", "product_inventory_import_profile_sample")
        .in("deletion_status", ["active", "processing", "failed", "dead_letter"])
        .lt("retention_until", new Date().toISOString().slice(0, 10)),
      db.from("product_inventory_accounting_postings")
        .select("organization_id, source_type, source_id, status, attempt_count, updated_at")
        .in("status", ["failed", "pending", "pending_approval"])
        .order("updated_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db.from("product_return_requests")
        .select("organization_id, id, return_no, status, submitted_at, approved_at")
        .in("status", ["pending_approval", "approved_awaiting_delivery", "partially_received"])
        .order("submitted_at", { ascending: true }).limit(1).maybeSingle(),
      db.from("product_inventory_import_analyses")
        .select("organization_id, id, template_name, status, confidence, error_message, updated_at")
        .in("status", ["analyzing", "failed"])
        .order("updated_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const results = [
      outboxPending,
      outboxProcessing,
      outboxFailed,
      outboxDeadLetter,
      overdueOutbox,
      failedPostings,
      pendingPostings,
      overduePostings,
      staleReceiptCommands,
      staleWorkbookCommands,
      stalePhotoCommands,
      staleCustodyCommands,
      overdueReturnApprovals,
      overdueReturnDeliveries,
      failedReturnDamageAccounting,
      overdueReturnDamageAccounting,
      staleRecognitionAnalyses,
      failedRecognitionAnalyses,
      lowConfidenceRecognitionAnalyses,
      overdueRecognitionSampleCleanup,
      oldestException,
      oldestReturnException,
      oldestRecognitionException,
    ];
    const failedQuery = results.find((result) => result.error);
    if (failedQuery?.error) throw new Error(failedQuery.error.message);

    const staleCommands = (staleReceiptCommands.count ?? 0)
      + (staleWorkbookCommands.count ?? 0)
      + (stalePhotoCommands.count ?? 0)
      + (staleCustodyCommands.count ?? 0);
    const checks = {
      dead_letter_events: outboxDeadLetter.count ?? 0,
      overdue_events: overdueOutbox.count ?? 0,
      failed_accounting_postings: failedPostings.count ?? 0,
      overdue_accounting_postings: overduePostings.count ?? 0,
      stale_commands: staleCommands,
      overdue_return_approvals: overdueReturnApprovals.count ?? 0,
      overdue_return_deliveries: overdueReturnDeliveries.count ?? 0,
      failed_return_damage_accounting: failedReturnDamageAccounting.count ?? 0,
      overdue_return_damage_accounting: overdueReturnDamageAccounting.count ?? 0,
      stale_recognition_analyses: staleRecognitionAnalyses.count ?? 0,
      failed_recognition_analyses: failedRecognitionAnalyses.count ?? 0,
      overdue_recognition_sample_cleanup: overdueRecognitionSampleCleanup.count ?? 0,
      excess_low_confidence_analyses: Math.max(
        0,
        (lowConfidenceRecognitionAnalyses.count ?? 0) - lowConfidenceAlertThreshold
      ),
    };
    const healthy = Object.values(checks).every((count) => count === 0);
    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        checked_at: new Date().toISOString(),
        thresholds: {
          command_stale_after_minutes: 15,
          overdue_event_after_minutes: 15,
          overdue_accounting_after_minutes: 15,
          return_approval_overdue_after_hours: 24,
          return_delivery_overdue_after_hours: 48,
          recognition_stale_after_minutes: 15,
          recognition_failure_window_hours: 24,
          low_confidence_analyses_per_day: lowConfidenceAlertThreshold,
        },
        checks,
        queue: {
          pending: outboxPending.count ?? 0,
          processing: outboxProcessing.count ?? 0,
          failed: outboxFailed.count ?? 0,
          dead_letter: outboxDeadLetter.count ?? 0,
        },
        accounting: {
          pending: pendingPostings.count ?? 0,
          overdue: overduePostings.count ?? 0,
          failed: failedPostings.count ?? 0,
          oldest_exception: oldestException.data ?? null,
        },
        returns: {
          overdue_approvals: overdueReturnApprovals.count ?? 0,
          overdue_deliveries: overdueReturnDeliveries.count ?? 0,
          failed_damage_accounting: failedReturnDamageAccounting.count ?? 0,
          overdue_damage_accounting: overdueReturnDamageAccounting.count ?? 0,
          oldest_open_request: oldestReturnException.data ?? null,
        },
        workbook_recognition: {
          stale: staleRecognitionAnalyses.count ?? 0,
          failed_last_24_hours: failedRecognitionAnalyses.count ?? 0,
          low_confidence_last_24_hours: lowConfidenceRecognitionAnalyses.count ?? 0,
          overdue_sample_cleanup: overdueRecognitionSampleCleanup.count ?? 0,
          oldest_exception: oldestRecognitionException.data ?? null,
        },
        requestId,
      },
      {
        status: healthy ? 200 : 503,
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      }
    );
  } catch (error) {
    console.error("Product inventory health check failed", { requestId, error });
    return NextResponse.json(
      {
        status: "failed",
        message: "Unable to inspect product inventory health.",
        requestId,
      },
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      }
    );
  }
}
