"use client";

import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { AudioLines, ChevronDown, Loader2 } from "lucide-react";
import type { CanvasVideoSeparationMode, CanvasVideoSeparationJob } from "@/lib/canvas/video-separation";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";

export function CanvasVideoSeparateButton({ onSeparate, job }: {
  onSeparate?: (mode: CanvasVideoSeparationMode) => Promise<void>;
  job?: CanvasVideoSeparationJob;
}) {
  const readOnly = useCanvasReadOnly();
  const [menu, setMenu] = React.useState(false);
  const busy = job?.status === "running";
  const [errorDismissed, setErrorDismissed] = React.useState(false);
  const error = !errorDismissed && job?.status === "error" ? job.error : undefined;
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setErrorDismissed(false); }, [job]);
  React.useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    window.addEventListener("pointerdown", outside, true); window.addEventListener("focusin", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("focusin", outside); window.removeEventListener("keydown", escape); };
  }, [menu]);
  const run = (mode: CanvasVideoSeparationMode) => {
    if (!onSeparate || readOnly || busy) return;
    setMenu(false);
    // The board owns the promise, progress and failures. Closing this toolbar must not cancel it.
    void onSeparate(mode).catch(() => undefined);
  };
  if (readOnly || !onSeparate) return null;
  return <div ref={root} className="relative" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <UiProps ids={{"aria-label":["canvas.m5e567e30595e"]}}><button type="button" aria-label="canvas.m5e567e30595e" aria-expanded={menu} disabled={busy} className="canvas-material-toolbar-item" onClick={() => { setErrorDismissed(true); setMenu(value => !value); }}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <AudioLines size={16} />}{busy ? (job?.mode === "tracks" ? <UiText id="canvas.m3747c349dc89" values={{v0: String(Math.round(job.progress * 100))}} /> : <UiText id="canvas.mec81f207f326" />) : <UiText id="canvas.m5e567e30595e" />}<ChevronDown size={12} />
    </button></UiProps>
    {menu && <div className="absolute left-0 top-full z-10 mt-2 flex w-40 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-lg">
      {([ ["tracks", "音视频分离"], ["vocals", "人声提取"], ["background", "背景音提取"] ] as const).map(([mode, label]) =>
        <button key={mode} type="button" className="canvas-material-toolbar-item w-full !justify-start" onClick={() => run(mode)}>{label}</button>)}
    </div>}
    {error && <div role="alert" className="absolute left-0 top-full z-20 mt-2 w-64 whitespace-normal rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-xs shadow-lg">{error}</div>}
  </div>;
}
