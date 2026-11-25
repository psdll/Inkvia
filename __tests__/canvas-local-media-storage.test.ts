import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadCanvasMedia } from "@/lib/canvas/media-upload-client";
import { persistCanvasMediaStream, streamCanvasMediaUpload } from "@/lib/canvas/media-upload-service";
import { Readable } from "node:stream";
vi.mock("@/lib/runtime-isolation", async () => ({ ...await vi.importActual("@/lib/runtime-isolation"), assertWritablePath: (await import("./helpers/fixture-storage-boundary")).assertFixtureStoragePath }));

const read = (file: string) => readFileSync(file, "utf8");

describe("canvas local media storage contract", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uploads through the local endpoint and returns the ready local URL without polling", async () => {
    const mediaId = "019f0000-0000-7000-8000-000000000001";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      mediaId,
      status: "ready",
      kind: "image",
      url: "/uploads/canvas_imports/7/2026-07-21/a.png",
      variants: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), { name: "a.png" }) as File;

    const result = await uploadCanvasMedia(file);

    expect(result.url).toBe("/uploads/canvas_imports/7/2026-07-21/a.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/canvas/upload", expect.objectContaining({
      method: "POST",
      body: expect.any(FormData),
    }));
    expect(fetchMock.mock.calls.flatMap((call) => call.map(String)).join(" ")).not.toMatch(/initiate|complete|aliyun|oss/i);
  });

  it("keeps production uploads local instead of requiring direct OSS upload", () => {
    const route = read("app/api/canvas/upload/route.ts");
    const storage = read("lib/canvas/media-upload-service.ts");

    expect(route).not.toContain("DIRECT_UPLOAD_REQUIRED");
    expect(route).not.toContain("req.formData()");
    expect(route).toContain("streamCanvasMediaUpload");
    expect(storage).toContain("Readable.fromWeb");
    expect(storage).toContain("Busboy");
    expect(storage).toContain("'local'");
    expect(storage).toContain("saveLocalFile");
  });

  it("uses OSS only at the external-provider URL conversion boundary", () => {
    const worker = read("lib/canvas/run-worker.ts");
    const workerProcess = read("scripts/canvas-worker.ts");

    expect(worker).toContain('from "@/lib/external-assets"');
    expect(worker).toContain("resolveAssetUrlForExternalApi");
    expect(worker).not.toContain("direct-media-upload");
    expect(workerProcess).not.toContain("direct-media-upload");
    expect(workerProcess).not.toContain('import("@/lib/canvas/media-upload-service")');
  });

  it("stores local canvas uploads directly in the official import folder without quarantine", () => {
    const storage = read("lib/canvas/media-upload-service.ts");
    const sharedStorage = read("lib/storage.ts");

    expect(storage).not.toContain("canvasMediaQuarantineRoot");
    expect(storage).not.toContain("CANVAS_MEDIA_QUARANTINE_DIR");
    expect(storage).not.toContain("runCanvasMediaProcessingBatch");
    expect(storage).toContain("buildCanvasImportStorageFolder");
    expect(storage).toContain("resolveLocalUploadDirectory");
    expect(storage).toContain("dateSubdirectory: false");
    expect(storage).not.toContain("`canvas_imports/${asset.ownerUserId}`");
    expect(storage).not.toContain("`canvas_media/${asset.ownerUserId}`");
    expect(storage).not.toContain("downloadPrivateOssObject");
    expect(sharedStorage).toContain("saveLocalFile");
  });

  it("does not schedule a quarantine processing batch in workers", () => {
    const worker = read("scripts/canvas-worker.ts");
    const maintenance = read("app/api/internal/canvas-maintenance/route.ts");

    expect(worker).not.toContain("runCanvasMediaProcessingBatch");
    expect(maintenance).not.toContain("runCanvasMediaProcessingBatch");
  });

  it("deletes local canvas media from the configured uploads directory", () => {
    const cleanup = read("lib/media-cleanup.ts");
    const canvasGc = read("lib/canvas/media-gc.ts");

    expect(cleanup).toContain("process.env.UPLOADS_DIR");
    expect(cleanup).toContain('path.relative(uploadRoot, abs)');
    expect(cleanup).toContain("localOnly?: boolean");
    expect(canvasGc).toContain('localOnly: asset.storageProvider === "local"');
  });

  it("rejects malformed media ids before the PostgreSQL UUID cast", () => {
    const statusRoute = read("app/api/canvas/media/[mediaId]/route.ts");

    expect(statusRoute).toContain("UUID_PATTERN");
    expect(statusRoute.indexOf("UUID_PATTERN.test")).toBeLessThan(statusRoute.indexOf("::uuid"));
  });

  it.each(["production", "test"])("streams valid media without a virus scanner in %s", async (environment) => {
    const uploads = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-local-upload-"));
    vi.stubEnv("UPLOADS_DIR", uploads);
    vi.stubEnv("NODE_ENV", environment);
    const execFile = vi.spyOn(childProcess, "execFile").mockImplementation(() => {
      throw new Error("upload must not launch a virus scanner");
    });
    const queryRaw = vi.fn().mockResolvedValue([{ username: "demo" }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const form = new FormData();
    form.append("file", new Blob([
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    ], { type: "image/png" }), "pixel.png");

    try {
      const result = await streamCanvasMediaUpload({ $queryRaw: queryRaw, $executeRaw: executeRaw } as any, {
        ownerUserId: 7,
        request: new Request("http://local/api/canvas/upload", { method: "POST", body: form }),
      });

      expect(result).toMatchObject({ status: "ready", kind: "image", name: "pixel.png" });
      expect(result.variants.original).toMatchObject({ width: 1, height: 1 });
      expect(result.url).toMatch(/^\/uploads\/canvas_imports\/demo_\d{8}\/[a-f0-9]{64}\.png$/);
      const stored = path.join(uploads, result.url.replace(/^\/uploads\//, ""));
      expect((await fs.stat(stored)).isFile()).toBe(true);
      expect((await fs.readdir(path.dirname(stored))).every((name) => !name.endsWith(".part"))).toBe(true);
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(executeRaw).toHaveBeenCalledTimes(1);
      expect(execFile).not.toHaveBeenCalled();
      const metadata = executeRaw.mock.calls[0][0].values
        .filter((value: unknown) => typeof value === "string" && value.startsWith("{"))
        .map((value: string) => JSON.parse(value))
        .find((value: { kind?: string }) => value.kind === "image");
      expect(metadata).toMatchObject({ kind: "image", width: 1, height: 1 });
      expect(metadata).not.toHaveProperty("scan");
    } finally {
      await fs.rm(uploads, { recursive: true, force: true });
    }
  });

  it.each([
    ["empty", Buffer.alloc(0), "MEDIA_FILE_EMPTY"],
    ["invalid file header", Buffer.from("not an image"), "MEDIA_MAGIC_INVALID"],
    ["truncated PNG", Buffer.from("89504e470d0a1a0a00000000", "hex"), "MEDIA_PROCESSING_FAILED"],
  ])("still rejects %s media and cleans temporary files", async (_label, bytes, code) => {
    const uploads = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-local-upload-"));
    vi.stubEnv("UPLOADS_DIR", uploads);
    vi.stubEnv("NODE_ENV", "production");
    const queryRaw = vi.fn().mockResolvedValue([{ username: "demo" }]);
    const executeRaw = vi.fn();
    try {
      await expect(persistCanvasMediaStream({ $queryRaw: queryRaw, $executeRaw: executeRaw } as any, {
        ownerUserId: 7,
        stream: Readable.from([bytes]),
        originalName: "invalid.png",
        declaredMime: "image/png",
        kind: "image",
      })).rejects.toMatchObject({ code });
      expect(executeRaw).not.toHaveBeenCalled();
      const folders = await fs.readdir(path.join(uploads, "canvas_imports"));
      for (const folder of folders) {
        expect(await fs.readdir(path.join(uploads, "canvas_imports", folder))).toEqual([]);
      }
    } finally {
      await fs.rm(uploads, { recursive: true, force: true });
    }
  });
});
