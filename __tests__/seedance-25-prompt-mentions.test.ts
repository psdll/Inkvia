import { describe, expect, it } from "vitest";
import { generationReferenceFormat } from "@/lib/generation/prompt-references";

describe("Seedance 2.5 prompt asset mentions", () => {
  it("selects the official mention format from the shared model policy", () => {
    expect(generationReferenceFormat("video", "doubao-seedance-2-5-260628")).toBe("seedance25_mentions");
    expect(generationReferenceFormat("video", "doubao-seedance-2-0-260128")).toBe("ordinal");
    expect(generationReferenceFormat("video", "doubao-seedance-1-5-pro-251215")).toBe("reference_map");
  });
});
