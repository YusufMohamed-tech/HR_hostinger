import "server-only";

import crypto from "node:crypto";

const executableExtensions = new Set([
  "exe", "dll", "com", "scr", "msi", "jar", "apk", "app", "dmg", "iso",
  "js", "mjs", "cjs", "html", "htm", "svg", "php", "phar", "sh", "bash", "zsh",
  "bat", "cmd", "ps1", "vbs", "wsf", "py", "rb", "pl",
]);

const officeZipTypes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export class UploadSecurityError extends Error {
  constructor(message: string, readonly code: "invalid" | "malware" | "scanner_unavailable") {
    super(message);
    this.name = "UploadSecurityError";
  }
}

function extension(name: string) {
  return name.trim().toLowerCase().split(".").pop() || "";
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedMime(bytes: Uint8Array, claimed: string) {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return officeZipTypes.has(claimed) ? claimed : "application/zip";
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return claimed === "video/webm" ? claimed : "application/octet-stream";
  if (startsWith(bytes, [0x00, 0x00, 0x00]) && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return "video/mp4";
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  if (![...sample].some((value) => value === 0)) return "text/plain";
  return "application/octet-stream";
}

async function remoteScan(file: File, bytes: Uint8Array, sha256: string) {
  const scanUrl = process.env.MALWARE_SCAN_URL?.trim();
  const production = process.env.NODE_ENV === "production";
  if (!scanUrl) {
    if (production) {
      throw new UploadSecurityError("Malware scanning is not configured; upload was blocked.", "scanner_unavailable");
    }
    return { engine: "development-signature-gate", scannedAt: new Date().toISOString() };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(scanUrl, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-file-sha256": sha256,
        ...(process.env.MALWARE_SCAN_TOKEN ? { authorization: `Bearer ${process.env.MALWARE_SCAN_TOKEN}` } : {}),
      },
      body: Uint8Array.from(bytes).buffer,
      signal: controller.signal,
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as { clean?: boolean; engine?: string; signature?: string };
    if (!response.ok) throw new UploadSecurityError("Malware scanner was unavailable; upload was blocked.", "scanner_unavailable");
    if (result.clean !== true) {
      throw new UploadSecurityError(`Unsafe file was rejected${result.signature ? ` (${result.signature})` : ""}.`, "malware");
    }
    return { engine: result.engine || "remote", scannedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof UploadSecurityError) throw error;
    throw new UploadSecurityError("Malware scanner was unavailable; upload was blocked.", "scanner_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectUpload(file: File, options: { allowedMimeTypes: ReadonlySet<string>; maxBytes: number }) {
  if (!file.name.trim() || file.size <= 0 || file.size > options.maxBytes) {
    throw new UploadSecurityError("File is empty or exceeds the allowed size.", "invalid");
  }
  if (executableExtensions.has(extension(file.name))) {
    throw new UploadSecurityError("Executable or active-content files are not allowed.", "invalid");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const claimedMime = file.type.trim().toLowerCase();
  const actualMime = detectedMime(bytes, claimedMime);
  if (!options.allowedMimeTypes.has(claimedMime) || !options.allowedMimeTypes.has(actualMime)) {
    throw new UploadSecurityError("File content does not match an allowed file type.", "invalid");
  }
  const textSample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 8192))).toLowerCase();
  if (textSample.includes("eicar-standard-antivirus-test-file") || textSample.includes("<script") || textSample.includes("<?php")) {
    throw new UploadSecurityError("Unsafe active content was rejected.", "malware");
  }
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const scan = await remoteScan(file, bytes, sha256);
  return { bytes, sha256, detectedMime: actualMime, scanStatus: "clean" as const, ...scan };
}

export async function removeUploadedPaths(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  bucket: string,
  paths: string[]
) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const result = await admin.storage.from(bucket).remove(unique);
  if (result.error) throw new Error(`Unable to clean uploaded files: ${result.error.message}`);
}
