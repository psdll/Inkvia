import { describe, expect, it } from "vitest";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("removed AIComing nano-banana-pro model", () => {
  it("keeps the retired Rain model absent while preserving current Haiya models", () => {
    const ids = IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id);

    expect(ids).not.toContain("nano-banana-pro-aicoming");
    expect(ids).not.toContain(["gpt-image-2-official", "aicoming"].join("-"));
    expect(ids).toContain("gpt-image-2-aicoming-haiya");
    expect(ids).toContain("nano-banana-pro-aicoming-haiya");
  });
});
