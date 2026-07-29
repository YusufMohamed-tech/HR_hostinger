import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkHostingerFileStorage,
  createObjectAccessUrl,
  downloadObject,
  removeObjects,
  storeObject,
  verifyObjectAccess,
} from "../src/lib/server/file-storage-core";

const unavailableSupabase = {
  storage: {
    from() {
      throw new Error("Supabase must not be used by the Hostinger filesystem test.");
    },
  },
};

test("Hostinger filesystem stores, signs, reads, and removes private objects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hrms-file-storage-"));
  const previousRoot = process.env.HOSTINGER_FILE_STORAGE_ROOT;
  const previousSecret = process.env.FILE_ACCESS_SIGNING_SECRET;
  process.env.HOSTINGER_FILE_STORAGE_ROOT = root;
  process.env.FILE_ACCESS_SIGNING_SECRET = "test-file-access-secret-with-at-least-32-characters";
  try {
    const bytes = new TextEncoder().encode("stored-on-hostinger");
    const stored = await storeObject(unavailableSupabase as never, {
      bucket: "personnel-files",
      path: "org/employee/document.txt",
      bytes,
      contentType: "text/plain",
    });
    assert.equal(stored.provider, "hostinger_filesystem");
    assert.deepEqual(await checkHostingerFileStorage(), {
      provider: "hostinger_filesystem",
      root,
    });
    assert.equal(
      new TextDecoder().decode(await readFile(path.join(root, "personnel-files/org/employee/document.txt"))),
      "stored-on-hostinger",
    );
    assert.deepEqual(await downloadObject(
      unavailableSupabase as never,
      "personnel-files",
      "org/employee/document.txt",
    ), bytes);

    const signedUrl = new URL(
      createObjectAccessUrl("personnel-files", "org/employee/document.txt", {
        expiresIn: 300,
        downloadName: "document.txt",
      }),
      "https://hr.example.test",
    );
    assert.equal(verifyObjectAccess({
      bucket: signedUrl.searchParams.get("bucket") || "",
      path: signedUrl.searchParams.get("path") || "",
      expires: signedUrl.searchParams.get("expires") || "",
      signature: signedUrl.searchParams.get("signature") || "",
      downloadName: signedUrl.searchParams.get("download"),
    }), true);

    await removeObjects(
      unavailableSupabase as never,
      "personnel-files",
      ["org/employee/document.txt"],
    );
    await assert.rejects(readFile(path.join(root, "personnel-files/org/employee/document.txt")));
  } finally {
    if (previousRoot === undefined) delete process.env.HOSTINGER_FILE_STORAGE_ROOT;
    else process.env.HOSTINGER_FILE_STORAGE_ROOT = previousRoot;
    if (previousSecret === undefined) delete process.env.FILE_ACCESS_SIGNING_SECRET;
    else process.env.FILE_ACCESS_SIGNING_SECRET = previousSecret;
    await rm(root, { recursive: true, force: true });
  }
});

test("Hostinger filesystem rejects path traversal", async () => {
  const previousRoot = process.env.HOSTINGER_FILE_STORAGE_ROOT;
  process.env.HOSTINGER_FILE_STORAGE_ROOT = path.join(os.tmpdir(), "hrms-file-storage-traversal");
  try {
    await assert.rejects(
      storeObject(unavailableSupabase as never, {
        bucket: "personnel-files",
        path: "../escape.txt",
        bytes: new Uint8Array([1]),
        contentType: "application/octet-stream",
      }),
      /invalid/iu,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.HOSTINGER_FILE_STORAGE_ROOT;
    else process.env.HOSTINGER_FILE_STORAGE_ROOT = previousRoot;
  }
});
