import { describe, expect, it } from "vitest";
import { resolveModelDisplayName } from "@/lib/model-display-name";

describe("user model display names", () => {
  const names = { "minimax-h3": "海螺 H3", "gpt-image-2.5-apimart:fast": "GPT-Image-2.5 Fast", "gpt-image-2.5-apimart:pro": "GPT-Image-2.5 Pro", "gpt-image-2.5-aicoming-haiya": "海芽图像" };
  it("uses configured labels and falls back to the original for unnamed models", () => {
    expect(resolveModelDisplayName("minimax-h3", names)).toBe("海螺 H3");
    expect(resolveModelDisplayName("unconfigured", names)).toBe("unconfigured");
    expect(resolveModelDisplayName("minimax-h3", { "minimax-h3": " " })).toBe("minimax-h3");
  });
  it("uses the stored mode for Fast and Pro without changing the record", () => {
    const params = { gptImage25Mode: "sunburst" };
    expect(resolveModelDisplayName("gpt-image-2.5-apimart", names, params)).toBe("GPT-Image-2.5 Pro");
    expect(resolveModelDisplayName("gpt-image-2.5-apimart", names, { gptImage25Mode: "flare" })).toBe("GPT-Image-2.5 Fast");
    expect(resolveModelDisplayName("gpt-image-2.5-apimart:pro", names)).toBe("GPT-Image-2.5 Pro");
    expect(params).toEqual({ gptImage25Mode: "sunburst" });
    expect(resolveModelDisplayName("gpt-image-2.5-aicoming-haiya", names)).toBe("海芽图像");
  });
});
