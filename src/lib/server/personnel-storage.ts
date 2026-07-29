import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectOutput,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
const personnelBucket = "personnel-files";

export type ManagedStorageObject = {
  storage_provider?: string | null;
  storage_container?: string | null;
  bucket_id: string;
  storage_path: string;
  storage_version?: string | null;
};

export type PersonnelUploadResult = {
  provider: "hostinger_s3" | "supabase_storage";
  bucket: string;
  path: string;
  version: string | null;
  etag: string | null;
  encryptionStatus: "sse_s3" | "sse_kms" | "provider_managed";
};

let hostingerClient: S3Client | null = null;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Hostinger personnel storage.`);
  return value;
}

function hostingerConfig() {
  const encryption = process.env.HOSTINGER_OBJECT_STORAGE_ENCRYPTION?.trim() || "AES256";
  if (!["AES256", "aws:kms"].includes(encryption)) {
    throw new Error("HOSTINGER_OBJECT_STORAGE_ENCRYPTION must be AES256 or aws:kms.");
  }
  return {
    endpoint: required("HOSTINGER_OBJECT_STORAGE_ENDPOINT"),
    region: process.env.HOSTINGER_OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    accessKeyId: required("HOSTINGER_OBJECT_STORAGE_ACCESS_KEY"),
    secretAccessKey: required("HOSTINGER_OBJECT_STORAGE_SECRET_KEY"),
    bucket: required("HOSTINGER_OBJECT_STORAGE_BUCKET"),
    encryption: encryption as ServerSideEncryption,
    kmsKeyId: process.env.HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID?.trim() || undefined,
    forcePathStyle: process.env.HOSTINGER_OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
  };
}

function client() {
  if (hostingerClient) return hostingerClient;
  const config = hostingerConfig();
  hostingerClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return hostingerClient;
}

export function personnelStorageIsConfigured() {
  return Boolean(
    process.env.HOSTINGER_OBJECT_STORAGE_ENDPOINT?.trim()
    && process.env.HOSTINGER_OBJECT_STORAGE_ACCESS_KEY?.trim()
    && process.env.HOSTINGER_OBJECT_STORAGE_SECRET_KEY?.trim()
    && process.env.HOSTINGER_OBJECT_STORAGE_BUCKET?.trim()
  );
}

export async function uploadPersonnelObject(values: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
}) {
  const config = hostingerConfig();
  const response = await client().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: values.key,
    Body: values.bytes,
    ContentType: values.contentType,
    Metadata: { sha256: values.sha256 },
    ServerSideEncryption: config.encryption,
    ...(config.encryption === "aws:kms" && config.kmsKeyId
      ? { SSEKMSKeyId: config.kmsKeyId }
      : {}),
  }));
  return {
    provider: "hostinger_s3",
    bucket: config.bucket,
    path: values.key,
    version: response.VersionId || null,
    etag: response.ETag?.replaceAll("\"", "") || null,
    encryptionStatus: config.encryption === "aws:kms" ? "sse_kms" : "sse_s3",
  } satisfies PersonnelUploadResult;
}

export async function storePersonnelObject(
  admin: AdminClient,
  values: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  },
) {
  if (personnelStorageIsConfigured()) return uploadPersonnelObject(values);

  const uploaded = await admin.storage.from(personnelBucket).upload(values.key, values.bytes, {
    contentType: values.contentType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error || !uploaded.data?.path) {
    throw new Error(uploaded.error?.message || "Supabase personnel storage upload failed.");
  }
  return {
    provider: "supabase_storage",
    bucket: personnelBucket,
    path: uploaded.data.path,
    version: null,
    etag: null,
    encryptionStatus: "provider_managed",
  } satisfies PersonnelUploadResult;
}

export async function deletePersonnelObject(object: ManagedStorageObject) {
  if ((object.storage_provider || "supabase_storage") !== "hostinger_s3") {
    throw new Error("deletePersonnelObject only accepts Hostinger objects.");
  }
  const bucket = object.storage_container?.trim() || hostingerConfig().bucket;
  await client().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: object.storage_path,
    ...(object.storage_version ? { VersionId: object.storage_version } : {}),
  }));
}

export async function deleteManagedFile(admin: AdminClient, object: ManagedStorageObject) {
  if ((object.storage_provider || "supabase_storage") === "hostinger_s3") {
    await deletePersonnelObject(object);
    return;
  }
  const removed = await admin.storage.from(object.bucket_id).remove([object.storage_path]);
  if (removed.error) throw new Error(removed.error.message);
}

export async function createManagedFileDownloadUrl(
  admin: AdminClient,
  object: ManagedStorageObject,
  originalName?: string | null
) {
  if ((object.storage_provider || "supabase_storage") === "hostinger_s3") {
    const bucket = object.storage_container?.trim() || hostingerConfig().bucket;
    const dispositionName = (originalName || "employee-document")
      .replace(/[\r\n"]/gu, "_")
      .slice(0, 180);
    return getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: bucket,
        Key: object.storage_path,
        ...(object.storage_version ? { VersionId: object.storage_version } : {}),
        ResponseCacheControl: "private, no-store, max-age=0",
        ResponseContentDisposition: `attachment; filename="${dispositionName}"`,
      }),
      { expiresIn: 60 }
    );
  }
  const signed = await admin.storage.from(object.bucket_id)
    .createSignedUrl(object.storage_path, 60, {
      download: originalName || true,
    });
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message || "Signed file access failed.");
  }
  return signed.data.signedUrl;
}

async function outputBytes(output: GetObjectOutput) {
  if (!output.Body) throw new Error("Hostinger object returned an empty body.");
  const body = output.Body as unknown as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (body.transformToByteArray) return body.transformToByteArray();
  return new Uint8Array(await new Response(output.Body as BodyInit).arrayBuffer());
}

export async function downloadManagedFileBytes(
  admin: AdminClient,
  object: ManagedStorageObject
) {
  if ((object.storage_provider || "supabase_storage") === "hostinger_s3") {
    const bucket = object.storage_container?.trim() || hostingerConfig().bucket;
    return outputBytes(await client().send(new GetObjectCommand({
      Bucket: bucket,
      Key: object.storage_path,
      ...(object.storage_version ? { VersionId: object.storage_version } : {}),
    })));
  }
  const downloaded = await admin.storage.from(object.bucket_id).download(object.storage_path);
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Legacy personnel file download failed.");
  }
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

export async function checkHostingerPersonnelStorage() {
  const config = hostingerConfig();
  await client().send(new HeadBucketCommand({ Bucket: config.bucket }));
  return { provider: "hostinger_s3" as const, bucket: config.bucket };
}

export async function checkPersonnelStorage(admin: AdminClient) {
  if (personnelStorageIsConfigured()) return checkHostingerPersonnelStorage();

  const bucket = await admin.storage.getBucket(personnelBucket);
  if (bucket.error || !bucket.data) {
    throw new Error(bucket.error?.message || "Supabase personnel storage is unavailable.");
  }
  if (bucket.data.public) {
    throw new Error("Supabase personnel storage bucket must remain private.");
  }
  return { provider: "supabase_storage" as const, bucket: personnelBucket };
}

export function resetPersonnelStorageClientForTests() {
  hostingerClient?.destroy();
  hostingerClient = null;
}
