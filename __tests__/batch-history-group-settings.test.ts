import { describe, expect, it } from "vitest";
import { applyHistoryGroupSettingsPatch } from "@/components/batch-workbench/history-group-settings";
import type { BatchHistoryGroup } from "@/components/batch-workbench/types";

describe("custom batch history group settings", () => {
  it("applies a settings patch to the batch and every task without deleting old outputs", () => {
    const group = {
      id: "group-1",
      batchId: "batch-1",
      position: 0,
      name: "分组#1",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      batch: {
        id: "batch-1",
        mode: "multi_prompt",
        status: "success",
        sharedSettings: { model: "old-model", aspectRatio: "3:4", resolution: "2K" },
        version: 3,
        finishedAt: "2026-08-11T01:00:00.000Z",
        updatedAt: "2026-08-11T01:00:00.000Z",
      },
      items: [
        {
          id: "item-1",
          groupId: "group-1",
          position: 0,
          name: "任务 1",
          prompt: "场景一",
          includeSharedPrompt: false,
          overrides: { model: "old-model", aspectRatio: "3:4", resolution: "2K" },
          outputCount: 1,
          status: "success",
          media: [],
          outputs: [{ id: "output-1", slotIndex: 0, attempt: 1, status: "success" }],
        },
        {
          id: "item-2",
          groupId: "group-1",
          position: 1,
          name: "任务 2",
          prompt: "场景二",
          includeSharedPrompt: false,
          overrides: { model: "old-model", aspectRatio: "3:4", resolution: "2K" },
          outputCount: 1,
          status: "failed",
          media: [],
          outputs: [{ id: "output-2", slotIndex: 0, attempt: 1, status: "failed" }],
        },
      ],
    } satisfies BatchHistoryGroup;

    const updated = applyHistoryGroupSettingsPatch(group, {
      model: "new-model",
      resolution: "4K",
    });

    expect(updated.batch).toMatchObject({
      status: "draft",
      finishedAt: null,
      sharedSettings: { model: "new-model", aspectRatio: "3:4", resolution: "4K" },
    });
    expect(updated.items).toHaveLength(2);
    expect(updated.items.every((item) => item.status === "draft")).toBe(true);
    expect(updated.items.every((item) => item.overrides.model === "new-model")).toBe(true);
    expect(updated.items.every((item) => item.overrides.resolution === "4K")).toBe(true);
    expect(updated.items.map((item) => item.outputs[0]?.id)).toEqual(["output-1", "output-2"]);
    expect(group.batch.status).toBe("success");
    expect(group.items[0].overrides.model).toBe("old-model");
  });
});
