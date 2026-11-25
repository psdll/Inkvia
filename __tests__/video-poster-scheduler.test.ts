import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const schedulerPath = resolve(process.cwd(), "lib/browser/video-poster-scheduler.ts");

describe("video poster scheduler", () => {
  it("starts at most three poster extractions and releases the next slot immediately", async () => {
    expect(existsSync(schedulerPath)).toBe(true);
    if (!existsSync(schedulerPath)) return;

    const { createVideoPosterScheduler } = await import("@/lib/browser/video-poster-scheduler");
    const schedule = createVideoPosterScheduler(3);
    const releases = new Map<number, () => void>();
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const jobs = Array.from({ length: 5 }, (_, index) => schedule(async () => {
      started.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolveJob) => releases.set(index, resolveJob));
      active -= 1;
      return index;
    }));

    expect(started).toEqual([0, 1, 2]);
    expect(maxActive).toBe(3);

    releases.get(0)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3]);

    releases.get(1)?.();
    releases.get(2)?.();
    releases.get(3)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    releases.get(4)?.();

    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBe(3);
  });
});
