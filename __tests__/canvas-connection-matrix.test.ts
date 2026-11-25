import { describe, expect, it } from "vitest";

function node(id: string, kind: string, data: Record<string, unknown> = {}) {
  const defaults = kind === "image"
    ? { url: `/${id}.png` }
    : kind === "video"
      ? { url: `/${id}.mp4` }
      : kind === "audio"
        ? { url: `/${id}.mp3` }
        : kind === "prompt"
          ? { text: id }
          : kind === "imageTask"
            ? { task: { references: [], settings: { model: "generic-image", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "standard", count: 1 }, batches: [] } }
            : kind === "videoTask"
              ? { model: "doubao-seedance-2-0-260128", prompt: "", mediaPaths: [], status: "idle" }
              : kind === "audioTask"
                ? { model: "speech-2.8-hd", prompt: "", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" }
              : kind === "llm"
                ? { prompt: "", status: "idle" }
                : {};
  return { id, type: kind, position: { x: 0, y: 0 }, data: { ...defaults, kind, ...data } } as any;
}

function imageTask(id: string, model = "generic-image", references: string[] = []) {
  return node(id, "imageTask", {
    task: {
      references: references.map((url, index) => ({ id: `configured-${index}`, url, name: `ref-${index}` })),
      settings: { model, prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "standard", count: 1 },
      batches: [],
    },
  });
}

function videoTask(id: string, model = "doubao-seedance-2-0-260128", mediaPaths: string[] = []) {
  return node(id, "videoTask", { model, prompt: "", mediaPaths, status: "idle" });
}

function edge(id: string, source: string, target: string) {
  return { id, source, target, type: "default" } as any;
}

async function loadRules() {
  const rules = await import("@/lib/canvas/connection-rules").catch(() => ({}));
  expect((rules as any).getCanvasConnectionDecision).toBeTypeOf("function");
  return rules as any;
}

describe("canvas typed connection matrix", () => {
  it.each([
    ["image", "imageTask", true],
    ["imageTask", "imageTask", true],
    ["prompt", "imageTask", true],
    ["llm", "imageTask", true],
    ["video", "imageTask", false],
    ["videoTask", "imageTask", false],
    ["audio", "imageTask", false],
    ["image", "videoTask", true],
    ["imageTask", "videoTask", true],
    ["video", "videoTask", true],
    ["videoTask", "videoTask", true],
    ["audio", "videoTask", true],
    ["prompt", "videoTask", true],
    ["llm", "videoTask", true],
    ["prompt", "llm", true],
    ["llm", "llm", true],
    ["image", "llm", true],
    ["imageTask", "llm", true],
    ["video", "llm", true],
    ["videoTask", "llm", true],
    ["audio", "llm", true],
    ["prompt", "audioTask", true],
    ["llm", "audioTask", true],
    ["image", "audioTask", false],
    ["video", "audioTask", false],
    ["audio", "audioTask", false],
    ["imageTask", "image", true],
    ["videoTask", "video", true],
    ["image", "video", false],
    ["video", "image", false],
  ])("evaluates %s -> %s as allowed=%s", async (sourceKind, targetKind, allowed) => {
    const { getCanvasConnectionDecision } = await loadRules();
    const nodes = [node("source", sourceKind), node("target", targetKind)];

    expect(getCanvasConnectionDecision(nodes, { source: "source", target: "target" }).allowed).toBe(allowed);
  });

  it("connects an audio task result into a generated audio material node", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    const decision = getCanvasConnectionDecision(
      [node("source", "audioTask"), node("target", "audio", { origin: "generated" })],
      { source: "source", target: "target" },
    );
    expect(decision).toMatchObject({ allowed: true, payloadKind: "audio" });
  });

  it.each(["prompt", "audio", "group", "loop"])("rejects input lines into %s nodes", async (targetKind) => {
    const { getCanvasConnectionDecision } = await loadRules();
    const decision = getCanvasConnectionDecision(
      [node("source", "image"), node("target", targetKind)],
      { source: "source", target: "target" },
    );

    expect(decision).toMatchObject({ allowed: false, targetKind });
    expect(decision.error).toContain("不接收输入连线");
  });

  it("accepts an image input for comparison", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    expect(getCanvasConnectionDecision([node("source", "image"), node("target", "compare")], { source: "source", target: "target" })).toMatchObject({ allowed: true, targetKind: "compare" });
  });

  it.each(["group", "loop", "compare"])("rejects %s as a user connection source", async (sourceKind) => {
    const { getCanvasConnectionDecision } = await loadRules();
    const decision = getCanvasConnectionDecision(
      [node("source", sourceKind), videoTask("target")],
      { source: "source", target: "target" },
    );

    expect(decision).toMatchObject({ allowed: false, sourceKind });
    expect(decision.error).toContain("不能作为连接起点");
  });

  it("returns a specific type error for a video result dragged onto an image task", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    const decision = getCanvasConnectionDecision(
      [node("source", "videoTask"), imageTask("target")],
      { source: "source", target: "target" },
    );

    expect(decision).toMatchObject({
      allowed: false,
      payloadKind: "video",
      error: "音频和视频素材不能连接图片任务",
    });
  });

  it("allows audio references into text tasks for model capability validation", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    const decision = getCanvasConnectionDecision(
      [node("source", "audio"), node("target", "llm")],
      { source: "source", target: "target" },
    );

    expect(decision).toMatchObject({
      allowed: true,
      payloadKind: "audio",
      error: null,
    });
  });

  it("keeps image -> imageTask allowed when a reverse path already exists", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    const source = node("source", "image");
    const target = imageTask("target");

    expect(getCanvasConnectionDecision(
      [source, target],
      { source: "source", target: "target" },
      [edge("reverse", "target", "source")],
    )).toMatchObject({
      allowed: true,
      error: null,
      payloadKind: "image",
    });
  });

  it("keeps image -> imageTask allowed with other inputs and many configured references", async () => {
    const { getCanvasConnectionDecision } = await loadRules();
    const target = imageTask(
      "target",
      "midjourney-v8-reapi",
      Array.from({ length: 40 }, (_, index) => `/configured-${index}.png`),
    );
    const nodes = [node("source", "image"), target, node("prompt", "prompt"), node("other-image", "image")];
    const edges = [edge("prompt-input", "prompt", "target"), edge("image-input", "other-image", "target")];

    expect(getCanvasConnectionDecision(nodes, { source: "source", target: "target" }, edges)).toMatchObject({
      allowed: true,
      error: null,
      payloadKind: "image",
    });
  });
});
