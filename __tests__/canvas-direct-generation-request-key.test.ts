import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { validate as validateUuid } from "uuid";
import { createImageTaskBatch } from "@/lib/canvas/execution";
import { parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { submitImageGen, submitVideoGen, submitAudioGen } from "@/components/canvas/run-node";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  createImageGeneration: vi.fn(),
  createVideoGeneration: vi.fn(),
  createAudioGeneration: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/canvas/editor-session-server", () => ({ canvasEditorSessionMatches: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/generation/image-service", () => ({
  createImageGeneration: mocks.createImageGeneration,
  ImageGenerationError: class ImageGenerationError extends Error {},
}));
vi.mock("@/lib/generation/video-service", () => ({
  createVideoGeneration: mocks.createVideoGeneration,
  VideoGenerationError: class VideoGenerationError extends Error {},
}));

vi.mock("@/lib/generation/audio-service", () => ({ createAudioGeneration: mocks.createAudioGeneration, AudioGenerationError: class AudioGenerationError extends Error {} }));

const imageRequestKey = "11111111-1111-4111-8111-111111111111";
const videoRequestKey = "22222222-2222-4222-8222-222222222222";

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("canvas direct generation request keys", () => {
  it("transports audio text references independently and includes them exactly once in speech", async () => {
    mocks.createAudioGeneration.mockResolvedValue({ generationId: 93, status: "running" });
    const { POST } = await import("@/app/api/canvas/generate-audio/route");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(new NextRequest("http://localhost/api/canvas/generate-audio", { method: init?.method, headers: init?.headers, body: init?.body })));
    try {
      await submitAudioGen({ canvasId: 55, sessionId: "session-current", requestKey: imageRequestKey, model: "speech-2.8-hd", text: "", textList: ["你好"], voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "" });
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ text: "", textList: ["你好"] });
      expect(mocks.createAudioGeneration).toHaveBeenCalledWith(expect.objectContaining({ text: "你好" }));
    } finally { fetchMock.mockRestore(); }
  });
  it.each(["image", "video"])("keeps %s text references separate on the wire and includes them in the provider prompt", async kind => {
    const { POST } = kind === "image" ? await import("@/app/api/canvas/generate/route") : await import("@/app/api/canvas/generate-video/route");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(new NextRequest("http://localhost/api/canvas/generate", { method: init?.method, headers: init?.headers, body: init?.body })));
    try {
      const submit = kind === "image" ? submitImageGen : submitVideoGen;
      await submit({ canvasId: 55, sessionId: "session-current", requestKey: imageRequestKey, prompt: "去除按摩椅", textList: ["人物保留"] });
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ prompt: "去除按摩椅", textList: ["人物保留"] });
      expect(kind === "image" ? mocks.createImageGeneration : mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({ prompt: "去除按摩椅人物保留" }));
      await submit({ canvasId: 55, sessionId: "session-current", requestKey: videoRequestKey, prompt: "", textList: ["仅文本节点"] });
      expect(kind === "image" ? mocks.createImageGeneration : mocks.createVideoGeneration).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: "仅文本节点" }));
    } finally { fetchMock.mockRestore(); }
  });
  it("passes transparent output settings from the canvas client through its API to generation", async () => {
    const { POST } = await import("@/app/api/canvas/generate/route");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(new NextRequest("http://localhost/api/canvas/generate", { method: init?.method, headers: init?.headers, body: init?.body })));
    try {
      await submitImageGen({ canvasId: 55, sessionId: "session-current", requestKey: imageRequestKey, prompt: "chair", model: "gpt-image-2.5-reapi", background: "transparent", outputFormat: "png" });
      expect(mocks.createImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-image-2.5-reapi", background: "transparent", outputFormat: "png" }));
    } finally {
      fetchMock.mockRestore();
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.createImageGeneration.mockResolvedValue({ generationId: 91, taskId: "image-task", status: "running" });
    mocks.createVideoGeneration.mockResolvedValue({ generationId: 92, taskId: "video-task", status: "running" });
  });

  it("assigns a stable UUID to every new canvas image output", () => {
    const batch = createImageTaskBatch({
      model: "gpt-image-2",
      prompt: "chair",
      aspectRatio: "1:1",
      resolution: "1K",
      quality: "",
      count: 2,
    }, 100, (prefix) => `${prefix}-id`);

    expect(batch.outputs.map((output) => output.requestKey)).toHaveLength(2);
    expect(batch.outputs.every((output) => validateUuid(output.requestKey || ""))).toBe(true);
    expect(new Set(batch.outputs.map((output) => output.requestKey)).size).toBe(2);
  });

  it("preserves a video submission request key in the canvas document", () => {
    const parsed = parseCanvasDocumentV2({
      schemaVersion: 2,
      mode: "smart",
      nodes: [{
        id: "video-1",
        type: "videoTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "videoTask",
          model: "seedance-2.0",
          prompt: "animate",
          mediaPaths: [],
          status: "submitting",
          requestKey: videoRequestKey,
        },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    });

    const data = parsed.nodes[0]?.data;
    expect(data?.kind).toBe("videoTask");
    expect(data?.kind === "videoTask" ? data.requestKey : undefined).toBe(videoRequestKey);
  });

  it("sends request keys from the canvas client", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, generationId: 91, status: "running" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, generationId: 92, status: "running" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitImageGen({ requestKey: imageRequestKey, prompt: "chair", canvasId: 55, sessionId: "session-current" });
    await submitVideoGen({ requestKey: videoRequestKey, prompt: "animate", canvasId: 55, sessionId: "session-current" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ requestKey: imageRequestKey });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ requestKey: videoRequestKey });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Canvas-Session-Id")).toBe("session-current");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Canvas-Id")).toBe("55");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-Canvas-Session-Id")).toBe("session-current");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-Canvas-Id")).toBe("55");
    vi.unstubAllGlobals();
  });

  it("forwards valid request keys through both canvas routes", async () => {
    const { POST: postImage } = await import("@/app/api/canvas/generate/route");
    const { POST: postVideo } = await import("@/app/api/canvas/generate-video/route");

    const imageResponse = await postImage(jsonRequest("http://localhost/api/canvas/generate", {
      prompt: "chair",
      requestKey: imageRequestKey,
    }));
    const videoResponse = await postVideo(jsonRequest("http://localhost/api/canvas/generate-video", {
      prompt: "animate",
      requestKey: videoRequestKey,
    }));

    expect(imageResponse.status).toBe(200);
    expect(videoResponse.status).toBe(200);
    expect(mocks.createImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ requestKey: imageRequestKey }));
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({ requestKey: videoRequestKey }));
  });

  it("forwards Seedance 2.5 options through the direct canvas route", async () => {
    const { POST: postVideo } = await import("@/app/api/canvas/generate-video/route");

    const response = await postVideo(jsonRequest("http://localhost/api/canvas/generate-video", {
      prompt: "extend the clip",
      requestKey: videoRequestKey,
      model: "doubao-seedance-2-5-260628",
      omniReferenceTaskType: "extend",
      outputFormat: "mov",
    }));

    expect(response.status).toBe(200);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      omniReferenceTaskType: "extend",
      outputFormat: "mov",
    }));
  });

  it("rejects malformed request keys before calling generation services", async () => {
    const { POST: postImage } = await import("@/app/api/canvas/generate/route");
    const { POST: postVideo } = await import("@/app/api/canvas/generate-video/route");

    const imageResponse = await postImage(jsonRequest("http://localhost/api/canvas/generate", {
      prompt: "chair",
      requestKey: "not-a-uuid",
    }));
    const videoResponse = await postVideo(jsonRequest("http://localhost/api/canvas/generate-video", {
      prompt: "animate",
      requestKey: "not-a-uuid",
    }));

    expect(imageResponse.status).toBe(400);
    expect(videoResponse.status).toBe(400);
    expect(mocks.createImageGeneration).not.toHaveBeenCalled();
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
  });

  it("rejects direct canvas submissions that omit a request key", async () => {
    const { POST: postImage } = await import("@/app/api/canvas/generate/route");
    const { POST: postVideo } = await import("@/app/api/canvas/generate-video/route");

    const imageResponse = await postImage(jsonRequest("http://localhost/api/canvas/generate", { prompt: "chair" }));
    const videoResponse = await postVideo(jsonRequest("http://localhost/api/canvas/generate-video", { prompt: "animate" }));

    expect(imageResponse.status).toBe(400);
    expect(videoResponse.status).toBe(400);
    expect(mocks.createImageGeneration).not.toHaveBeenCalled();
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
  });

  it("reuses persisted keys when direct canvas submissions are resumed", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

    expect(board).toContain("requestKey: outputRequestKey");
    expect(board).toContain("requestKey: videoRequestKey");
    expect(board).toContain('output.status === "submitting" && output.requestKey');
    expect(board).toContain('node.data.status === "submitting" && node.data.requestKey');
    expect(board).toContain('output.status === "submitting" && !output.generationId && !output.requestKey');
    expect(board).toContain('node.data.status === "submitting" && !node.data.generationId && !node.data.requestKey');
  });
});
