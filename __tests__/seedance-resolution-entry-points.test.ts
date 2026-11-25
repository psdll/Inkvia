import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Seedance resolution UI entry points", () => {
  it("uses server-backed display specs in the video tool", () => {
    const video = source("app/video/video-tool.tsx");
    expect(video).toContain("getVideoDisplaySpec");
    expect(video).toContain('fetch("/api/toolbox/models?category=video"');
    expect(video).toContain("getVideoDisplaySpec(id, json.models)");
    expect(video).toContain("visibleVideoModels.find((item) => item.id === model)");
    expect(video).toContain('videoCapabilityStatus === "loaded"');
    expect(video).toContain('form.set("resolution", effectiveResolution)');
    expect(video).toContain("· ${effectiveResolution}");
  });

  it("fails closed and refreshes effective resolutions in inspiration templates", () => {
    const templates = source("components/admin/InspirationTemplatesPanel.tsx");
    expect(templates).toContain("getVideoDisplaySpec");
    expect(templates).toContain("videoCapabilityPayload");
    expect(templates).toContain('fetchJsonOnce<any>(`/api/toolbox/models?category=${category}`');
    expect(templates).toContain("getVideoDisplaySpec(selectedModel, videoCapabilityPayload)");
    expect(templates).toContain('videoCapabilityStatus === "loaded"');
    expect(templates).toContain("base.resolution = effectiveVideoResolution");
    const imageControls = templates.slice(
      templates.indexOf('{toolType === "image" ? ('),
      templates.indexOf('{toolType === "video" ? ('),
    );
    const videoControls = templates.slice(templates.indexOf('{toolType === "video" ? ('));
    expect(imageControls).toContain("value={resolution}");
    expect(imageControls).not.toContain("value={effectiveVideoResolution}");
    expect(videoControls).toContain("value={effectiveVideoResolution}");
  });
});
