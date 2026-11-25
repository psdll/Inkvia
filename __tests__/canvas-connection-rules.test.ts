import { describe, expect, it } from "vitest";

function node(id: string, kind: string) {
  return { id, type: kind, position: { x: 0, y: 0 }, data: { kind } };
}

function edge(id: string, source: string, target: string) {
  return { id, source, target, type: "default" };
}

async function loadRules() {
  const rules = await import("@/lib/canvas/connection-rules").catch(() => ({}));
  expect((rules as any).isCanvasConnectionAllowed).toBeTypeOf("function");
  expect((rules as any).getCanvasConnectionError).toBeTypeOf("function");
  return rules as any;
}

describe("canvas connection rules", () => {
  it.each(["video", "audio"])("rejects %s material connected to an image task", async (sourceKind) => {
    const { getCanvasConnectionError, isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", sourceKind), node("target", "imageTask")];

    expect(isCanvasConnectionAllowed(nodes, { source: "source", target: "target" })).toBe(false);
    expect(getCanvasConnectionError(nodes, { source: "source", target: "target" })).toBe("音频和视频素材不能连接图片任务");
  });

  it.each(["image", "prompt"])("allows %s connected to an image task", async (sourceKind) => {
    const { isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", sourceKind), node("target", "imageTask")];

    expect(isCanvasConnectionAllowed(nodes, { source: "source", target: "target" })).toBe(true);
  });

  it.each(["video", "audio"])("still allows %s material connected to a video task", async (sourceKind) => {
    const { isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", sourceKind), node("target", "videoTask")];

    expect(isCanvasConnectionAllowed(nodes, { source: "source", target: "target" })).toBe(true);
  });

  it("keeps rejecting material-to-material connections", async () => {
    const { isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", "audio"), node("target", "image")];

    expect(isCanvasConnectionAllowed(nodes, { source: "source", target: "target" })).toBe(false);
  });

  it("rejects self connections with a specific error", async () => {
    const { getCanvasConnectionError, isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("same", "prompt")];

    expect(isCanvasConnectionAllowed(nodes, { source: "same", target: "same" })).toBe(false);
    expect(getCanvasConnectionError(nodes, { source: "same", target: "same" })).toBe("节点不能连接自身");
  });

  it("rejects duplicate endpoint pairs but lets reconnect ignore the edge being replaced", async () => {
    const { getCanvasConnectionError, isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", "prompt"), node("target", "imageTask")];
    const edges = [edge("edge-1", "source", "target")];
    const connection = { source: "source", target: "target" };

    expect(isCanvasConnectionAllowed(nodes, connection, edges)).toBe(false);
    expect(getCanvasConnectionError(nodes, connection, edges)).toBe("这条连线已存在");
    expect(isCanvasConnectionAllowed(nodes, connection, edges, { ignoreEdgeId: "edge-1" })).toBe(true);
  });

  it("rejects a non-empty endpoint id that no longer exists", async () => {
    const { getCanvasConnectionError, isCanvasConnectionAllowed } = await loadRules();
    const nodes = [node("source", "prompt"), node("target", "imageTask")];

    expect(isCanvasConnectionAllowed(nodes, { source: "deleted-source", target: "target" })).toBe(false);
    expect(getCanvasConnectionError(nodes, { source: "deleted-source", target: "target" })).toBe("连接起点不存在");
    expect(isCanvasConnectionAllowed(nodes, { source: "source", target: "deleted-target" })).toBe(false);
    expect(getCanvasConnectionError(nodes, { source: "source", target: "deleted-target" })).toBe("连接目标不存在");
  });
});
