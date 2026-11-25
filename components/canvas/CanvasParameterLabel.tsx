"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";

export function CanvasParameterLabel({ label, description }: { label: string; description: string }) {
  const { text } = useUiLocale();
  const tooltipId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [position, setPosition] = React.useState<React.CSSProperties | null>(null);
  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(260, window.innerWidth - 24);
    const above = rect.top > 140;
    setPosition({ position: "fixed", width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - 8 : rect.bottom + 8, transform: above ? "translateY(-100%)" : undefined, zIndex: "calc(var(--canvas-layer-popover) + 1)" });
  };
  React.useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [position]);
  return <span className="canvas-task-parameter-label inline-flex items-center gap-1">
    <span>{label}</span>
    <span className="canvas-video-audio-help shrink-0" onMouseEnter={show} onMouseLeave={() => { if (document.activeElement !== buttonRef.current) setPosition(null); }}>
      <button ref={buttonRef} type="button" className="nodrag" aria-label={text("workspaceFollowup.m79fed4f96b8e", { v0: label })} aria-describedby={position ? tooltipId : undefined} onFocus={show} onBlur={() => setPosition(null)} onClick={show} onKeyDown={event => { if (event.key === "Escape" && position) { event.stopPropagation(); setPosition(null); } }}><CircleHelp aria-hidden="true" /></button>
    </span>
    {position && createPortal(<span id={tooltipId} role="tooltip" style={position} className="pointer-events-none rounded-md bg-[var(--overlay)] px-3 py-2 text-xs font-normal leading-[18px] text-[var(--primary-fg)] shadow-lg">{description}</span>, document.body)}
  </span>;
}
