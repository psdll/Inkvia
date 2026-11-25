import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas connection target feedback", () => {
  it("converts the renderer-local pointer into the transformed flow coordinate system", async () => {
    const feedback = await import("@/lib/canvas/connection-feedback").catch(() => ({}));
    const rendererPointToFlowPoint = (feedback as any).canvasRendererPointToFlowPoint;

    expect(rendererPointToFlowPoint).toBeTypeOf("function");
    if (typeof rendererPointToFlowPoint !== "function") return;

    expect(rendererPointToFlowPoint(
      { x: 1169, y: 211 },
      [546, 444, 0.35],
    )).toEqual({ x: 1780, y: -665.7142857142858 });
  });

  it("maps pointer position to a clamped eight-degree perspective tilt", async () => {
    const feedback = await import("@/lib/canvas/connection-feedback").catch(() => ({}));
    expect((feedback as any).getCanvasConnectionTargetTilt).toBeTypeOf("function");
    const tilt = (feedback as any).getCanvasConnectionTargetTilt;
    if (typeof tilt !== "function") return;

    expect(tilt({ x: 50, y: 50 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ rotateX: 0, rotateY: 0 });
    expect(tilt({ x: 200, y: -100 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ rotateX: 8, rotateY: 8 });
    expect(tilt({ x: -100, y: 200 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ rotateX: -8, rotateY: -8 });
  });

  it("keeps an incompatible whole-card target invalid even when xyflow reports a null radius status", async () => {
    const feedback = await import("@/lib/canvas/connection-feedback").catch(() => ({}));
    const resolveCandidateState = (feedback as any).resolveCanvasConnectionCandidateState;

    expect(resolveCandidateState).toBeTypeOf("function");
    if (typeof resolveCandidateState !== "function") return;

    expect(resolveCandidateState(true, true)).toBe("valid");
    expect(resolveCandidateState(false, true)).toBe("invalid");
    expect(resolveCandidateState(null, true)).toBe("invalid");
    expect(resolveCandidateState(null, false)).toBeNull();
  });

  it("lets the card under the pointer own feedback when xyflow selects a nearby handle", async () => {
    const feedback = await import("@/lib/canvas/connection-feedback").catch(() => ({}));
    const resolveTargetState = (feedback as any).resolveCanvasNodeConnectionTargetState;

    expect(resolveTargetState).toBeTypeOf("function");
    if (typeof resolveTargetState !== "function") return;

    const pointerTarget = { nodeId: "node-b", state: "invalid" };
    expect(resolveTargetState("node-a", "valid", pointerTarget)).toBeNull();
    expect(resolveTargetState("node-b", null, pointerTarget)).toBe("invalid");
    expect(resolveTargetState("node-a", "valid", null)).toBe("valid");
  });

  it("keeps every task-card connection preview attached to the live pointer", async () => {
    const feedback = await import("@/lib/canvas/connection-feedback").catch(() => ({}));
    const resolvePreviewTarget = (feedback as any).resolveCanvasConnectionPreviewTarget;

    expect(resolvePreviewTarget).toBeTypeOf("function");
    if (typeof resolvePreviewTarget !== "function") return;

    expect(resolvePreviewTarget(
      { x: 420, y: 240 },
      { x: 515, y: 318 },
      "canvas-task-body-target",
      "imageTask",
    )).toEqual({ x: 515, y: 318 });
    expect(resolvePreviewTarget(
      { x: 420, y: 240 },
      { x: 515, y: 318 },
      null,
      "videoTask",
    )).toEqual({ x: 515, y: 318 });
    expect(resolvePreviewTarget(
      { x: 420, y: 240 },
      { x: 515, y: 318 },
      "canvas-media-input",
      "llm",
    )).toEqual({ x: 515, y: 318 });
    expect(resolvePreviewTarget(
      { x: 420, y: 240 },
      { x: 515, y: 318 },
      null,
      "image",
    )).toEqual({ x: 420, y: 240 });
  });

  it("uses the same target feedback and handle language across media, tasks, and text", () => {
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const textNode = readFileSync("components/canvas/CanvasTextNode.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(card).toContain("scheduleCanvasConnectionTargetTilt");
    expect(card).toContain("resetCanvasConnectionTargetTilts");
    expect(card).toContain("resetCanvasConnectionTargetTilts");
    expect(textNode).toContain("data-canvas-connection-target-state");
    expect(textNode).toContain("canvas-connection-target");
    expect(styles).toContain("perspective: 800px");
    expect(styles).toContain("canvas-connection-target-valid-border-flow");
    expect(styles).toContain("conic-gradient");
    expect(styles).toContain(".canvas-connection-target-invalid::before");
    expect(styles).toContain("background: rgba(0, 0, 0, 0.35)");
    expect(styles).toMatch(/\.canvas-connection-target-invalid::before\s*\{\s*opacity: 1;/);
    expect(styles).toContain("--canvas-handle-bg");
    expect(styles).toContain("--canvas-handle-border");
    expect(styles).toContain("--canvas-handle-glyph");
  });
});
