"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import dynamic from "next/dynamic";
import { useConnection, useStore, type Node } from "@xyflow/react";
import { MessageSquareText } from "lucide-react";
import { CanvasEditableNodeName } from "./CanvasEditableNodeName";
import { CanvasNodeHeading } from "./CanvasNodeHeading";
import { CanvasConnectionHandle } from "@/components/canvas/CanvasConnectionHandle";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { createCanvasInteractionFrame } from "@/lib/canvas/interaction-frame";
import { scheduleCanvasConnectionTargetTilt, resetCanvasConnectionTargetTilt, resolveCanvasConnectionCandidateState, resolveCanvasNodeConnectionTargetState, type CanvasConnectionFeedbackTarget } from "@/lib/canvas/connection-feedback";

export const DEFAULT_CANVAS_TEXT_NODE_SIZE = { width: 350, height: 200 };
export const MIN_CANVAS_TEXT_NODE_SIZE = { width: 200, height: 100 };
const CanvasTextRichEditor = dynamic(() => import("./CanvasTextRichEditor").then(module => module.CanvasTextRichEditor), { ssr: false });

type CanvasTextNodeProps = {
  /** Formatting toolbar only for a single selection; a multi-selection shows the group toolbar instead. */
  toolbarVisible?: boolean;
  id: string;
  data: Extract<CanvasNodeData, { kind: "prompt" }>;
  selected: boolean;
  connectionInProgressOverride?: boolean;
  connectionFeedbackTarget?: CanvasConnectionFeedbackTarget;
  width?: number;
  height?: number;
  onTextChange: (text: string) => void;
  onBackgroundColorChange?: (color: string) => void;
  onTitleChange: (title: string) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onSizeEnd?: () => void;
};

export function CanvasTextNode({
  id,
  data,
  selected,
  toolbarVisible = selected,
  connectionInProgressOverride = false,
  connectionFeedbackTarget: pointerTarget = null,
  width = DEFAULT_CANVAS_TEXT_NODE_SIZE.width,
  height = DEFAULT_CANVAS_TEXT_NODE_SIZE.height,
  onTextChange,
  onTitleChange,
  onBackgroundColorChange,
  onSizeChange,
  onSizeEnd,
}: CanvasTextNodeProps) {
  const readOnly = useCanvasReadOnly();
  const zoom = useStore((state) => state.transform[2]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = React.useState(false);
  const requestEditing = (event: React.MouseEvent) => {
    if (readOnly) return false;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    return true;
  };
  const xyflowConnectionInProgress = useConnection<Node<CanvasNodeData>, boolean>((connection) => connection.inProgress);
  const connectionInProgress = xyflowConnectionInProgress || Boolean(connectionInProgressOverride);
  const xyflowConnectionTargetState = useConnection<Node<CanvasNodeData>, "valid" | "invalid" | null>((connection) => {
    if (!connection.inProgress || connection.toNode?.id !== id) return null;
    return resolveCanvasConnectionCandidateState(connection.isValid, true);
  });
  const connectionTargetState = resolveCanvasNodeConnectionTargetState(
    id,
    xyflowConnectionTargetState,
    pointerTarget,
  );
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (connectionTargetState !== "valid") resetCanvasConnectionTargetTilt(root);
    return () => resetCanvasConnectionTargetTilt(root);
  }, [connectionTargetState]);

  const updateConnectionTargetTilt = (event: React.PointerEvent<HTMLDivElement>) => {
    if (connectionTargetState !== "valid") return;
    scheduleCanvasConnectionTargetTilt(event.currentTarget, { x: event.clientX, y: event.clientY });
  };

  React.useEffect(() => {
    if (!editing) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) return;
      setEditing(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [editing]);

  const beginEditing = (event: React.MouseEvent) => {
    if (data.format === "markdown") return;
    if (!requestEditing(event)) return;
    event.preventDefault();
    // Let the board focus the node while activating its editor.
    setEditing(true);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.select();
    });
  };

  const handleEditorWheel = (event: React.WheelEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    const canScrollUp = event.deltaY < 0 && scrollTop > 0;
    const canScrollDown = event.deltaY > 0 && scrollTop + clientHeight < scrollHeight;
    if (canScrollUp || canScrollDown) {
      event.stopPropagation();
      return;
    }
    const editor = event.currentTarget;
    editor.classList.remove("nowheel");
    window.requestAnimationFrame(() => editor.classList.add("nowheel"));
  };

  const resizeCleanup = React.useRef<(() => void) | null>(null);
  const sizeCallback = React.useRef(onSizeChange);
  sizeCallback.current = onSizeChange;
  const endCallback = React.useRef(onSizeEnd);
  endCallback.current = onSizeEnd;
  React.useEffect(() => () => resizeCleanup.current?.(), []);
  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current?.();
    const start = { clientX: event.clientX, clientY: event.clientY, width, height };
    const pointerId = event.pointerId;
    const frame = createCanvasInteractionFrame<{ width: number; height: number }>(size => sizeCallback.current(size));
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      frame.push({
        width: Math.max(MIN_CANVAS_TEXT_NODE_SIZE.width, start.width + (event.clientX - start.clientX) / zoom),
        height: Math.max(MIN_CANVAS_TEXT_NODE_SIZE.height, start.height + (event.clientY - start.clientY) / zoom),
      });
    };
    const handlePointerEnd = (event?: Event) => {
      if (event && "pointerId" in event && event.pointerId !== pointerId) return;
      frame.flush();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handlePointerEnd);
      document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("keydown", escape);
      resizeCleanup.current = null;
      endCallback.current?.();
    };
    const visibilityChange = () => { if (document.hidden) handlePointerEnd(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.stopPropagation(); handlePointerEnd(); } };
    resizeCleanup.current = handlePointerEnd;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handlePointerEnd);
    document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("keydown", escape);
  };

  return (
    <div
      ref={rootRef}
      data-canvas-text-node={id}
      data-canvas-text-format={data.format}
      data-canvas-connection-target-id={id}
      data-canvas-text-node-connection-active={connectionInProgress || undefined}
      data-canvas-connection-target-state={connectionTargetState || undefined}
      className={`canvas-text-node canvas-connection-target group/text ${selected ? "canvas-text-node-selected" : ""} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid canvas-connection-target-invalid-frame" : ""}`}
      style={{ width, height, backgroundColor: data.backgroundColor ? `color-mix(in srgb, ${data.backgroundColor} 14%, var(--canvas-node-bg))` : undefined }}
      onPointerMove={updateConnectionTargetTilt}
      onPointerLeave={(event) => {
        resetCanvasConnectionTargetTilt(event.currentTarget);
      }}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <CanvasNodeHeading className="canvas-text-node-title">
        <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
        <CanvasEditableNodeName name={data.title || "文本"} onRename={onTitleChange} />
      </CanvasNodeHeading>

      <CanvasConnectionHandle type="target" connectionInProgress={connectionInProgress} />
      <div className={`canvas-text-node-content${!editing ? " nowheel" : ""}`} onWheel={event => { if (editing && !event.ctrlKey && !event.metaKey) event.stopPropagation(); }} onDoubleClick={beginEditing}>
        {data.format === "markdown" ? <UiProps ids={{"title":["canvas.mb8e995bcc0ad"]}}><CanvasTextRichEditor toolbarVisible={toolbarVisible} onRequestEditing={requestEditing} backgroundColor={data.backgroundColor} onBackgroundColorChange={onBackgroundColorChange} value={data.text} onChange={onTextChange} selected={selected} title={data.title || "canvas.mb8e995bcc0ad"} /></UiProps> : editing ? (
          <UiProps ids={{"aria-label":["canvas.mfbf0cd5c747a"]}}><textarea
            ref={textareaRef}
            value={data.text}
            onChange={(event) => onTextChange(event.target.value)}
            onWheel={handleEditorWheel}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            className="canvas-text-node-editor nodrag nowheel"
            aria-label="canvas.mfbf0cd5c747a"
          /></UiProps>
        ) : data.text ? (
          <div className="canvas-text-node-value">{data.text}</div>
        ) : (
          <div className="canvas-text-node-empty">
            <MessageSquareText className="h-7 w-7 opacity-30" />
            <span><UiText id="canvas.mb262cc030f61" /></span>
          </div>
        )}
      </div>
      <CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />

      <UiProps ids={{"aria-label":["canvas.m19bff34b373f"]}}><button
        type="button"
        aria-label="canvas.m19bff34b373f"
        hidden={readOnly}
        disabled={readOnly}
        onPointerDown={beginResize}
        className="canvas-text-node-resize nodrag nopan"
      /></UiProps>
    </div>
  );
}
