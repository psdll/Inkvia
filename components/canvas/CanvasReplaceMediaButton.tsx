"use client";
import { UiProps, UiText } from "@/i18n/ui";


import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import * as React from "react";
import { History, Loader2, Upload } from "lucide-react";

export function CanvasReplaceMediaButton({ kind, onUpload, onHistory, placement = "overlay" }: {
  kind: "image" | "video" | "audio";
  placement?: "overlay" | "inline";
  onUpload: (file: File) => Promise<void>;
  onHistory: () => void;
}) {
  const readOnly = useCanvasReadOnly();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  // Mount the controls once the pointer reaches the material; uploads keep them alive.
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    const host = root.current?.closest<HTMLElement>(".group\\/material") ?? root.current?.parentElement;
    if (!host) return;
    if (host.matches(":hover")) setArmed(true);
    const arm = () => setArmed(true);
    host.addEventListener("pointerenter", arm);
    host.addEventListener("focusin", arm);
    return () => { host.removeEventListener("pointerenter", arm); host.removeEventListener("focusin", arm); };
  }, []);
  return <div ref={root} className={`nodrag nopan z-20 ${placement === "inline" ? "relative shrink-0" : "absolute right-2 top-2"}`} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onMouseLeave={() => setOpen(false)}>
    {(placement === "inline" || armed || open || busy || error) && <>
    <UiProps ids={{"aria-label":["canvas.m1ac0acab457b"]}}><button type="button" aria-label="canvas.m1ac0acab457b" aria-expanded={open} data-canvas-replace-visible={open || busy || Boolean(error) || undefined} disabled={readOnly || busy} onClick={() => setOpen(value => !value)} className={`canvas-replace-media-button flex items-center gap-1 rounded-lg border border-white/15 bg-black/60 px-2 py-1.5 text-xs text-white ${open || busy || error ? "opacity-100" : "opacity-0 group-hover/material:opacity-100 focus:opacity-100"}`}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}<UiText id="canvas.m131b13aa2659" /></button></UiProps>
    {open && <div className="absolute right-0 top-full min-w-36 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1 text-xs shadow-lg">
      <button className="flex w-full items-center gap-2 rounded p-2 hover:bg-[var(--panel-2)]" onClick={() => input.current?.click()}><Upload size={14} /><UiText id="canvas.m02413a69d5ca" /></button>
      <button className="flex w-full items-center gap-2 rounded p-2 hover:bg-[var(--panel-2)]" onClick={() => { setOpen(false); onHistory(); }}><History size={14} /><UiText id="canvas.m66e022edfc42" /></button>
    </div>}
    {error && <span role="alert" className="absolute right-0 top-full w-48 rounded bg-[var(--panel-bg)] p-2 text-xs">{error}</span>}
    <input ref={input} type="file" accept={`${kind}/*`} className="hidden" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (readOnly || !file || busy) return;
      setOpen(false); setError(""); setBusy(true);
      try { await onUpload(file); } catch (reason) { setError(String((reason as Error)?.message || reason)); }
      finally { setBusy(false); }
    }} />
    </>}
  </div>;
}
