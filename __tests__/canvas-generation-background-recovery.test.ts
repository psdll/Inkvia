import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as generationWait from "@/components/canvas/run-node";

type GenerationWaitFeature = typeof generationWait & {
  CANVAS_GENERATION_FOREGROUND_WAIT_MS?: number;
  CANVAS_GENERATION_BACKGROUND_POLL_MS?: number;
  canvasGenerationStatusText?: (elapsedSeconds?: number) => string;
  shouldResumeCanvasGeneration?: (input: {
    status?: string;
    generationId?: number;
    error?: string;
  }) => boolean;
};

const feature = generationWait as GenerationWaitFeature;
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

function response(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("canvas generation background recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses a 30 minute foreground wait before switching to background polling", () => {
    expect(feature.CANVAS_GENERATION_FOREGROUND_WAIT_MS).toBe(30 * 60_000);
    expect(feature.CANVAS_GENERATION_BACKGROUND_POLL_MS).toBeGreaterThan(2_500);
  });

  it("keeps polling after the foreground wait and resolves a late result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T04:00:00.000Z"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ success: true, status: "running", url: null }))
      .mockResolvedValueOnce(response({ success: true, status: "running", url: null }))
      .mockResolvedValueOnce(response({ success: true, status: "success", url: "/uploads/result.mp4" }));
    vi.stubGlobal("fetch", fetcher);
    const progress: Array<{ status: string; message?: string }> = [];
    const wait = generationWait.waitForGenerationResult as (
      generationId: number,
      onProgress?: (value: { status: string; message?: string }) => void,
      intervalMs?: number,
      foregroundWaitMs?: number,
      shouldCancel?: () => boolean,
      backgroundPollMs?: number,
    ) => Promise<string>;

    const outcome = wait(41, (value) => progress.push(value), 1_000, 2_000, undefined, 5_000)
      .then((value) => ({ status: "resolved" as const, value }))
      .catch((error) => ({ status: "rejected" as const, message: String(error?.message || error) }));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(progress).not.toContainEqual(expect.objectContaining({ status: "timeout" }));
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(outcome).resolves.toEqual({ status: "resolved", value: "/uploads/result.mp4" });
    expect(progress).toContainEqual(expect.objectContaining({
      status: "background",
      message: "仍在后台生成",
    }));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shows the background message after 30 minutes without treating it as a failure", () => {
    expect(feature.canvasGenerationStatusText).toBeTypeOf("function");
    if (!feature.canvasGenerationStatusText) return;

    expect(feature.canvasGenerationStatusText(29 * 60 + 59)).toBe("生成中 1799s...");
    expect(feature.canvasGenerationStatusText(30 * 60)).toBe("仍在后台生成");
  });

  it("reconciles active tasks and legacy timeout failures, but not real failures", () => {
    expect(feature.shouldResumeCanvasGeneration).toBeTypeOf("function");
    if (!feature.shouldResumeCanvasGeneration) return;

    expect(feature.shouldResumeCanvasGeneration({ status: "running", generationId: 41 })).toBe(true);
    expect(feature.shouldResumeCanvasGeneration({ status: "submitting", generationId: 41 })).toBe(true);
    expect(feature.shouldResumeCanvasGeneration({ status: "failed", generationId: 41, error: "生成超时" })).toBe(true);
    expect(feature.shouldResumeCanvasGeneration({ status: "failed", generationId: 41, error: "供应商拒绝请求" })).toBe(false);
    expect(feature.shouldResumeCanvasGeneration({ status: "running" })).toBe(false);
  });

  it("wires the same recovery contract into image tasks, video tasks, and their shared status UI", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const nodeCard = read("components/canvas/CanvasNodeCard.tsx");

    expect(board).toContain("shouldResumeCanvasGeneration({\n            status: output.status");
    expect(board).toContain("shouldResumeCanvasGeneration({\n        status: node.data.status");
    expect(board).toContain('node.data.status === "success" && node.data.outputUrl && node.data.error === "生成超时"');
    expect(nodeCard).toContain("canvasGenerationStatusText(elapsed)");
  });
});
