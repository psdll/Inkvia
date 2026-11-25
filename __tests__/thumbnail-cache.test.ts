import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThumbnailQueueFullError,
  THUMBNAIL_CACHE_WIDTHS,
  getThumbnailCacheKey,
  createThumbnailCache,
  getThumbnailCachePathsForSource,
  writeThumbnailAtomically,
} from "@/lib/thumbnail-cache";

const tempDirs: string[] = [];

async function makeFixture(name: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), `thumb-${name}-`));
  tempDirs.push(root);
  const sourcePath = path.join(root, "source.png");
  const cacheDir = path.join(root, "cache");
  await writeFile(sourcePath, Buffer.from("source"));
  return { root, sourcePath, cacheDir };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("thumbnail cache", () => {
  it("can locate every standard cache variant owned by one source file", () => {
    const cacheDir = path.join("C:", "uploads", "_thumbs");
    const paths = getThumbnailCachePathsForSource({
      sourcePath: path.join("C:", "uploads", "generated", "result.png"),
      sourceMtimeMs: 123456,
      cacheDir,
    });

    expect(THUMBNAIL_CACHE_WIDTHS).toEqual([100, 120, 200, 300, 400, 600, 800, 1200, 1600]);
    expect(paths).toHaveLength(9);
    for (const width of THUMBNAIL_CACHE_WIDTHS) {
      expect(paths).toContain(path.join(cacheDir, `${getThumbnailCacheKey({ sourcePath: path.join("C:", "uploads", "generated", "result.png"), sourceMtimeMs: 123456, width })}.webp`));
    }
    expect(paths.every((entry: string) => path.dirname(entry) === cacheDir)).toBe(true);
    expect(paths.every((entry: string) => entry.endsWith(".webp"))).toBe(true);
    expect(new Set(paths).size).toBe(9);
  });

  it("single-flights 100 concurrent requests for the same source and width", async () => {
    const fixture = await makeFixture("single-flight");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const convert = vi.fn(async () => {
      await blocked;
      return Buffer.from("thumbnail");
    });
    const cache = createThumbnailCache({ concurrency: 4, maxQueue: 100 });
    const input = {
      sourcePath: fixture.sourcePath,
      sourceMtimeMs: 123,
      width: 600,
      cacheDir: fixture.cacheDir,
      convert,
    };

    const requests = Array.from({ length: 100 }, () => cache.ensureThumbnail(input));
    release();
    const [left, ...others] = await Promise.all(requests);

    expect(convert).toHaveBeenCalledTimes(1);
    expect(others.every(result => result.cachePath === left.cachePath)).toBe(true);
    expect(await readFile(left.cachePath, "utf8")).toBe("thumbnail");
  });

  it("writes through temp, fsync, close, and rename in that order", async () => {
    const calls: string[] = [];
    const handle = {
      writeFile: vi.fn(async () => { calls.push("write"); }),
      sync: vi.fn(async () => { calls.push("sync"); }),
      close: vi.fn(async () => { calls.push("close"); }),
    };
    const ops = {
      mkdir: vi.fn(async (_directory: string) => { calls.push("mkdir"); }),
      open: vi.fn(async (_filePath: string, _flags: "wx") => { calls.push("open"); return handle; }),
      rename: vi.fn(async (_from: string, _to: string) => { calls.push("rename"); }),
      rm: vi.fn(async (_filePath: string) => { calls.push("rm"); }),
      stat: vi.fn(async (_filePath: string) => ({ size: 0 })),
    };

    await writeThumbnailAtomically("C:/cache/key.webp", Buffer.from("complete"), ops);

    expect(calls).toEqual(["mkdir", "open", "write", "sync", "close", "rename", "rm"]);
    expect(ops.open.mock.calls[0]?.[1]).toBe("wx");
    expect(ops.rename.mock.calls[0]?.[1]).toBe("C:/cache/key.webp");
  });

  it("does not leave a cache file when conversion fails", async () => {
    const fixture = await makeFixture("failure");
    const cache = createThumbnailCache({ concurrency: 4, maxQueue: 100 });

    await expect(cache.ensureThumbnail({
      sourcePath: fixture.sourcePath,
      sourceMtimeMs: 123,
      width: 300,
      cacheDir: fixture.cacheDir,
      convert: async () => { throw new Error("sharp failed"); },
    })).rejects.toThrow("sharp failed");

    expect(await readdir(fixture.cacheDir).catch(() => [])).toEqual([]);
    expect(cache.getMetrics()).toMatchObject({ failures: 1, generated: 0 });
  });

  it("rejects above the bounded wait queue", async () => {
    const fixture = await makeFixture("queue");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const runningStarted = new Promise<void>((resolve) => { started = resolve; });
    const cache = createThumbnailCache({ concurrency: 1, maxQueue: 1 });
    const request = (width: number) => cache.ensureThumbnail({
      sourcePath: fixture.sourcePath,
      sourceMtimeMs: 123,
      width,
      cacheDir: fixture.cacheDir,
      convert: async () => { started(); await blocked; return Buffer.from(String(width)); },
    });

    const running = request(120);
    await runningStarted;
    const queued = request(300);
    await vi.waitFor(() => expect(cache.getMetrics().queueLength).toBe(1));
    await expect(request(600)).rejects.toBeInstanceOf(ThumbnailQueueFullError);
    expect(cache.getMetrics()).toMatchObject({ inflight: 1, queueLength: 1, rejected: 1 });

    release();
    await Promise.all([running, queued]);
  });
});
