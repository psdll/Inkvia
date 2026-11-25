"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Hand, MousePointer2 } from "lucide-react";

export type CanvasToolMode = "move" | "hand";

const tools = [
  { mode: "move", label: "移动", hotkey: "V", icon: MousePointer2 },
  { mode: "hand", label: "抓手工具", hotkey: "H", icon: Hand },
] as const;

export function CanvasToolMenu({ mode, anchorRef, onChange, onClose }: {
  mode: CanvasToolMode;
  anchorRef: React.RefObject<HTMLButtonElement>;
  onChange: (mode: CanvasToolMode) => void;
  onClose: () => void;
}) {
  const { label: uiLabel } = useUiLocale();
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [anchorRef, onClose]);

  return (
    <UiProps ids={{"aria-label":["canvas.m70c6eea8b0eb"]}}><div
      ref={menuRef}
      id="canvas-tool-menu"
      data-canvas-tool-menu
      role="menu"
      aria-label="canvas.m70c6eea8b0eb"
      className="canvas-tool-menu nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); anchorRef.current?.focus(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...menuRef.current!.querySelectorAll<HTMLButtonElement>("button")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {tools.map(({ mode: value, label, hotkey, icon: Icon }) => (
        <button key={value} type="button" role="menuitemradio" aria-checked={mode === value} data-canvas-tool-option={value} onClick={() => onChange(value)} className="canvas-tool-option">
          <Icon width={16} height={16} className="shrink-0 text-[var(--canvas-controls-icon)]" />
          <span className="min-w-0 flex-1">{uiLabel(label)}</span>
          <span className="pl-4 opacity-40">{hotkey}</span>
        </button>
      ))}
      <svg aria-hidden="true" className="canvas-tool-menu-arrow" width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M0 2 6.6 8.4a2 2 0 0 0 2.8 0L16 2" fill="var(--canvas-controls-bg)" stroke="var(--canvas-controls-border)" strokeWidth="1" strokeLinecap="round" /><path d="M0 0h16v2H0z" fill="var(--canvas-controls-bg)" /></svg>
    </div></UiProps>
  );
}
