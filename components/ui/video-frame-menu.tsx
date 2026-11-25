"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, Loader2, ScanLine } from "lucide-react";
import { VIDEO_FRAME_LABELS, type VideoFrameMode } from "@/lib/video-frame";

export function VideoFrameMenu({ open, onOpenChange, busy, disabled, visible, compact, buttonClassName, onSelect, label, placement = "top" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  disabled: boolean;
  visible: boolean;
  compact: boolean;
  buttonClassName: string;
  onSelect: (mode: VideoFrameMode) => void;
  label?: string;
  placement?: "top" | "bottom";
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative shrink-0" onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
    }} onKeyDown={(event) => {
      const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (!open) { onOpenChange(true); return; }
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <UiProps ids={{"aria-label":["common.mdeafa33d05ac","common.ma1786994611b"],"title":["common.ma1786994611b"]}}><button ref={triggerRef} type="button" aria-label={busy ? "common.mdeafa33d05ac" : label || "common.ma1786994611b"} title={label || "common.ma1786994611b"}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        disabled={disabled || busy} tabIndex={visible ? 0 : -1}
        className={`${buttonClassName} disabled:opacity-50`} onClick={() => onOpenChange(!open)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className={compact ? "h-4 w-4" : "h-6 w-6"} />}
        {label ? <><span>{busy ? <UiText id="common.mdeafa33d05ac" /> : label}</span><ChevronDown className="h-3 w-3" /></> : null}
      </button></UiProps>
      {open ? (
        <UiProps ids={{"aria-label":["common.ma1786994611b"]}}><div id={menuId} role="menu" aria-label="common.ma1786994611b" data-video-frame-menu
          className={`absolute right-0 z-30 w-36 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 text-[var(--app-fg)] shadow-[var(--shadow-2)] ${placement === "bottom" ? "top-full mt-2" : compact ? "bottom-7" : "bottom-9"}`}>
          {(Object.keys(VIDEO_FRAME_LABELS) as VideoFrameMode[]).map((mode) => (
            <button key={mode} type="button" role="menuitem" disabled={busy}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--panel-3)] focus-visible:bg-[var(--panel-3)] focus-visible:outline-none disabled:opacity-50"
              onClick={() => { onOpenChange(false); onSelect(mode); }}><UiText id="common.m043a57f12fb2" />{VIDEO_FRAME_LABELS[mode]}
            </button>
          ))}
        </div></UiProps>
      ) : null}
    </div>
  );
}
