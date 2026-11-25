import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildLiveVideoOutputErrorState,
  executeLiveVideoGenerationSnapshot,
} from "@/lib/live-video-batch/video-worker";

const snapshot = {
  schemaVersion: 1 as const,
  batchId: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  authUserId: 7,
  sourceMediaId: "33333333-3333-4333-8333-333333333333",
  mediaPath: "/uploads/imports/product.png",
  prompt: "镜头缓慢推进，产品主体保持清晰。",
  userPrompt: "用户原始需求",
  model: "doubao-seedance-2-0-fast-260128",
  inputMode: "multimodal" as const,
  duration: 9,
  ratio: "9:16",
  resolution: "720p",
  generateAudio: false,
  skill: { publicId: "system:1", name: "商品动态设计", revision: 2 },
};

describe("live video batch video worker", () => {
  it("claims a full ten-image group in one concurrent iteration", () => {
    const source = readFileSync("lib/live-video-batch/video-worker.ts", "utf8");
    expect(source).toContain("limit = LIVE_VIDEO_BATCH_MAX_MEDIA");
    expect(source).toContain("Math.min(LIVE_VIDEO_BATCH_MAX_MEDIA, limit)");
    expect(source).toContain("concurrency = LIVE_VIDEO_BATCH_MAX_MEDIA");
    expect(source).toContain("await Promise.all(ids.map");
  });

  it("submits exactly one multimodal reference image and the frozen duration", async () => {
    const createVideoGeneration = vi.fn().mockResolvedValue({
      generationId: 17,
      taskId: "provider-task",
      status: "running",
    });
    const result = await executeLiveVideoGenerationSnapshot({
      requestKey: "44444444-4444-4444-8444-444444444444",
      snapshot,
      deps: {
        createVideoGeneration,
        finalizeGeneration: vi.fn(),
        readGeneration: vi.fn(),
        readGenerationByRequestKey: vi.fn(),
      },
    });

    expect(createVideoGeneration).toHaveBeenCalledWith({
      authUserId: 7,
      requestKey: "44444444-4444-4444-8444-444444444444",
      source: "batch",
      prompt: snapshot.prompt,
      userPrompt: snapshot.userPrompt,
      model: snapshot.model,
      toolMediaIds: [snapshot.sourceMediaId],
      inputMode: "multimodal",
      duration: 9,
      resolution: "720p",
      ratio: "9:16",
      generateAudio: false,
      skill: { id: "system:1", name: "商品动态设计", revision: 2 },
    });
    expect(result).toMatchObject({
      generationId: 17,
      status: "waiting_provider",
    });
  });

  it("keeps legacy first-frame snapshots executable", async () => {
    const createVideoGeneration = vi.fn().mockResolvedValue({
      generationId: 88,
      taskId: "provider-task",
      status: "running",
    });
    await executeLiveVideoGenerationSnapshot({
      requestKey: "77777777-7777-4777-8777-777777777777",
      snapshot: { ...snapshot, inputMode: "first_frame" as const },
      deps: {
        createVideoGeneration,
        finalizeGeneration: vi.fn(),
        readGeneration: vi.fn(),
        readGenerationByRequestKey: vi.fn(),
      },
    });

    expect(createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      inputMode: "first_frame",
    }));
  });

  it("recovers the existing generation by request key after a late submit error", async () => {
    const readGenerationByRequestKey = vi.fn().mockResolvedValue({
      id: 19,
      status: "running",
      localPath: null,
      errorMsg: null,
      finishedAt: null,
      templateData: null,
    });
    const result = await executeLiveVideoGenerationSnapshot({
      requestKey: "44444444-4444-4444-8444-444444444444",
      snapshot,
      deps: {
        createVideoGeneration: vi.fn().mockRejectedValue(new Error("late failure")),
        finalizeGeneration: vi.fn(),
        readGeneration: vi.fn(),
        readGenerationByRequestKey,
      },
    });
    expect(readGenerationByRequestKey).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(result).toMatchObject({ generationId: 19, status: "waiting_provider" });
  });

  it("keeps transient finalization failures retryable and validation failures terminal", () => {
    expect(buildLiveVideoOutputErrorState(new Error("read ECONNRESET"), true, 1)).toEqual({
      status: "waiting_provider",
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: 2_000,
    });
    expect(buildLiveVideoOutputErrorState(new Error("validation failed with 422"), false, 1)).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "VIDEO_SUBMIT_FAILED",
        finishedAt: expect.any(Date),
      }),
    );
  });
});
