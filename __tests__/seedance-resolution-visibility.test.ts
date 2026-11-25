import { describe, expect, it } from "vitest";
import {
  getConfigurableSeedanceResolutions,
  getEffectiveVideoResolutions,
  getVideoDisplayResolution,
  getVideoDisplaySpec,
  normalizeSeedanceResolutionVisibility,
} from "@/lib/video-resolution-visibility";

describe("Seedance resolution visibility", () => {
  it("derives controls only from native Seedance 1080p/4k support", () => {
    expect(getConfigurableSeedanceResolutions("doubao-seedance-2-0-260128")).toEqual(["1080p", "4k"]);
    expect(getConfigurableSeedanceResolutions("doubao-seedance-1-5-pro-251215")).toEqual([]);
    expect(getConfigurableSeedanceResolutions("doubao-seedance-2-0-fast-260128")).toEqual([]);
    expect(getConfigurableSeedanceResolutions("gemini-omni-video")).toEqual([]);
  });

  it("normalizes only known native high-resolution flags and defaults them on", () => {
    const normalized = normalizeSeedanceResolutionVisibility({
      "doubao-seedance-2-0-260128": { "1080p": false, "4k": "no", "720p": false },
      "doubao-seedance-2-0-fast-260128": { "1080p": false },
      "gemini-omni-video": { "4k": false },
    });

    expect(normalized["doubao-seedance-2-0-260128"]).toEqual({ "1080p": false, "4k": true });
    expect(normalized["doubao-seedance-2-0-fast-260128"]).toEqual({});
    expect(normalized).not.toHaveProperty("gemini-omni-video");
  });

  it("filters disabled Seedance high resolutions without touching base or non-Seedance choices", () => {
    const visibility = normalizeSeedanceResolutionVisibility({
      "doubao-seedance-2-0-260128": { "1080p": false, "4k": false },
      "gemini-omni-video": { "1080p": false, "4k": false },
    });

    expect(getEffectiveVideoResolutions("doubao-seedance-2-0-260128", visibility)).toEqual(["480p", "720p"]);
    expect(getEffectiveVideoResolutions("gemini-omni-video", visibility)).toEqual([]);
  });

  it("fails closed for Seedance until a valid server payload is available", () => {
    const pending = getVideoDisplaySpec("doubao-seedance-2-0-260128", []);
    const enabled = getVideoDisplaySpec("doubao-seedance-2-0-260128", [
      { id: "doubao-seedance-2-0-260128", supportedResolutions: ["480p", "720p", "1080p"] },
    ]);
    expect(pending.supportedResolutions).toEqual(["480p", "720p"]);
    expect(getVideoDisplaySpec("gemini-omni-video", []).id).not.toBe("gemini-omni-video");
    expect(enabled.supportedResolutions).toEqual(["480p", "720p", "1080p"]);
    expect(getVideoDisplayResolution(pending, "1080p")).toBe("480p");
    expect(getVideoDisplayResolution(enabled, "1080p")).toBe("1080p");
  });
});
