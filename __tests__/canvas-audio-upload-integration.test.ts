import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("canvas audio upload integration", () => {
  it("analyzes uploads once, hydrates node metadata, and culls offscreen media", () => {
    const source = fs.readFileSync(path.join(root, "components/canvas/SmartCanvasBoard.tsx"), "utf8");

    expect(source).toContain("analyzeAudioFile(file)");
    expect(source).toContain("registerAudioWaveformPromise(payload.url");
    expect(source).toContain("hydrateAudioWaveform");
    expect(source).toContain("hydrateCanvasAudioNode");
    expect(source).toContain("onlyRenderVisibleElements");
    expect(source).toContain("CanvasAudioPlaybackProvider");
  });

  it("keeps the shared player outside the culled React Flow tree", () => {
    const source = fs.readFileSync(path.join(root, "components/canvas/SmartCanvasBoard.tsx"), "utf8");
    const providerStart = source.indexOf("<CanvasAudioPlaybackProvider");
      const flowStart = source.indexOf("<ReactFlow", providerStart);
    const flowEnd = source.indexOf("</ReactFlow>", flowStart);
    const providerEnd = source.indexOf("</CanvasAudioPlaybackProvider>", providerStart);

    expect(providerStart).toBeGreaterThan(0);
    expect(flowStart).toBeGreaterThan(providerStart);
    expect(providerEnd).toBeGreaterThan(flowEnd);
  });
});
