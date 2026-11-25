"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";

export function CanvasSessionExpiredModal({ onRefresh }: { onRefresh: () => void }) {
  const refreshButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    refreshButtonRef.current?.focus();
  }, []);

  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    refreshButtonRef.current?.focus();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      role="presentation"
      data-canvas-session-expired-overlay
    >
      <section
        role="dialog"
        onKeyDown={trapFocus}
        aria-modal="true"
        aria-labelledby="canvas-session-expired-title"
        className="box-border flex flex-col items-center justify-between text-center"
        style={{
          width: 320,
          height: 241,
          padding: "40px 16px",
          border: "1px solid rgb(54,54,54)",
          borderRadius: 24,
          background: "rgb(23,23,23)",
          color: "rgb(245,245,245)",
        }}
      >
        <div className="flex w-full flex-col items-center" style={{ gap: 16 }}>
          <h2 id="canvas-session-expired-title" className="m-0 text-[18px] font-medium leading-[27px]"><UiText id="canvas.mb131bccc2387" /></h2>
          <p className="m-0 text-[14px] font-normal leading-[22px]" style={{ color: "rgb(184,184,184)" }}><UiText id="canvas.mabc6676540dc" /><br /><UiText id="canvas.m0fbf30d4d2a0" /></p>
        </div>
        <button
          ref={refreshButtonRef}
          type="button"
          autoFocus
          onClick={onRefresh}
          className="m-0 flex items-center justify-center p-0 text-[14px] font-medium leading-[22px]"
          style={{ width: 80, height: 40, border: 0, borderRadius: 8, background: "white", color: "rgb(20,20,20)" }}
        ><UiText id="canvas.m9366e1784dec" /></button>
      </section>
    </div>
  );
}
