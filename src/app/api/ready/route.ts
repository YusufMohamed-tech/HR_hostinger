import { NextRequest, NextResponse } from "next/server";
import schemaVersion from "@/lib/schema-version.json";
import { validateRuntimeConfiguration } from "@/lib/runtime-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const configuration = validateRuntimeConfiguration();
  let databaseReady = false;
  let migrationsReady = false;

  if (configuration.ready) {
    try {
      const admin = createAdminClient();
      const [database, migration] = await Promise.all([
        admin
          .from("organizations")
          .select("id", { head: true, count: "exact" })
          .abortSignal(AbortSignal.timeout(3_000)),
        admin
          .from("schema_migrations")
          .select("id,file_path,checksum_sha256")
          .eq("id", schemaVersion.id)
          .abortSignal(AbortSignal.timeout(3_000))
          .maybeSingle(),
      ]);
      databaseReady = !database.error;
      migrationsReady = !migration.error
        && migration.data?.id === schemaVersion.id
        && migration.data.file_path === schemaVersion.file
        && migration.data.checksum_sha256 === schemaVersion.checksumSha256;
      if (database.error) {
        console.error("Readiness database check failed", { requestId, code: database.error.code });
      }
      if (migration.error || !migrationsReady) {
        console.error("Readiness migration check failed", {
          requestId,
          code: migration.error?.code,
          expectedHead: schemaVersion.id,
        });
      }
    } catch (error) {
      console.error("Readiness dependency check threw", {
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else {
    console.error("Readiness configuration check failed", {
      requestId,
      issues: configuration.issues,
    });
  }

  const ready = configuration.ready && databaseReady && migrationsReady;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        configuration: configuration.ready ? "ok" : "failed",
        database: databaseReady ? "ok" : "failed",
        migrations: migrationsReady ? "ok" : "failed",
      },
      schemaHead: schemaVersion.id,
      time: new Date().toISOString(),
      requestId,
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    }
  );
}
