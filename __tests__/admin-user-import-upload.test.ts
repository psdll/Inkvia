import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("resumable user import upload", () => {
  let tempDir = "";
  const previousImportsDir = process.env.IMPORTS_DIR;
  const previousMaxBytes = process.env.USER_IMPORT_MAX_BYTES;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "user-import-upload-"));
    process.env.IMPORTS_DIR = tempDir;
    delete process.env.USER_IMPORT_MAX_BYTES;
  });

  afterEach(async () => {
    if (previousImportsDir == null) delete process.env.IMPORTS_DIR;
    else process.env.IMPORTS_DIR = previousImportsDir;
    if (previousMaxBytes == null) delete process.env.USER_IMPORT_MAX_BYTES;
    else process.env.USER_IMPORT_MAX_BYTES = previousMaxBytes;
    await fs.remove(tempDir);
  });

  it("writes sequential chunks and resumes from the server-confirmed offset", async () => {
    const upload = await import("@/lib/admin/user-import-upload");
    const session = await upload.beginImportUpload({
      fileName: "server-user.zip",
      fileSize: 6,
    });

    const first = await upload.writeImportUploadChunk({
      uploadId: session.uploadId,
      offset: 0,
      contentLength: 3,
      body: Readable.from([Buffer.from("abc")]),
    });
    expect(first.receivedBytes).toBe(3);

    const resumed = await upload.beginImportUpload({
      fileName: "server-user.zip",
      fileSize: 6,
      uploadId: session.uploadId,
    });
    expect(resumed.receivedBytes).toBe(3);

    await expect(upload.writeImportUploadChunk({
      uploadId: session.uploadId,
      offset: 0,
      contentLength: 3,
      body: Readable.from([Buffer.from("abc")]),
    })).rejects.toThrow(/偏移/);

    await upload.writeImportUploadChunk({
      uploadId: session.uploadId,
      offset: 3,
      contentLength: 3,
      body: Readable.from([Buffer.from("def")]),
    });
    const completed = await upload.finalizeImportUpload(session.uploadId);

    expect(completed.fileSize).toBe(6);
    expect(completed.filePath.endsWith(".zip")).toBe(true);
    expect(await fs.readFile(completed.filePath, "utf8")).toBe("abcdef");
  });

  it("rolls a failed chunk back to the last confirmed offset", async () => {
    const upload = await import("@/lib/admin/user-import-upload");
    const session = await upload.beginImportUpload({ fileName: "broken.zip", fileSize: 6 });
    async function* brokenBody() {
      yield Buffer.from("abc");
      throw new Error("connection reset");
    }

    await expect(upload.writeImportUploadChunk({
      uploadId: session.uploadId,
      offset: 0,
      contentLength: 6,
      body: Readable.from(brokenBody()),
    })).rejects.toThrow(/connection reset/);

    const resumed = await upload.beginImportUpload({
      fileName: "broken.zip",
      fileSize: 6,
      uploadId: session.uploadId,
    });
    expect(resumed.receivedBytes).toBe(0);
    expect((await fs.stat(resumed.partPath)).size).toBe(0);
  });

  it("uses 32 MiB chunks and rejects archives above the configured limit", async () => {
    process.env.USER_IMPORT_MAX_BYTES = "4";
    const upload = await import("@/lib/admin/user-import-upload");

    expect(upload.IMPORT_UPLOAD_CHUNK_BYTES).toBe(32 * 1024 * 1024);
    await expect(upload.beginImportUpload({ fileName: "too-large.zip", fileSize: 5 }))
      .rejects.toThrow(/超过上限/);
  });

  it("cleans an abandoned partial upload after the 24-hour resume window", async () => {
    const upload = await import("@/lib/admin/user-import-upload");
    const abandoned = await upload.beginImportUpload({ fileName: "abandoned.zip", fileSize: 6 });
    const metadataPath = path.join(tempDir, ".upload-sessions", `${abandoned.uploadId}.json`);
    const metadata = await fs.readJson(metadataPath);
    metadata.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await fs.writeJson(metadataPath, metadata);

    await upload.beginImportUpload({ fileName: "next.zip", fileSize: 3 });

    expect(await fs.pathExists(abandoned.partPath)).toBe(false);
    expect(await fs.pathExists(metadataPath)).toBe(false);
  });
});
