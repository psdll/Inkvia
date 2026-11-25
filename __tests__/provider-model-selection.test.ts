import { describe, expect, it } from "vitest";
import { countSelectedModels, mergeModelCandidates } from "@/lib/providers/model-selection";

describe("provider model selection", () => {
  it("keeps selected models when a fresh upstream result does not include them", () => {
    const candidates = mergeModelCandidates(
      { image: ["upstream-image"], video: [], chat: ["upstream-chat"] },
      { image: ["existing-image"], video: ["existing-video"], chat: [] },
    );

    expect(candidates).toEqual({
      image: ["upstream-image", "existing-image"],
      video: ["existing-video"],
      chat: ["upstream-chat"],
    });
  });

  it("counts models selected across every category", () => {
    expect(countSelectedModels({ image: ["a"], video: ["b", "c"], chat: [] })).toBe(3);
  });
});
