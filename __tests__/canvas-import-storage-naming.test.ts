import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveLocalFile } from "@/lib/storage";
vi.mock("@/lib/runtime-isolation", async () => ({ ...await vi.importActual("@/lib/runtime-isolation"), assertWritablePath: (await import("./helpers/fixture-storage-boundary")).assertFixtureStoragePath }));

describe("canvas import storage naming", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the import folder with the merchant and Shanghai calendar day", async () => {
    const module = await import("@/lib/canvas/import-storage-path").catch(() => ({}));

    expect(module).toHaveProperty("buildCanvasImportStorageFolder");
    const buildFolder = (module as {
      buildCanvasImportStorageFolder: (username: string, userId: number, createdAt: Date) => string;
    }).buildCanvasImportStorageFolder;

    expect(buildFolder("测试商家", 1, new Date("2026-07-23T16:30:00.000Z")))
      .toBe("canvas_imports/测试商家_20260724");
    expect(buildFolder("../", 7, new Date("2026-07-24T08:00:00.000Z")))
      .toBe("canvas_imports/商家7_20260724");
  });

  it("does not append a duplicate date directory to a merchant-day folder", async () => {
    const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-merchant-day-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-merchant-source-"));
    const source = path.join(sourceDir, "source.upload");
    await fs.writeFile(source, Buffer.from("canvas"));
    vi.stubEnv("UPLOADS_DIR", uploadsDir);

    try {
      const url = await saveLocalFile(source, "canvas_imports/测试商家_20260724", {
        fallbackExt: "png",
        stableKey: "1234567890abcdef",
        dateSubdirectory: false,
      });

      expect(url).toBe("/uploads/canvas_imports/测试商家_20260724/1234567890abcdef.png");
      await expect(fs.stat(path.join(
        uploadsDir,
        "canvas_imports",
        "测试商家_20260724",
        "1234567890abcdef.png",
      ))).resolves.toMatchObject({ size: 6 });
    } finally {
      await fs.rm(uploadsDir, { recursive: true, force: true });
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("passes the merchant and upload day directly from the upload request to local storage", () => {
    const service = readFileSync("lib/canvas/media-upload-service.ts", "utf8");

    expect(service).toContain("buildCanvasImportStorageFolder");
    expect(service).toContain('SELECT "username" FROM "User"');
    expect(service).toContain("owner[0]?.username");
    expect(service).toContain("createdAt");
    expect(service).toContain("dateSubdirectory: false");
    expect(service).not.toContain("`canvas_imports/${asset.ownerUserId}`");
  });

  it("publishes staged uploads without copying and preserves an existing destination", async () => {
    const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-merchant-day-"));
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    const source = path.join(uploadsDir, "staged.part");
    await fs.writeFile(source, "verified media");
    const before = await fs.stat(source);
    try {
      const options = { stableKey: "1234567890abcdef", fallbackExt: "png", dateSubdirectory: false, consumeSource: true };
      const url = await saveLocalFile(source, "canvas_imports/test", options);
      const target = path.join(uploadsDir, url.replace("/uploads/", ""));
      expect((await fs.stat(target)).ino).toBe(before.ino);
      await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
      await fs.writeFile(source, "second upload");
      expect(await saveLocalFile(source, "canvas_imports/test", options)).toBe(url);
      expect(await fs.readFile(target, "utf8")).toBe("verified media");
    } finally {
      await fs.rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it("keeps deletion and orphan cleanup scoped to media owned by the merchant", () => {
    const deleteRoute = readFileSync("app/api/canvas/media/delete/route.ts", "utf8");
    const cleanup = readFileSync("lib/canvas/cleanup.ts", "utf8");

    expect(deleteRoute).toContain("prisma.mediaAsset.findMany");
    expect(deleteRoute).toContain("ownerUserId: authUserId");
    expect(cleanup).toContain("prisma.mediaAsset.findMany");
    expect(cleanup).toContain("ownerUserId: userId");
    expect(cleanup).toContain("collectCanvasImportRefs");
  });
});
