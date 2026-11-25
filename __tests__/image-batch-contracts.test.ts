import { describe, expect, it } from "vitest";

import {
  IMAGE_BATCH_LIMITS,
  aggregateBatchStatus,
  combineBatchPrompt,
  elapsedSeconds,
  isGroupedImageBatchMode,
  mergeBatchSettings,
  splitBatchPrompts,
} from "@/lib/image-batch/contracts";

describe("image batch contracts", () => {
  it("routes both visible workbench modes through the grouped replication workflow", () => {
    expect(isGroupedImageBatchMode("style_replication")).toBe(true);
    expect(isGroupedImageBatchMode("multi_prompt")).toBe(true);
    expect(isGroupedImageBatchMode("unknown")).toBe(false);
  });

  it("splits non-empty prompt lines without guessing boundaries", () => {
    expect(splitBatchPrompts(" 雪地冷色调场景\r\n\r\n咖啡馆暖光场景 \n 纯白棚拍 ")).toEqual([
      "雪地冷色调场景",
      "咖啡馆暖光场景",
      "纯白棚拍",
    ]);
    expect(splitBatchPrompts("   \n\n")).toEqual([]);
  });

  it("merges item overrides without erasing shared values with undefined", () => {
    expect(
      mergeBatchSettings(
        { model: "nano-banana-pro", aspectRatio: "3:4", resolution: "2K" },
        { aspectRatio: "1:1", resolution: undefined },
      ),
    ).toEqual({ model: "nano-banana-pro", aspectRatio: "1:1", resolution: "2K" });
  });

  it("combines the shared and item prompts only when requested", () => {
    expect(combineBatchPrompt("保持产品外观准确", "雪地场景", true)).toBe(
      "保持产品外观准确\n雪地场景",
    );
    expect(combineBatchPrompt("保持产品外观准确", "雪地场景", false)).toBe("雪地场景");
    expect(combineBatchPrompt("", "雪地场景", true)).toBe("雪地场景");
  });

  it("aggregates draft, active and terminal states deterministically", () => {
    expect(aggregateBatchStatus([])).toBe("draft");
    expect(aggregateBatchStatus(["queued", "queued"])).toBe("queued");
    expect(aggregateBatchStatus(["queued", "running"])).toBe("running");
    expect(aggregateBatchStatus(["success", "success"])).toBe("success");
    expect(aggregateBatchStatus(["failed", "failed"])).toBe("failed");
    expect(aggregateBatchStatus(["cancelled", "cancelled"])).toBe("cancelled");
    expect(aggregateBatchStatus(["success", "failed"])).toBe("partial_success");
  });

  it("derives stable elapsed seconds from persisted timestamps", () => {
    const startedAt = new Date("2026-07-28T10:00:00.000Z");
    expect(elapsedSeconds(startedAt, new Date("2026-07-28T10:00:12.900Z"))).toBe(12);
    expect(elapsedSeconds(startedAt, new Date("2026-07-28T09:59:59.000Z"))).toBe(0);
    expect(elapsedSeconds(null, new Date())).toBeNull();
  });

  it("publishes the first-version hard limits", () => {
    expect(IMAGE_BATCH_LIMITS).toEqual({
      maxItems: 50,
      maxOutputs: 100,
      maxOutputsPerItem: 4,
      maxNameLength: 120,
      maxStyleProductImages: 20,
    });
  });
});
