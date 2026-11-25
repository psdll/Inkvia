import { describe, expect, it, vi } from "vitest";

import {
  BATCH_UPLOAD_MAX_FILES_PER_REQUEST,
  chunkBatchUploadFiles,
  IMAGE_BATCH_UPLOAD_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/image-batch/concurrency";

describe("image batch bounded concurrency", () => {
  it("uses five concurrent upload slots for the batch workbench", () => {
    expect(IMAGE_BATCH_UPLOAD_CONCURRENCY).toBe(5);
    expect(BATCH_UPLOAD_MAX_FILES_PER_REQUEST).toBe(5);
  });

  it("splits files into stable request-sized chunks", () => {
    expect(chunkBatchUploadFiles([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it("keeps input order while never exceeding the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    const promise = mapWithConcurrency([1, 2, 3, 4, 5], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.splice(0, 3).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0, 2).forEach((release) => release());

    await expect(promise).resolves.toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(3);
  });

  it("continues remaining uploads and reports every failed file", async () => {
    const completed: number[] = [];

    await expect(mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      if (value === 1) throw new Error("1.png：文件损坏");
      if (value === 3) throw new Error("3.png：格式不支持");
      await Promise.resolve();
      completed.push(value);
      return value;
    })).rejects.toThrow(
      "以下文件上传失败：\n- 1.png：文件损坏\n- 3.png：格式不支持",
    );

    expect(completed).toEqual([2, 4]);
  });
});
