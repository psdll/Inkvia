import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const nodeSource = readFileSync("components/canvas/CanvasAudioNode.tsx", "utf8");
const cardSource = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const playbackSource = readFileSync("components/canvas/CanvasAudioPlayback.tsx", "utf8");
const editorSource = readFileSync("components/canvas/CanvasEditorPage.tsx", "utf8");

describe("canvas audio node UI", () => {
  it.each(["audioTask", "audio"])("keeps download but removes the enlarged preview from the %s toolbar", (kind) => {
    const toolbar = cardSource.split(/\r?\n/).find((line) => line.includes(`data.kind === "${kind}"`) && line.includes("<CanvasMaterialToolbar>"));
    expect(toolbar).toBeDefined();
    expect(toolbar).toContain('title="下载"');
    expect(toolbar).not.toContain("CanvasMaterialPreviewButton");
    expect(toolbar).not.toContain("CanvasMaterialToolbarSeparator");
  });

  it.each(["imageTask", "videoTask", "image", "video"])("retains enlarged preview for the %s toolbar", (kind) => {
    const toolbar = cardSource.split(/\r?\n/).find((line) => line.includes(`data.kind === "${kind}"`) && line.includes("<CanvasMaterialToolbar>"));
    expect(toolbar).toContain("CanvasMaterialPreviewButton");
  });

  it("keeps audio error details on the result node, not in the editor footer", () => {
    const audioPanel = cardSource.slice(cardSource.indexOf("function AudioTaskPanel("), cardSource.indexOf("function LlmTaskPanel("));

    expect(audioPanel).not.toContain("error={data.error}");
    expect(audioPanel).not.toContain("<Status");
    expect(cardSource).toContain("data-canvas-task-failure");
    expect(cardSource).toContain('<span className="line-clamp-3">{uiError(friendlyErrorDisplayText(failed))}</span>');
  });

  it("renders a themed waveform with live progress and one shared player", () => {
    expect(nodeSource).toContain("createCanvasWaveformPath");
    expect(nodeSource).toContain("useCanvasAudioPlayback");
    expect(nodeSource).toContain("var(--input-bg)");
    expect(nodeSource).toContain("var(--primary-bg)");
    expect(nodeSource).toContain("clipPath");
    expect(nodeSource).toContain("data-canvas-audio-playhead");
    expect(cardSource).toContain("<CanvasAudioNode");
    expect(cardSource).not.toContain('<audio src={data.url} controls');
  });

  it("keeps the waveform draggable outside the red seek handle and centers the play button", () => {
    const waveformStart = nodeSource.indexOf("data-waveform-ready");
    const waveformEnd = nodeSource.indexOf(">", waveformStart);
    const waveformSource = nodeSource.slice(waveformStart, waveformEnd);

    expect(waveformSource).not.toContain("nodrag");
    expect(waveformSource).not.toContain("onPointerDown");
    expect(nodeSource).toContain('role="slider"');
    expect(nodeSource).toContain("setPointerCapture");
    expect(nodeSource).toContain("var(--color-danger,#ef4444)");
    expect(nodeSource).toContain("data-canvas-audio-controls");
    expect(nodeSource).toContain("grid-cols-[1fr_auto_1fr]");
    expect(nodeSource).toContain('data-canvas-audio-play-button');
    expect(nodeSource).toContain('className="nodrag');
    expect(nodeSource).not.toContain("ml-auto");
    expect(nodeSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
  });

  it("does not detach the shared player during React strict-effect replay", () => {
    expect(playbackSource).toContain("ref={audioRef}");
    expect(playbackSource).not.toContain("controller.attach(null)");
  });

  it("uses the same size for uploaded, generated, and existing audio nodes", async () => {
    const mediaSizeModule = await import("@/lib/canvas/media-size");
    const { getCanvasTaskPrimaryFrameSize } = await import("@/lib/canvas/task-references");
    const { getCanvasUrlMediaNodeSize } = await import("@/lib/canvas/local-upload-size");
    const compactCanvasAudioNodeSizes = (mediaSizeModule as any).compactCanvasAudioNodeSizes;
    const document = {
      schemaVersion: 2,
      mode: "smart",
      nodes: [{
        id: "audio-a",
        type: "audio",
        position: { x: 0, y: 0 },
        data: { kind: "audio", url: "/a.mp3", name: "a.mp3" },
        width: 300,
        height: 120,
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };

    const size = { width: 420, height: 200 };
    expect(mediaSizeModule.DEFAULT_CANVAS_AUDIO_NODE_SIZE).toEqual(size);
    expect(getCanvasTaskPrimaryFrameSize({
      kind: "audioTask", model: "speech-2.8-hd", prompt: "", voiceId: "female-shaonv",
      speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0,
      soundEffect: "", status: "idle",
    })).toEqual(size);
    expect(await getCanvasUrlMediaNodeSize("/a.mp3", "audio")).toEqual(size);
    expect(compactCanvasAudioNodeSizes).toBeTypeOf("function");
    const normalized = compactCanvasAudioNodeSizes(document);
    expect(normalized.nodes[0]).toMatchObject({ ...size, position: document.nodes[0].position, data: document.nodes[0].data });
    expect(compactCanvasAudioNodeSizes(normalized)).toBe(normalized);
    expect(editorSource).toContain("compactCanvasAudioNodeSizes(loaded.document)");
  });

  it("lazily analyzes legacy audio when selected or played", () => {
    expect(nodeSource).toContain("analyzeAudioUrlCached");
    expect(nodeSource).toContain("selected");
    expect(nodeSource).toContain("onWaveformReady");
  });
});
