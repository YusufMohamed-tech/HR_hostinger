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
      oldestException,
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
      db.from("product_inventory_accounting_postings")
        .select("organization_id, source_type, source_id, status, attempt_count, updated_at")
        .in("status", ["failed", "pending", "pending_approval"])
        .order("updated_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
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
      oldestException,
    ];
    const failedQuery = results.find((result) => result.error);
    if (failedQuery?.error) throw new Error(failedQuery.error.message);

    const staleCommands = (staleReceiptCommands.count ?? 0)
      + (staleWorkbookCommands.count ?? 0)
      + (stalePhotoCommands.count ?? 0);
    const checks = {
      dead_letter_events: outboxDeadLetter.count ?? 0,
      overdue_events: overdueOutbox.count ?? 0,
      failed_accounting_postings: failedPostings.count ?? 0,
      overdue_accounting_postings: overduePostings.count ?? 0,
      stale_commands: staleCommands,
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
