import { NextRequest, NextResponse } from "next/server";
import schemaVersion from "@/lib/schema-version.json";
import { validateRuntimeConfiguration } from "@/lib/runtime-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestIdFromHeaders } from "@/lib/request-id";
import {
  checkPersonnelStorage,
} from "@/lib/server/personnel-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const configuration = validateRuntimeConfiguration();
  let databaseReady = false;
  let migrationsReady = false;
  let personnelStorageReady = false;

  if (configuration.ready) {
    try {
      const admin = createAdminClient();
      const [database, migration, personnelStorage] = await Promise.all([
        admin
          .from("organizations")
          .select("id", { head: true, count: "exact" })
          .abortSignal(AbortSignal.timeout(3_000)),
        admin
          .from("schema_migrations")
          .select("*")
          .eq("id", schemaVersion.id)
          .abortSignal(AbortSignal.timeout(3_000))
          .maybeSingle(),
        checkPersonnelStorage(admin)
          .then(() => ({ error: null }))
          .catch((error: unknown) => ({ error })),
      ]);
      databaseReady = !database.error;
      const migrationData = migration.data as (typeof migration.data & {
        file?: string;
        checksum?: string;
      }) | null;
      const migrationFile = migrationData?.file_path ?? migrationData?.file;
      const migrationChecksum = migrationData?.checksum_sha256 ?? migrationData?.checksum;
      migrationsReady = !migration.error
        && migration.data?.id === schemaVersion.id
        && migrationFile === schemaVersion.file
        && migrationChecksum === schemaVersion.checksumSha256;
      personnelStorageReady = !personnelStorage.error;
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
      if (personnelStorage.error) {
        console.error("Readiness personnel storage check failed", {
          requestId,
          error: personnelStorage.error instanceof Error ? personnelStorage.error.message : "Unknown error",
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

  const ready = configuration.ready && databaseReady && migrationsReady && personnelStorageReady;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        configuration: configuration.ready ? "ok" : "failed",
        database: databaseReady ? "ok" : "failed",
        migrations: migrationsReady ? "ok" : "failed",
        personnelStorage: personnelStorageReady ? "ok" : "failed",
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
