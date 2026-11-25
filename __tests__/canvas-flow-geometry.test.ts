import { describe, expect, it } from "vitest";
import { getCanvasFlowGeometry } from "@/lib/canvas/flow-geometry";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { normalizeCanvasTaskNodeSizes } from "@/lib/canvas/task-references";

describe("initial canvas geometry before a node enters the viewport", () => {
  it("preserves a generated text result's resized frame and connection geometry after loading", () => {
    const size = { width: 620, height: 420 };
    const node: CanvasNode = { id: "text", type: "llm", position: { x: 0, y: 0 }, width: size.width, height: size.height,
      data: { kind: "llm", prompt: "", status: "success", output: "生成内容", resultFrameSize: size } };
    const loaded = parseCanvasDocumentV2({ ...createEmptyCanvasDocumentV2(), nodes: [node] });
    const normalized = normalizeCanvasTaskNodeSizes(loaded);
    expect(normalized.nodes[0]).toMatchObject({ ...size, data: { resultFrameSize: size } });
    const geometry = getCanvasFlowGeometry(normalized.nodes[0]);
    expect(geometry.measured).toEqual(size);
    expect(geometry.handles.find(handle => handle.id === "canvas-right-output")).toMatchObject({ x: size.width, y: size.height / 2 });
  });
  it.each([
    { status: "idle" as const, height: 350 },
    { status: "running" as const, height: 200 },
    { status: "success" as const, output: "生成内容", height: 200 },
    { status: "failed" as const, error: "失败", height: 200 },
  ])("keeps text task handles centered at its rendered height in $status state", ({ height, ...data }) => {
    const geometry = getCanvasFlowGeometry({ id: "text", type: "llm", position: { x: 0, y: 0 }, width: 350, height: 200, data: { kind: "llm", prompt: "", ...data } });
    expect(geometry.measured).toEqual({ width: 350, height });
    expect(geometry.handles.find(handle => handle.id === "canvas-task-input")).toMatchObject({ x: 0, y: height / 2 });
    expect(geometry.handles.find(handle => handle.id === "canvas-right-output")).toMatchObject({ x: 350, y: height / 2 });
    expect(geometry.handles.find(handle => handle.id === "canvas-task-body-target")).toMatchObject({ width: 350, height });
  });
  it.each(["image", "video", "audio"] as const)("keeps both outgoing endpoints for offscreen uploaded %s without accepting inputs", (kind) => {
    const node: CanvasNode = { id: kind, type: kind, position: { x: 9000, y: -5000 }, data: { kind, url: "/uploaded", origin: "upload" }, width: 700, height: 350 };
    const { handles } = getCanvasFlowGeometry(node);
    expect(handles.find((handle) => handle.id === "canvas-left-output")).toMatchObject({ type: "source", x: 0, y: 175 });
    expect(handles.find((handle) => handle.id === "canvas-right-output")).toMatchObject({ type: "source", x: 700, y: 175 });
    expect(handles.some((handle) => handle.type === "target")).toBe(false);
  });
  it("gives unseen media both dimensions and usable source/body/input handles", () => {
    const node: CanvasNode = { id: "image", type: "image", position: { x: 9000, y: 0 }, data: { kind: "image", url: "/image.png" }, width: 700, height: 350 };
    const geometry = getCanvasFlowGeometry(node);
    expect(geometry.measured).toEqual({ width: 700, height: 350 });
    expect(geometry.handles.find((handle) => handle.type === "source")).toMatchObject({ x: 700, y: 175 });
    expect(geometry.handles.find((handle) => handle.id === "canvas-media-input")).toMatchObject({ x: 0, y: 175 });
    expect(geometry.handles.find((handle) => handle.id === "canvas-media-body-target")).toMatchObject({ x: -20, y: -20, width: 740, height: 390 });
  });
  it("uses the same missing-size defaults as text and audio cards", () => {
    expect(getCanvasFlowGeometry({ id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "" } }).measured).toEqual({ width: 350, height: 200 });
    expect(getCanvasFlowGeometry({ id: "a", type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: "/a.mp3" } }).measured).toEqual({ width: 420, height: 200 });
  });
  it("does not add connection handles to groups", () => {
    expect(getCanvasFlowGeometry({ id: "g", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "Group", collapsed: false }, width: 800, height: 700 }).handles).toEqual([]);
  });
});
