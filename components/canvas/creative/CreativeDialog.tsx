"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import styles from "./creative.module.css";

export function CreativeDialog({ children, label, onClose, compact = false, anchor, inline = false }: {
  children: React.ReactNode; label: string; onClose(): void; compact?: boolean; anchor?: DOMRect; inline?: boolean;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const [viewport, setViewport] = React.useState({ width: window.innerWidth, height: window.innerHeight });
  React.useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const content = <div className={`${styles.backdrop} ${compact ? styles.angleBackdrop : ""}`} data-canvas-creative-dialog
    style={inline ? { position: "static", padding: 0, background: "transparent" } : undefined}
    onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) close.current(); }}
    onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); close.current(); }
      if (!inline && event.key === "Tab") {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div ref={root} role="dialog" aria-modal={!inline} aria-label={label} tabIndex={-1}
      className={`${styles.dialog} ${compact ? styles.angle : styles.library}`}
      style={compact && anchor ? { position: "absolute", left: Math.max(12, Math.min(anchor.left, viewport.width - 612)), top: Math.max(12, Math.min(anchor.bottom + 12, viewport.height - 420)), maxHeight: Math.max(100, viewport.height - Math.max(12, Math.min(anchor.bottom + 12, viewport.height - 420)) - 12) } : undefined}>
      {children}
    </div>
  </div>;
  return inline ? content : createPortal(content, document.body);
}
