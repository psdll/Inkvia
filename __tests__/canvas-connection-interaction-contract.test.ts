import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANVAS_TASK_BODY_TARGET_HANDLE_ID,
  normalizeCanvasConnectionTargetHandle,
} from "@/lib/canvas/connection-rules";

describe("canvas typed connection interaction contract", () => {
  const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

  it("uses the same typed rule decision for live validation, commit, and readable drop feedback", () => {
    expect(board).toContain("getCanvasConnectionDecision");
    expect(board).toContain("const connectionDecision = getCanvasConnectionDecision");
    expect(board).toContain("return connectionDecision.allowed");
    expect(board).toContain("setActionMessage(connectionDecision.error");
  });

  it("disables every incompatible create-from-connection choice before it is clicked", () => {
    expect(board).toContain("connectionCreateErrors");
    expect(board).toContain('data-canvas-connection-kind="llm"');
    expect(board).toContain("disabled={Boolean(connectionCreateErrors.llm)}");
    expect(board).toContain("disabled={Boolean(connectionCreateErrors.imageTask)}");
    expect(board).toContain("disabled={Boolean(connectionCreateErrors.videoTask)}");
    expect(board).toContain("title={(connectionCreateErrors.imageTask || undefined) && uiError(connectionCreateErrors.imageTask)}");
  });

  it("keeps target tilt and flowing glow for valid targets while invalid targets dim and show a delayed connection hint", () => {
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const text = readFileSync("components/canvas/CanvasTextNode.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(card).toContain('connectionTargetState === "valid"');
    expect(card).toContain('connectionTargetState === "invalid"');
    expect(text).toContain('connectionTargetState === "valid"');
    expect(text).toContain('connectionTargetState === "invalid"');
    expect(styles).toContain(".canvas-connection-target-valid::after");
    expect(styles).toContain("canvas-connection-target-valid-border-flow");
    expect(styles).toContain(".canvas-connection-target-invalid::before");
    expect(styles).toContain("background: rgba(0, 0, 0, 0.35)");
    expect(card).toContain("resolveCanvasConnectionCandidateState");
    expect(card).toContain("connectionFeedbackTarget");
    expect(card).toContain("data-canvas-connection-target-id");
    expect(text).toContain("resolveCanvasConnectionCandidateState");
    expect(text).toContain("data-canvas-connection-target-id={id}");
    expect(card).toContain("connectionFeedbackTarget={editor?.connectionFeedbackTarget ?? null}");
    expect(text).toContain("connectionFeedbackTarget?: CanvasConnectionFeedbackTarget");
    expect(text).toContain("connectionFeedbackTarget: pointerTarget = null");

    const connectionLine = board.slice(board.indexOf("function CanvasConnectionLine"), board.indexOf("function CanvasConnectionMenuPreview"));
    expect(connectionLine).toContain("resolveCanvasConnectionCandidateState");
    expect(connectionLine).toContain("connectionFeedbackTarget?.state");
    expect(connectionLine).not.toContain("data-canvas-invalid-connection");
    expect(connectionLine).not.toContain("无法连接");
  });

  it("tracks the card under the pointer independently of xyflow's handle-radius result", () => {
    expect(board).toContain("updateCanvasConnectionFeedbackTarget");
    expect(board).toContain("if (!handToolActive) updateCanvasConnectionFeedbackTarget(event)");
    expect(board).toContain("elementsFromPoint(clientX, clientY)");
    expect(board).toContain('[data-canvas-connection-target-id]');
    expect(board).toContain("getCanvasConnectionDecision");
    expect(board).toContain("connectionFeedbackTargetRef.current");
    expect(board).toContain("updateConnectionFeedbackTarget");
  });

  it("never commits xyflow's nearby-radius candidate instead of the card under the pointer", () => {
    const connect = board.slice(board.indexOf("const onConnect ="), board.indexOf("const onConnectStart"));

    expect(connect).toContain("connectionFeedbackTargetRef.current");
    expect(connect).toContain("pointerTarget?.nodeId ?? connection.target");
    expect(connect).toContain("target: targetId");
    expect(connect).toContain("pointerTargetMatchesConnection");
    expect(connect).toContain("pointerTarget && !pointerTargetMatchesConnection");
  });

  it("uses a connection-only whole-card target on every image, video, and text task result", () => {
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const taskBodyTargets = card.match(/id=\{CANVAS_TASK_BODY_TARGET_HANDLE_ID\}/g) || [];

    expect(taskBodyTargets).toHaveLength(3);
    expect(card).toContain("data-canvas-task-body-target");
    expect(card.match(/style=\{\{ inset: 0, width: "auto", height: "auto"/g) || []).toHaveLength(3);
    expect(card).toContain('pointerEvents: connectionInProgress ? "auto" : "none"');
    expect(normalizeCanvasConnectionTargetHandle(CANVAS_TASK_BODY_TARGET_HANDLE_ID)).toBeNull();
    expect(normalizeCanvasConnectionTargetHandle("canvas-media-body-target")).toBe("canvas-media-body-target");
  });

  it("keeps generated task output frames open around their right source handle", () => {
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");
    const mediaResult = card.slice(card.indexOf("function TaskResultFrame"), card.indexOf("function ImageTaskPanel"));
    const textResult = card.slice(card.indexOf("function LlmTaskResultFrame"), card.indexOf("function GeneratorActions"));

    expect(mediaResult).toContain("canvas-task-output-frame");
    expect(textResult).toContain("canvas-task-output-frame");
    expect(styles).toContain(".canvas-task-output-frame");
    expect(styles).toContain("overflow: visible");
  });

  it("draws every task-card connection to the live pointer but keeps ordinary nodes on their anchor", () => {
    const connectionLine = board.slice(board.indexOf("function CanvasConnectionLine"), board.indexOf("function CanvasConnectionMenuPreview"));

    expect(connectionLine).toContain("pointer");
    expect(connectionLine).toContain("toHandle");
    expect(connectionLine).toContain("toNode");
    expect(connectionLine).toContain("toNode?.data.kind");
    expect(connectionLine).toContain("canvasRendererPointToFlowPoint(pointer, viewportTransform)");
    expect(connectionLine).toContain("resolveCanvasConnectionPreviewTarget");
    expect(connectionLine).toContain("targetX: previewTarget.x");
    expect(connectionLine).toContain("targetY: previewTarget.y");
  });

  it("does not show a toast after dropping on an incompatible card", () => {
    const connectEnd = board.slice(board.indexOf("const onConnectEnd"), board.indexOf("const onNodeDragStart"));
    const invalidTargetBranch = connectEnd.slice(connectEnd.indexOf("if (connectionDecision && !connectionDecision.allowed)"), connectEnd.indexOf("const target = event.target"));

    expect(invalidTargetBranch).not.toContain("setActionMessage");
  });

  it("does not treat the lower generator editor as the task result drop target", () => {
    const connectEnd = board.slice(board.indexOf("const onConnectEnd"), board.indexOf("const onNodeDragStart"));
    const connect = board.slice(board.indexOf("const onConnect ="), board.indexOf("const onConnectStart"));

    expect(connectEnd).not.toContain("data-canvas-generator-shell");
    expect(connectEnd).not.toContain("ownerDocument.elementFromPoint");
    expect(connect).toContain("normalizeCanvasConnectionTargetHandle(connection.targetHandle)");
  });
});
