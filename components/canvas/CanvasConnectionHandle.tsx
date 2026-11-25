"use client";

import * as React from "react";
import { Handle, Position, useNodeId } from "@xyflow/react";
import { CANVAS_LEFT_OUTPUT_HANDLE_ID, CANVAS_RIGHT_OUTPUT_HANDLE_ID } from "@/lib/canvas/connection-rules";
import {
  CANVAS_CONNECTION_HANDLE_HIT_SIZE,
  getCanvasConnectionHandleMotion,
  getCanvasConnectionHandlePointerOffset,
  type CanvasConnectionHandleType,
} from "@/lib/canvas/connection-handle-motion";

export type CanvasConnectionHandleClick = {
  nodeId: string;
  handleId: string;
  position: Position;
  point: { x: number; y: number };
};
export const CanvasConnectionHandleClickContext = React.createContext<((click: CanvasConnectionHandleClick) => void) | null>(null);

type CanvasConnectionHandleProps = {
  handleId?: string;
  type: CanvasConnectionHandleType;
  connectionInProgress: boolean;
  acceptsInput?: boolean;
  compact?: boolean;
};

type CanvasConnectionHandleSurfaceProps = {
  type: CanvasConnectionHandleType;
  connectionInProgress: boolean;
  visualSize?: number;
  plusSize?: number;
  alwaysVisible?: boolean;
  compact?: boolean;
  onPointerDown?: React.PointerEventHandler<HTMLSpanElement>;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLSpanElement>;
};

export function CanvasConnectionHandleSurface({
  type,
  connectionInProgress,
  visualSize = 24,
  plusSize = 7,
  alwaysVisible = false,
  compact = false,
  onPointerDown,
  onClick,
  onPointerCancel,
}: CanvasConnectionHandleSurfaceProps) {
  const visualRef = React.useRef<SVGSVGElement>(null);
  const source = type === "source";
  const motion = getCanvasConnectionHandleMotion(type, null);
  const plusStart = 10 - plusSize / 2;

  const updatePointer = React.useCallback((event: React.PointerEvent<HTMLSpanElement>) => {
    const visual = visualRef.current;
    if (!visual || event.currentTarget.closest("[data-canvas-low-detail]")) return;
    const next = getCanvasConnectionHandleMotion(type, getCanvasConnectionHandlePointerOffset(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    ));
    visual.style.transition = "transform 80ms ease-out, opacity 200ms ease";
    visual.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    visual.style.opacity = "1";
  }, [type]);

  const resetPointer = React.useCallback(() => {
    const visual = visualRef.current;
    if (!visual) return;
    visual.style.transition = "transform 400ms cubic-bezier(.34,1.56,.64,1), opacity 200ms ease";
    visual.style.transform = `translate(${motion.x}px, ${motion.y}px) scale(1)`;
    visual.style.opacity = alwaysVisible ? "1" : "var(--canvas-handle-opacity, 0)";
  }, [alwaysVisible, motion.x, motion.y]);

  return (
    <span
      data-canvas-connection-handle-hit-area={type}
      className={`nodrag nopan absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full${compact ? " canvas-connection-handle-compact" : ""}`}
      onPointerEnter={compact ? undefined : updatePointer}
      onPointerMove={compact ? undefined : updatePointer}
      onPointerLeave={compact ? undefined : resetPointer}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onPointerCancel={onPointerCancel}
      style={{
        width: CANVAS_CONNECTION_HANDLE_HIT_SIZE,
        height: CANVAS_CONNECTION_HANDLE_HIT_SIZE,
        left: source ? 0 : undefined,
        right: source ? undefined : 0,
        pointerEvents: source && connectionInProgress ? "none" : undefined,
        cursor: "crosshair",
      }}
    >
      {!compact && <svg
        ref={visualRef}
        aria-hidden="true"
        data-canvas-connection-handle-visual={type}
        width="20" height="20" viewBox="0 0 20 20"
        fill="none"
        style={{
          width: visualSize,
          height: visualSize,
          flexShrink: 0,
          opacity: alwaysVisible ? 1 : "var(--canvas-handle-opacity, 0)",
          pointerEvents: "none",
          transform: `translate(${motion.x}px, ${motion.y}px) scale(${motion.scale})`,
          transition: "transform 400ms cubic-bezier(.34,1.56,.64,1), opacity 200ms ease",
        }}
      >
        <circle cx="10" cy="10" r="9.35" fill="var(--canvas-handle-bg)" />
        <circle cx="10" cy="10" r="9.35" stroke="var(--canvas-handle-icon)" strokeWidth="1.2" />
        <path d={`M10 ${plusStart}v${plusSize}M${plusStart} 10h${plusSize}`} stroke="var(--canvas-handle-icon)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>}
    </span>
  );
}

export function CanvasConnectionHandle({
  handleId,
  type,
  connectionInProgress,
  acceptsInput = true,
  compact = false,
}: CanvasConnectionHandleProps) {
  const right = type === "source";
  const nodeId = useNodeId();
  const openMenu = React.useContext(CanvasConnectionHandleClickContext);
  const pressed = React.useRef<{ time: number; x: number; y: number } | null>(null);
  const position = right ? Position.Right : Position.Left;
  const sourceHandleId = right ? handleId ?? CANVAS_RIGHT_OUTPUT_HANDLE_ID : CANVAS_LEFT_OUTPUT_HANDLE_ID;
  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    pressed.current = !connectionInProgress && event.button === 0
      ? { time: performance.now(), x: event.clientX, y: event.clientY }
      : null;
  };
  const handleClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    const start = pressed.current;
    pressed.current = null;
    if (!start || !nodeId || !openMenu || performance.now() - start.time >= 300 || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10) return;
    openMenu({ nodeId, handleId: sourceHandleId, position, point: { x: event.clientX, y: event.clientY } });
  };
  const className = `nodrag nopan !z-20 !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent !p-0 !shadow-none !translate-x-0 !-translate-y-1/2 ${right ? "!right-0" : "!left-0"}`;

  // Both sides start outgoing connections; the left input remains available as a drop target.
  return (
    <>
      {!right && acceptsInput && <Handle
        id={handleId}
        data-canvas-connection-handle="target"
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        isConnectableEnd
        className={className}
        style={{ overflow: "visible", visibility: connectionInProgress ? "visible" : "hidden" }}
      >
        <CanvasConnectionHandleSurface type="target" compact={compact} connectionInProgress={connectionInProgress} />
      </Handle>}
      <Handle
        id={sourceHandleId}
        data-canvas-connection-handle="source"
        type="source"
        position={position}
        isConnectableStart={!connectionInProgress}
        isConnectableEnd={false}
        className={className}
        style={{ overflow: "visible", visibility: !right && connectionInProgress ? "hidden" : "visible" }}
      >
        <CanvasConnectionHandleSurface type={type} compact={compact} connectionInProgress={connectionInProgress} onPointerDown={handlePointerDown} onPointerCancel={() => { pressed.current = null; }} onClick={handleClick} />
      </Handle>
    </>
  );
}
