import { describe, expect, it } from "vitest";
import {
  decodeCanvasLlmRouteKey,
  encodeCanvasLlmRouteKey,
  getCanvasLlmSelectionState,
  resolveCanvasLlmSelection,
} from "@/lib/canvas/llm-selection";

const candidates = [
  { providerId: "first/provider", modelId: "shared:model" },
  { providerId: "second provider", modelId: "shared:model" },
  { providerId: "second provider", modelId: "unique/模型" },
];

describe("canvas LLM selection", () => {
  it("round trips provider/model route keys without collisions", () => {
    const key = encodeCanvasLlmRouteKey("second provider", "unique/模型");
    expect(decodeCanvasLlmRouteKey(key)).toEqual({ providerId: "second provider", modelId: "unique/模型" });
    expect(key).not.toBe(encodeCanvasLlmRouteKey("second", "provider/unique/模型"));
  });

  it("matches a legacy model string by candidate order", () => {
    expect(resolveCanvasLlmSelection(candidates, undefined, "shared:model")).toEqual(candidates[0]);
  });

  it("prefers the new provider/model override over a legacy model string", () => {
    expect(resolveCanvasLlmSelection(
      candidates,
      { providerId: "second provider", modelId: "unique/模型" },
      "shared:model",
    )).toEqual(candidates[2]);
  });

  it("marks a stored override as invalid instead of presenting it as the backend default", () => {
    expect(getCanvasLlmSelectionState(
      candidates,
      { providerId: "removed-provider", modelId: "removed-model" },
      "",
    )).toEqual({ selection: undefined, invalidOverride: true });
  });
});
