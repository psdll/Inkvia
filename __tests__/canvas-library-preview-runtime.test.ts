import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/document";
import { useCanvasLibraryPreviewWarmup } from "@/components/canvas/CanvasLibraryPanel";

const warm = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn() }));
vi.mock("@/components/ui/resilient-image", () => ({ warmResilientImageCandidatesBatch: warm.start }));

let host: HTMLDivElement, root: Root;
const images = (count: number): CanvasNode[] => Array.from({ length: count }, (_, i) => ({
  id: String(i), type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: `/uploads/${i}.png` },
}));
function Warmup({ nodes }: { nodes: CanvasNode[] }) { useCanvasLibraryPreviewWarmup(nodes); return null; }
const render = async (nodes: CanvasNode[]) => act(async () => root.render(React.createElement(Warmup, { nodes })));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  warm.start.mockReset().mockReturnValue(warm.cancel); warm.cancel.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("canvas library preview warmup", () => {
  it("prepares only the first screen of small images, even with 1000 materials", async () => {
    await render(images(1000));
    const [groups, options] = warm.start.mock.calls[0];
    expect(groups).toHaveLength(12);
    expect(groups.every((group: string[]) => group[0].startsWith("/api/thumb?") && group[0].endsWith("w=120"))).toBe(true);
    expect(options).toMatchObject({ limit: 12, batchSize: 4 });
  });
  it("warms server video posters without fetching audio, original videos or upload blobs", async () => {
    await render([
      { id: "a", type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: "/uploads/a.mp3" } },
      { id: "v", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "/uploads/v.mp4" } },
      { id: "p", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "/uploads/p.mp4", posterUrl: "/uploads/poster.jpg" } },
      { id: "b", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "blob:upload" } },
    ]);
    const groups = warm.start.mock.calls[0][0];
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(["/api/thumb?src=%2Fuploads%2Fv.mp4&w=120&poster=1"]);
    expect(groups[1][0]).toContain("poster.jpg");
  });
  it("keeps warming during node movement and refreshes when new material arrives", async () => {
    const nodes = images(1);
    await render(nodes);
    await render(nodes.map(node => ({ ...node, position: { x: 100, y: 50 } })));
    expect(warm.start).toHaveBeenCalledTimes(1);
    expect(warm.cancel).not.toHaveBeenCalled();
    await render(images(2));
    expect(warm.start).toHaveBeenCalledTimes(2);
    expect(warm.cancel).toHaveBeenCalledTimes(1);
    await render([]);
    expect(warm.cancel).toHaveBeenCalledTimes(2);
  });
  it("does not start image or video preview requests for text and generated audio nodes", async () => {
    await render([
      { id: "text", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "文本" } },
      { id: "llm", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", prompt: "", status: "success", output: "生成文案" } },
      { id: "audio", type: "audioTask", position: { x: 0, y: 0 }, data: { kind: "audioTask", model: "speech", prompt: "", voiceId: "voice", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "success", outputUrl: "/uploads/voice.mp3" } },
    ]);
    expect(warm.start).not.toHaveBeenCalled();
  });
});
