import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { getAssetSourceLabel } from "@/lib/assets/source-filter";
import { buildBatchRequestSnapshot } from "@/lib/image-batch/submission";
import { executeBatchGenerationSnapshot } from "@/lib/image-batch/worker";

describe("image batch source mode", () => {
  it.each([
    ["style_replication", "批量 · 统一参考批量复刻"],
    ["multi_prompt", "批量 · 自定义分批"],
  ])("shows the concrete %s mode in the asset source", (mode, expected) => {
    expect(getAssetSourceLabel("batch", { batch: { mode } })).toBe(expected);
  });

  it("keeps the generic batch label when historical metadata has no mode", () => {
    expect(getAssetSourceLabel("batch", { batch: { id: "legacy-batch" } })).toBe("批量");
  });

  it("freezes the selected mode into every batch request snapshot", () => {
    const snapshot = buildBatchRequestSnapshot({
      batch: {
        id: "11111111-1111-4111-8111-111111111111",
        mode: "multi_prompt",
        sharedPrompt: "",
        sharedSettings: { model: "nano-banana-pro" },
      },
      item: {
        id: "22222222-2222-4222-8222-222222222222",
        prompt: "产品场景",
        includeSharedPrompt: false,
        overrides: {},
      },
      media: [],
      batchIndex: 1,
      taskCount: 1,
      batchSubmittedAt: "2026-08-06T10:00:00.000Z",
    });

    expect(snapshot).toMatchObject({ mode: "multi_prompt" });
  });

  it("passes the frozen mode to image generation metadata", async () => {
    const createImageGeneration = vi.fn().mockResolvedValue({
      generationId: 17,
      taskId: "task-17",
      status: "running",
    });

    await executeBatchGenerationSnapshot({
      authUserId: 7,
      requestKey: "33333333-3333-4333-8333-333333333333",
      snapshot: {
        schemaVersion: 1,
        source: "batch",
        batchId: "11111111-1111-4111-8111-111111111111",
        itemId: "22222222-2222-4222-8222-222222222222",
        mode: "multi_prompt",
        prompt: "产品场景",
        model: "nano-banana-pro",
        toolMediaIds: [],
        batchIndex: 1,
        taskCount: 1,
        batchSubmittedAt: "2026-08-06T10:00:00.000Z",
      },
      deps: {
        createImageGeneration,
        finalizeGeneration: vi.fn(),
        readGeneration: vi.fn(),
        readGenerationByRequestKey: vi.fn(),
      },
    });

    expect(createImageGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ batchMode: "multi_prompt" }),
    );
  });

  it("enriches historical assets from their durable batch relation", () => {
    const route = readFileSync("app/api/assets/route.ts", "utf8");

    expect(route).toContain("prisma.imageBatchOutput.findMany");
    expect(route).toContain("attachAssetBatchMode");
  });

  it("enriches historical assets in the administrator work list", () => {
    const adminWorks = readFileSync("lib/admin-user-works.ts", "utf8");

    expect(adminWorks).toContain("prisma.imageBatchOutput.findMany");
    expect(adminWorks).toContain("attachAssetBatchMode");
  });

  it("renders the detailed source in both detail locations", () => {
    const modal = readFileSync("components/works/work-detail-modal.tsx", "utf8");

    expect(modal).toContain("getAssetSourceLabel(item.source || p.source, p)");
    expect(modal).toContain(
      "getAssetSourceLabel(item.source || item.params?.source, item.params)",
    );
  });
});
