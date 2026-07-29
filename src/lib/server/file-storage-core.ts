import crypto from "node:crypto";
import {
  access,
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const bucketPattern = /^[a-z0-9][a-z0-9-]{1,62}$/u;
const maximumPathLength = 1600;

type StorageAdmin = {
  storage: {
    from: (bucket: string) => {
      upload: (
        objectPath: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean; cacheControl?: string },
      ) => Promise<{
        data: { path?: string } | null;
        error: { message: string; statusCode?: string | number } | null;
      }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
      download: (objectPath: string) => Promise<{
        data: Blob | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export class StoredObjectConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = "A file already exists at this storage path.") {
    super(message);
    this.name = "StoredObjectConflictError";
  }
}

function configuredRoot() {
  const root = process.env.HOSTINGER_FILE_STORAGE_ROOT?.trim();
  if (!root) return null;
  if (!path.isAbsolute(root)) {
    throw new Error("HOSTINGER_FILE_STORAGE_ROOT must be an absolute path.");
  }
  return path.resolve(root);
}

export function hostingerFileStorageIsConfigured() {
  return Boolean(process.env.HOSTINGER_FILE_STORAGE_ROOT?.trim());
}

function validatedBucket(bucket: string) {
  const value = bucket.trim();
  if (!bucketPattern.test(value)) throw new Error("Storage bucket is invalid.");
  return value;
}

function validatedObjectPath(objectPath: string) {
  const value = objectPath.trim().replaceAll("\\", "/");
  if (!value || value.length > maximumPathLength || value.startsWith("/") || value.includes("\0")) {
    throw new Error("Storage object path is invalid.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Storage object path is invalid.");
  }
  return segments.join("/");
}

function filesystemPath(bucket: string, objectPath: string) {
  const root = configuredRoot();
  if (!root) throw new Error("Hostinger filesystem storage is not configured.");
  const safeBucket = validatedBucket(bucket);
  const safeObjectPath = validatedObjectPath(objectPath);
  const candidate = path.resolve(root, safeBucket, ...safeObjectPath.split("/"));
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Storage object path escapes the configured root.");
  }
  return candidate;
}

function isMissing(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT"
  );
}

function isExisting(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "EEXIST"
  );
}

async function writeFilesystemObject(
  bucket: string,
  objectPath: string,
  bytes: Uint8Array,
  upsert: boolean,
) {
  const target = filesystemPath(bucket, objectPath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!upsert) {
    try {
      await access(target);
      throw new StoredObjectConflictError();
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const temporary = `${target}.${crypto.randomUUID()}.uploading`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (upsert) await rename(temporary, target);
    else {
      await link(temporary, target);
      await unlink(temporary);
    }
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (isExisting(error)) throw new StoredObjectConflictError();
    throw error;
  }
}

export async function storeObject(
  admin: StorageAdmin,
  values: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    contentType: string;
    upsert?: boolean;
    cacheControl?: string;
  },
) {
  const bucket = validatedBucket(values.bucket);
  const objectPath = validatedObjectPath(values.path);
  if (hostingerFileStorageIsConfigured()) {
    await writeFilesystemObject(bucket, objectPath, values.bytes, values.upsert === true);
    return {
      provider: "hostinger_filesystem" as const,
      bucket,
      path: objectPath,
    };
  }

  const uploaded = await admin.storage.from(bucket).upload(objectPath, values.bytes, {
    contentType: values.contentType,
    upsert: values.upsert === true,
    ...(values.cacheControl ? { cacheControl: values.cacheControl } : {}),
  });
  if (uploaded.error || !uploaded.data) {
    const duplicate = String(uploaded.error?.statusCode || "") === "409"
      || /duplicate|already exists/iu.test(uploaded.error?.message || "");
    if (duplicate) throw new StoredObjectConflictError();
    throw new Error(uploaded.error?.message || "File upload failed.");
  }
  return {
    provider: "supabase_storage" as const,
    bucket,
    path: uploaded.data.path || objectPath,
  };
}

export async function removeObjects(
  admin: StorageAdmin,
  bucketValue: string,
  paths: string[],
) {
  const bucket = validatedBucket(bucketValue);
  const unique = [...new Set(paths.filter(Boolean).map(validatedObjectPath))];
  if (unique.length === 0) return;
  if (hostingerFileStorageIsConfigured()) {
    await Promise.all(unique.map(async (objectPath) => {
      try {
        await unlink(filesystemPath(bucket, objectPath));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }));
    return;
  }
  const removed = await admin.storage.from(bucket).remove(unique);
  if (removed.error) throw new Error(removed.error.message);
}

export async function downloadObject(
  admin: StorageAdmin,
  bucketValue: string,
  objectPathValue: string,
) {
  const bucket = validatedBucket(bucketValue);
  const objectPath = validatedObjectPath(objectPathValue);
  if (hostingerFileStorageIsConfigured()) {
    try {
      return new Uint8Array(await readFile(filesystemPath(bucket, objectPath)));
    } catch (error) {
      if (!isMissing(error)) throw error;
      // Keep legacy Supabase objects readable during a verified, non-destructive
      // cutover. Production uploads still write only to Hostinger.
    }
  }
  const downloaded = await admin.storage.from(bucket).download(objectPath);
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || "Stored file could not be read.");
  }
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

function accessSecret() {
  const secret = process.env.FILE_ACCESS_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("FILE_ACCESS_SIGNING_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function accessPayload(values: {
  bucket: string;
  path: string;
  expires: number;
  downloadName: string;
}) {
  return ["v1", values.bucket, values.path, String(values.expires), values.downloadName].join("\n");
}

function accessSignature(values: {
  bucket: string;
  path: string;
  expires: number;
  downloadName: string;
}) {
  return crypto.createHmac("sha256", accessSecret()).update(accessPayload(values)).digest("base64url");
}

export function createObjectAccessUrl(
  bucketValue: string,
  objectPathValue: string,
  options: { expiresIn?: number; downloadName?: string | null } = {},
) {
  const bucket = validatedBucket(bucketValue);
  const objectPath = validatedObjectPath(objectPathValue);
  const expiresIn = Math.min(Math.max(Math.trunc(options.expiresIn || 600), 30), 86_400);
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const downloadName = (options.downloadName || "").replace(/[\r\n"]/gu, "_").slice(0, 180);
  const signature = accessSignature({ bucket, path: objectPath, expires, downloadName });
  const query = new URLSearchParams({
    bucket,
    path: objectPath,
    expires: String(expires),
    signature,
  });
  if (downloadName) query.set("download", downloadName);
  return `/api/files/object?${query.toString()}`;
}

export function verifyObjectAccess(values: {
  bucket: string;
  path: string;
  expires: string;
  signature: string;
  downloadName?: string | null;
}) {
  const bucket = validatedBucket(values.bucket);
  const objectPath = validatedObjectPath(values.path);
  const expires = Number(values.expires);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + 86_400) return false;
  const downloadName = (values.downloadName || "").replace(/[\r\n"]/gu, "_").slice(0, 180);
  const expected = accessSignature({ bucket, path: objectPath, expires, downloadName });
  const provided = Buffer.from(values.signature);
  const expectedBytes = Buffer.from(expected);
  return provided.length === expectedBytes.length && crypto.timingSafeEqual(provided, expectedBytes);
}

export function createPublicObjectUrl(bucketValue: string, objectPathValue: string) {
  const bucket = validatedBucket(bucketValue);
  const objectPath = validatedObjectPath(objectPathValue);
  return `/api/files/public?${new URLSearchParams({ bucket, path: objectPath }).toString()}`;
}

export function contentTypeForObject(objectPath: string) {
  const extension = path.extname(objectPath).toLowerCase();
  return ({
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

export async function checkHostingerFileStorage() {
  const root = configuredRoot();
  if (!root) throw new Error("Hostinger filesystem storage is not configured.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const probePath = filesystemPath("storage-probe", `${crypto.randomUUID()}.txt`);
  const probe = crypto.randomBytes(32);
  try {
    await writeFilesystemObject("storage-probe", path.basename(probePath), probe, false);
    const readBack = await readFile(probePath);
    if (!crypto.timingSafeEqual(probe, readBack)) {
      throw new Error("Hostinger filesystem storage integrity probe failed.");
    }
  } finally {
    await unlink(probePath).catch(() => undefined);
  }
  return { provider: "hostinger_filesystem" as const, root };
}

export async function verifyHostingerStorageMigration() {
  const root = configuredRoot();
  if (!root) throw new Error("Hostinger filesystem storage is not configured.");
  const manifestPath = path.resolve(root, "hostinger-storage-migration-manifest.json");
  if (!manifestPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Storage migration manifest path is invalid.");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    objectCount?: unknown;
    totalBytes?: unknown;
    objects?: unknown;
  };
  if (!Array.isArray(manifest.objects) || manifest.objects.length > 100_000) {
    throw new Error("Storage migration manifest is invalid.");
  }
  let totalBytes = 0;
  for (const entryValue of manifest.objects) {
    if (!entryValue || typeof entryValue !== "object") {
      throw new Error("Storage migration manifest contains an invalid object.");
    }
    const entry = entryValue as Record<string, unknown>;
    const bucket = validatedBucket(String(entry.bucket || ""));
    const objectPath = validatedObjectPath(String(entry.path || ""));
    const expectedSize = Number(entry.size);
    const expectedSha256 = String(entry.sha256 || "");
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
      throw new Error("Storage migration manifest contains invalid verification metadata.");
    }
    const bytes = await readFile(filesystemPath(bucket, objectPath));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== expectedSize || sha256 !== expectedSha256) {
      throw new Error(`Storage migration verification failed for ${bucket}/${objectPath}.`);
    }
    totalBytes += bytes.byteLength;
  }
  if (manifest.objectCount !== manifest.objects.length || manifest.totalBytes !== totalBytes) {
    throw new Error("Storage migration totals do not match the verified objects.");
  }
  return {
    provider: "hostinger_filesystem" as const,
    verifiedObjects: manifest.objects.length,
    verifiedBytes: totalBytes,
  };
}
