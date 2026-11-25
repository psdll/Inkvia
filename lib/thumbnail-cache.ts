import crypto from "node:crypto";
import path from "node:path";
import {
  mkdir as fsMkdir,
  open as fsOpen,
  readFile,
  rename as fsRename,
  rm as fsRm,
  stat as fsStat,
  type FileHandle,
} from "node:fs/promises";
import { getThumbnailCacheKey } from "@/lib/thumbnail-cache-key.mjs";

export { getThumbnailCacheKey } from "@/lib/thumbnail-cache-key.mjs";

export const THUMBNAIL_CACHE_WIDTHS = [100, 120, 200, 300, 400, 600, 800, 1200, 1600] as const;

export function getThumbnailCachePathsForSource(input: {
  sourcePath: string;
  sourceMtimeMs: number;
  cacheDir: string;
  quality?: number;
}) {
  return THUMBNAIL_CACHE_WIDTHS.map((width) => path.join(
    input.cacheDir,
    `${getThumbnailCacheKey({ ...input, width })}.webp`,
  ));
}

export class ThumbnailQueueFullError extends Error {
  constructor() {
    super("thumbnail queue is full");
    this.name = "ThumbnailQueueFullError";
  }
}

export type ThumbnailCacheMetrics = {
  hits: number;
  misses: number;
  generated: number;
  failures: number;
  rejected: number;
  singleFlightJoins: number;
  inflight: number;
  queueLength: number;
  maxQueueLength: number;
};

type AtomicFileHandle = Pick<FileHandle, "writeFile" | "sync" | "close">;

export type ThumbnailAtomicFileOps = {
  mkdir(directory: string): Promise<unknown>;
  open(filePath: string, flags: "wx"): Promise<AtomicFileHandle>;
  rename(from: string, to: string): Promise<unknown>;
  rm(filePath: string): Promise<unknown>;
  stat(filePath: string): Promise<{ size: number }>;
};

const defaultAtomicFileOps: ThumbnailAtomicFileOps = {
  mkdir: (directory) => fsMkdir(directory, { recursive: true }),
  open: (filePath, flags) => fsOpen(filePath, flags),
  rename: (from, to) => fsRename(from, to),
  rm: (filePath) => fsRm(filePath, { force: true }),
  stat: (filePath) => fsStat(filePath),
};

export async function writeThumbnailAtomically(
  targetPath: string,
  buffer: Buffer,
  ops: ThumbnailAtomicFileOps = defaultAtomicFileOps,
): Promise<void> {
  await ops.mkdir(path.dirname(targetPath));
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle: AtomicFileHandle | null = null;
  try {
    handle = await ops.open(tempPath, "wx");
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await ops.rename(tempPath, targetPath);
    } catch (error) {
      const raced = await ops.stat(targetPath).catch(() => null);
      if (!raced || raced.size <= 0) throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await ops.rm(tempPath).catch(() => {});
  }
}

type EnsureThumbnailInput = {
  sourcePath: string;
  sourceMtimeMs: number;
  width: number;
  cacheDir: string;
  quality?: number;
  convert: () => Promise<Buffer>;
};

export type EnsuredThumbnail = {
  buffer: Buffer;
  cachePath: string;
  status: "hit" | "generated";
};

type QueueJob<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

async function readValidThumbnail(cachePath: string): Promise<Buffer | null> {
  const cached = await fsStat(cachePath).catch(() => null);
  if (!cached?.isFile() || cached.size <= 0) return null;
  return readFile(cachePath).catch(() => null);
}

export function createThumbnailCache(options: { concurrency?: number; maxQueue?: number } = {}) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const maxQueue = Math.max(0, Math.floor(options.maxQueue ?? 100));
  const flights = new Map<string, Promise<EnsuredThumbnail>>();
  const queue: Array<QueueJob<unknown>> = [];
  const metrics = {
    hits: 0,
    misses: 0,
    generated: 0,
    failures: 0,
    rejected: 0,
    singleFlightJoins: 0,
    inflight: 0,
    maxQueueLength: 0,
  };

  const start = <T>(job: QueueJob<T>) => {
    metrics.inflight += 1;
    void job.task().then(job.resolve, job.reject).finally(() => {
      metrics.inflight -= 1;
      const next = queue.shift();
      if (next) start(next);
    });
  };

  const schedule = <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const job: QueueJob<T> = { task, resolve, reject };
    if (metrics.inflight < concurrency) {
      start(job);
      return;
    }
    if (queue.length >= maxQueue) {
      metrics.rejected += 1;
      reject(new ThumbnailQueueFullError());
      return;
    }
    queue.push(job as QueueJob<unknown>);
    metrics.maxQueueLength = Math.max(metrics.maxQueueLength, queue.length);
  });

  const ensureThumbnail = async (input: EnsureThumbnailInput): Promise<EnsuredThumbnail> => {
    const key = getThumbnailCacheKey(input);
    const cachePath = path.join(input.cacheDir, `${key}.webp`);
    const cached = await readValidThumbnail(cachePath);
    if (cached) {
      metrics.hits += 1;
      return { buffer: cached, cachePath, status: "hit" };
    }
    metrics.misses += 1;

    const current = flights.get(cachePath);
    if (current) {
      metrics.singleFlightJoins += 1;
      return current;
    }

    const flight = schedule(async () => {
      const raced = await readValidThumbnail(cachePath);
      if (raced) {
        metrics.hits += 1;
        return { buffer: raced, cachePath, status: "hit" as const };
      }
      try {
        const buffer = await input.convert();
        if (!buffer.length) throw new Error("thumbnail conversion returned an empty buffer");
        await writeThumbnailAtomically(cachePath, buffer);
        metrics.generated += 1;
        return { buffer, cachePath, status: "generated" as const };
      } catch (error) {
        metrics.failures += 1;
        throw error;
      }
    });
    flights.set(cachePath, flight);
    void flight.finally(() => {
      if (flights.get(cachePath) === flight) flights.delete(cachePath);
    }).catch(() => {});
    return flight;
  };

  return {
    ensureThumbnail,
    getMetrics(): ThumbnailCacheMetrics {
      return {
        ...metrics,
        queueLength: queue.length,
      };
    },
  };
}

export const thumbnailCache = createThumbnailCache({ concurrency: 4, maxQueue: 100 });
