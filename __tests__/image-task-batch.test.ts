import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runImageTaskBatch } from "@/lib/generation/image-task-batch";

describe("image task batch", () => {
  it("starts every task concurrently and returns results in submission order", async () => {
    const started: number[] = [];
    const result = await runImageTaskBatch(2, async (batchIndex) => {
      started.push(batchIndex);
      await new Promise((resolve) => setTimeout(resolve, batchIndex === 1 ? 15 : 0));
      return `task-${batchIndex}`;
    });

    expect(started).toEqual([1, 2]);
    expect(result).toEqual([
      { batchIndex: 1, value: "task-1" },
      { batchIndex: 2, value: "task-2" },
    ]);
  });

  it("keeps successful tasks when another task fails", async () => {
    const result = await runImageTaskBatch(2, async (batchIndex) => {
      if (batchIndex === 2) throw new Error("upstream unavailable");
      return "task-1";
    });

    expect(result[0]).toEqual({ batchIndex: 1, value: "task-1" });
    expect(result[1]).toMatchObject({ batchIndex: 2, error: expect.any(Error) });
  });

  it.each([0, -1, 11, Number.NaN])("rejects invalid task count %s", async (taskCount) => {
    await expect(runImageTaskBatch(taskCount, async () => "unreachable")).rejects.toThrow("数量必须在 1 到 10 之间");
  });

  it("submits every real batch generation through the atomic tool-media wrapper", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");
    const generationInputs = readFileSync("lib/tool-media/generation-inputs.ts", "utf8");
    expect(service).toContain("toolMediaIds?: string[]");
    expect(service).toMatch(/createGenerationWithToolMedia\(/);
    expect(generationInputs).toMatch(/generationInputMedia\.createMany/);
    expect(service).toMatch(/resolveOrderedGenerationInputs\(/);
    expect(generationInputs).toMatch(/toolMediaId\[\]/);
  });
});
