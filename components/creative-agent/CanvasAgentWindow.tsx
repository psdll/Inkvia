"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import AgentMark from "./AgentMark";
import styles from "./canvas-agent.module.css";

type Edge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const edges: Edge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const edgeLabels: Record<Edge, string> = {
  n: "从顶部调整对话高度",
  ne: "从右上角调整对话大小",
  e: "从右侧调整对话宽度",
  se: "从右下角调整对话大小",
  s: "从底部调整对话高度",
  sw: "从左下角调整对话大小",
  w: "从左侧调整对话宽度",
  nw: "从左上角调整对话大小",
};
type Frame = { left: number; top: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function CanvasAgentLauncher({ onClick, running = false }: { onClick: () => void; running?: boolean }) {
  return (
    <UiProps ids={{"aria-label":["common.m11aad37af5c0"],"title":["common.m79e0e1644ff1"]}}><button
      type="button"
      className={styles.launcher}
      aria-label="common.m11aad37af5c0"
      title="common.m79e0e1644ff1"
      aria-expanded={false}
      aria-controls="canvas-agent-panel"
      data-running={running || undefined}
      onClick={onClick}
    >
      <AgentMark state={running ? "thinking" : "idle"} size={18} />
      <span>Agent</span>
    </button></UiProps>
  );
}

export default function CanvasAgentWindow({
  visible,
  onDockWidthChange,
  children,
}: {
  visible: boolean;
  onDockWidthChange: (width: number) => void;
  children: (layout: {
    docked: boolean;
    toggleDock: () => void;
  }) => React.ReactNode;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [docked, setDocked] = React.useState(true);
  const [preferred, setPreferred] = React.useState({
    width: 420,
    height: 0,
    right: 15,
    bottom: 15,
  });
  const [moving, setMoving] = React.useState(false);
  const interaction = React.useRef<{
    edge: Edge | "move";
    pointerId: number;
    target: HTMLElement;
    x: number;
    y: number;
    frame: Frame;
  } | null>(null);
  React.useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const gap = Math.min(15, viewport.width / 2, viewport.height / 2);
  const maxWidth = docked
    ? viewport.width < 720
      ? viewport.width
      : viewport.width * 0.45
    : viewport.width - gap * 2;
  const width = Math.min(preferred.width, maxWidth);
  const height = docked
    ? viewport.height
    : Math.min(
        preferred.height || viewport.height * 0.8,
        viewport.height - gap * 2,
      );
  const frame: Frame = {
    width,
    height,
    left: docked
      ? viewport.width - width
      : clamp(
          viewport.width - width - preferred.right,
          gap,
          viewport.width - width - gap,
        ),
    top: docked
      ? 0
      : clamp(
          viewport.height - height - preferred.bottom,
          gap,
          viewport.height - height - gap,
        ),
  };
  React.useEffect(() => {
    onDockWidthChange(visible && docked ? width : 0);
  }, [visible, docked, width, onDockWidthChange]);
  React.useEffect(() => () => onDockWidthChange(0), [onDockWidthChange]);
  const stop = () => {
    const current = interaction.current;
    interaction.current = null;
    setMoving(false);
    if (current?.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
  };
  React.useEffect(() => {
    stop();
  }, [visible, docked, viewport.width, viewport.height]);
  const start = (
    event: React.PointerEvent<HTMLElement>,
    edge: Edge | "move",
  ) => {
    if (event.button !== 0 || (docked && edge !== "w")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = {
      edge,
      pointerId: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      frame,
    };
    setMoving(edge === "move");
  };
  const resize = (edge: Edge, dx: number, dy: number, base = frame) => {
    const horizontal = edge.includes("w") || edge.includes("e");
    const vertical = edge.includes("n") || edge.includes("s");
    const next = { ...base };
    if (horizontal) {
      const fromLeft = edge.includes("w");
      const limit = fromLeft
        ? Math.min(maxWidth, base.left + base.width - (docked ? 0 : gap))
        : viewport.width - gap - base.left;
      next.width = clamp(
        base.width + (fromLeft ? -dx : dx),
        Math.min(320, limit),
        limit,
      );
      if (fromLeft) next.left = base.left + base.width - next.width;
    }
    if (vertical) {
      const fromTop = edge.includes("n");
      const limit = fromTop
        ? base.top + base.height - gap
        : viewport.height - gap - base.top;
      next.height = clamp(
        base.height + (fromTop ? -dy : dy),
        Math.min(240, limit),
        limit,
      );
      if (fromTop) next.top = base.top + base.height - next.height;
    }
    setPreferred((current) => ({
      ...current,
      ...(horizontal && {
        width: next.width,
        right: viewport.width - next.left - next.width,
      }),
      ...(vertical && {
        height: next.height,
        bottom: viewport.height - next.top - next.height,
      }),
    }));
  };
  return (
    <div
      ref={host}
      id="canvas-agent-panel"
      className={`${styles.floating} ${docked ? styles.docked : ""} ${moving ? styles.moving : ""}`}
      style={{
        ...frame,
        display: visible && viewport.width ? undefined : "none",
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest("[data-agent-drag]") &&
          !target.closest("button, input, textarea, a, [data-agent-title]")
        )
          start(event, "move");
        event.stopPropagation();
      }}
      onPointerMove={(event) => {
        const current = interaction.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (current.edge === "move") {
          const left = clamp(
            current.frame.left + event.clientX - current.x,
            gap,
            viewport.width - width - gap,
          );
          const top = clamp(
            current.frame.top + event.clientY - current.y,
            gap,
            viewport.height - height - gap,
          );
          setPreferred((value) => ({
            ...value,
            right: viewport.width - width - left,
            bottom: viewport.height - height - top,
          }));
        } else
          resize(
            current.edge,
            event.clientX - current.x,
            event.clientY - current.y,
            current.frame,
          );
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onWheel={(event) => event.stopPropagation()}
    >
      {(docked ? edges.filter((edge) => edge === "w") : edges).map(
        (edge) => {
          const side = edge.length === 1;
          const vertical = edge === "n" || edge === "s";
          return (
            <div
              key={edge}
              role={side ? "separator" : "button"}
              tabIndex={0}
              aria-label={edgeLabels[edge]}
              aria-orientation={
                side ? (vertical ? "horizontal" : "vertical") : undefined
              }
              aria-valuenow={
                side ? Math.round(vertical ? height : width) : undefined
              }
              aria-valuemin={
                side
                  ? Math.min(
                      vertical ? 240 : 320,
                      vertical ? viewport.height - gap * 2 : maxWidth,
                    )
                  : undefined
              }
              aria-valuemax={
                side
                  ? Math.round(vertical ? viewport.height - gap * 2 : maxWidth)
                  : undefined
              }
              data-canvas-generator-resize={edge}
              className="canvas-generator-resize-handle"
              onPointerDown={(event) => start(event, edge)}
              onKeyDown={(event) => {
                event.stopPropagation();
                const dx =
                  edge.includes("w") || edge.includes("e")
                    ? event.key === "ArrowLeft"
                      ? -16
                      : event.key === "ArrowRight" ? 16 : 0
                    : 0;
                const dy =
                  edge.includes("n") || edge.includes("s")
                    ? event.key === "ArrowUp"
                      ? -16
                      : event.key === "ArrowDown" ? 16 : 0
                    : 0;
                if (!dx && !dy) return;
                event.preventDefault();
                resize(edge, dx, dy);
              }}
            />
          );
        },
      )}
      {children({ docked, toggleDock: () => setDocked((value) => !value) })}
    </div>
  );
}
