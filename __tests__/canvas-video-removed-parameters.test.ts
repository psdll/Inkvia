import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("canvas video removed parameters", () => {
  it("does not expose camera-fixed or watermark controls", () => {
    const source = read("components/canvas/CanvasNodeCard.tsx");
    const panel = source.slice(source.indexOf("function VideoTaskPanel"), source.indexOf("function ViewportFixedTaskPanel"));

    expect(panel).toContain('<CanvasAudioToggle checked={Boolean(data.generateAudio)}');
    expect(panel).not.toContain('label="固定镜头"');
    expect(panel).not.toContain('label="水印"');
    expect(panel).not.toContain("data.cameraFixed");
    expect(panel).not.toContain("data.watermark");
  });

  it("omits removed watermark fields while forwarding the creative camera selection", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const submit = read("components/canvas/run-node.ts");
    const route = read("app/api/canvas/generate-video/route.ts");

    expect(board).not.toContain("cameraFixed: node.data.cameraFixed");
    expect(board).not.toContain("watermark: node.data.watermark");
    expect(submit).not.toMatch(/watermark\?: boolean/);
    expect(submit).toContain("cameraFixed?: boolean");
    expect(board).toContain("cameraFixed: submittedData.cameraFixed");
    expect(route).toContain("cameraFixed: body?.cameraFixed === true");
    expect(route).not.toContain("body?.watermark");
  });
});
