import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function oldFile(root: string, relativePath: string) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, relativePath);
  const old = new Date("2026-01-01T00:00:00.000Z");
  await utimes(filePath, old, old);
  return filePath;
}

describe("stored thumbnail asset cleanup", () => {
  it("deletes rebuildable cache and unreferenced derived media while preserving referenced files", async () => {
    const module = await import("@/lib/thumbnail-asset-cleanup").catch(() => null) as any;
    expect(typeof module?.cleanupStoredThumbnailAssets).toBe("function");
    if (typeof module?.cleanupStoredThumbnailAssets !== "function") return;

    const uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "thumbnail-assets-"));
    tempDirs.push(uploadsRoot);
    const cache = await oldFile(uploadsRoot, "_thumbs/cache.webp");
    const orphanPreview = await oldFile(uploadsRoot, "generation_previews/orphan.webp");
    const keptPreview = await oldFile(uploadsRoot, "generation_previews/kept.webp");
    const orphanMaterialThumb = await oldFile(uploadsRoot, "material_library/thumbs/orphan.webp");
    const keptMaterialThumb = await oldFile(uploadsRoot, "material_library/thumbs/kept.webp");
    const original = await oldFile(uploadsRoot, "generated/original.png");

    const result = await module.cleanupStoredThumbnailAssets({
      uploadsRoot,
      olderThanDays: 1,
      now: new Date("2026-08-25T00:00:00.000Z"),
      protectedRefs: new Set([
        "/uploads/generation_previews/kept.webp",
        "/uploads/material_library/thumbs/kept.webp",
      ]),
    });

    await expect(stat(cache)).rejects.toThrow();
    await expect(stat(orphanPreview)).rejects.toThrow();
    await expect(stat(orphanMaterialThumb)).rejects.toThrow();
    expect(await readFile(keptPreview, "utf8")).toContain("kept.webp");
    expect(await readFile(keptMaterialThumb, "utf8")).toContain("kept.webp");
    expect(await readFile(original, "utf8")).toContain("original.png");
    expect(result).toMatchObject({
      deletedCacheFiles: 1,
      deletedOrphanFiles: 2,
      failedFiles: 0,
    });
  });
});
