import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteImportOrphanCandidates, scanImportOrphanCandidates } from "@/lib/admin-import-orphans";

const NOW = new Date("2026-07-06T12:00:00.000Z");

let tempRoot = "";

async function writeFile(relativePath: string, ageHours: number) {
  const diskPath = path.join(tempRoot, relativePath);
  await fs.ensureDir(path.dirname(diskPath));
  await fs.writeFile(diskPath, "x");
  const mtime = new Date(NOW.getTime() - ageHours * 60 * 60 * 1000);
  await fs.utimes(diskPath, mtime, mtime);
  return diskPath;
}

describe("admin imports orphan cleanup", () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "imports-orphans-"));
  });

  afterEach(async () => {
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = "";
  });

  it("only lists image or video files older than 24 hours and not protected", async () => {
    await writeFile("old-image.png", 25);
    await writeFile("recent-image.png", 23);
    await writeFile("old-video.mp4", 48);
    await writeFile("old-note.txt", 48);
    await writeFile("nested/protected.jpg", 72);

    const result = await scanImportOrphanCandidates({
      now: NOW,
      importsRoot: tempRoot,
      protectedRefs: new Set(["/uploads/imports/nested/protected.jpg"])
    });

    expect(result.cooldownHours).toBe(24);
    expect(result.candidates.map((item) => item.path)).toEqual([
      "/uploads/imports/old-video.mp4",
      "/uploads/imports/old-image.png"
    ]);
    expect(result.totalCount).toBe(2);
  });

  it("keeps protected import records even when the file is older than the cooldown", async () => {
    const diskPath = await writeFile("generation-import.webp", 72);

    const result = await deleteImportOrphanCandidates({
      now: NOW,
      importsRoot: tempRoot,
      protectedRefs: new Set(["/uploads/imports/generation-import.webp"])
    });

    expect(result.deletedCount).toBe(0);
    expect(await fs.pathExists(diskPath)).toBe(true);
  });

  it("re-scans and deletes only current orphan candidates", async () => {
    const orphan = await writeFile("orphan.mov", 72);
    const protectedFile = await writeFile("still-used.png", 72);

    const result = await deleteImportOrphanCandidates({
      now: NOW,
      importsRoot: tempRoot,
      protectedRefs: new Set(["/uploads/imports/still-used.png"])
    });

    expect(result.deletedCount).toBe(1);
    expect(result.deletedBytes).toBeGreaterThan(0);
    expect(await fs.pathExists(orphan)).toBe(false);
    expect(await fs.pathExists(protectedFile)).toBe(true);
  });
});
