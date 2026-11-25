"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { CanvasVideoFrameContext } from "./CanvasVideoFrameControls";
import { adjustVideoCrop, type VideoCrop, type VideoCropHandle } from "@/lib/canvas/video-crop";

const handles = [
  ["nw", 0, 0], ["n", 50, 0], ["ne", 100, 0], ["w", 0, 50],
  ["e", 100, 50], ["sw", 0, 100], ["s", 50, 100], ["se", 100, 100],
] as const;

export function CanvasSubtitleRegionsOverlay({ crops, onChange, drawing, onDrawn }: {
  crops: VideoCrop[]; onChange: (crops: VideoCrop[]) => void; drawing: boolean; onDrawn: () => void;
}) {
  const { text } = useUiLocale();
  const frame = React.useContext(CanvasVideoFrameContext);
  const root = React.useRef<HTMLDivElement>(null);
  const bounds = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [preview, setPreview] = React.useState<VideoCrop[] | null>(null);
  const [active, setActive] = React.useState(0);
  const drag = React.useRef<{ index: number; handle: VideoCropHandle | "draw"; x: number; y: number; rect: DOMRect; crop: VideoCrop; original: VideoCrop[] } | null>(null);
  const width = frame?.videoRef.current?.videoWidth || 1;
  const height = frame?.videoRef.current?.videoHeight || 1;
  React.useEffect(() => {
    const element = root.current!;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => { drag.current = null; setPreview(null); }, [crops, drawing]);
  const scale = Math.min(size.width / width, size.height / height);
  const begin = (event: React.PointerEvent, index: number, handle: VideoCropHandle | "draw") => {
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || drag.current) return;
    const rect = bounds.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width));
    const y = Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height));
    bounds.current!.setPointerCapture(event.pointerId);
    const crop = handle === "draw" ? { left: x, top: y, width: 0, height: 0, sourceWidth: width, sourceHeight: height } : crops[index];
    drag.current = { index, handle, x, y, rect, crop, original: crops };
    setActive(index);
  };
  const updated = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return null;
    const x = Math.max(0, Math.min(width, (event.clientX - d.rect.left) * width / d.rect.width));
    const y = Math.max(0, Math.min(height, (event.clientY - d.rect.top) * height / d.rect.height));
    const crop = d.handle === "draw" ? { ...d.crop, left: Math.round(Math.min(x, d.x)), top: Math.round(Math.min(y, d.y)), width: Math.round(Math.abs(x - d.x)), height: Math.round(Math.abs(y - d.y)) }
      : adjustVideoCrop(d.crop, d.handle, x - d.x, y - d.y);
    const next = [...d.original]; next[d.index] = crop; return next;
  };
  return <div ref={root} className="canvas-video-crop-overlay nodrag nopan nowheel" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <div ref={bounds} data-subtitle-regions className="canvas-video-crop-bounds" style={{ width: width * scale, height: height * scale, pointerEvents: "auto", cursor: drawing ? "crosshair" : "default" }}
      onPointerDown={e => { if (drawing || !crops.length) begin(e, crops.length, "draw"); }}
      onPointerMove={e => { const next = updated(e); if (next) setPreview(next); }}
      onPointerUp={e => {
        const next = updated(e), d = drag.current; drag.current = null; setPreview(null);
        if (next && d && next[d.index].width >= 2 && next[d.index].height >= 2) { onChange(next); if (d.handle === "draw") onDrawn(); }
      }}
      onPointerCancel={() => { drag.current = null; setPreview(null); }}>
      {(preview || crops).map((crop, index) => <UiProps key={index} ids={{"aria-label":["canvas.m67f8e26a75b3"]}}><div  data-subtitle-region aria-label={index === 0 ? "canvas.m67f8e26a75b3" : text("workspaceFollowup.m89a867b4f200", { v0: index + 1 })}
        className="canvas-video-crop-selection" style={{ left: `${crop.left / width * 100}%`, top: `${crop.top / height * 100}%`, width: `${crop.width / width * 100}%`, height: `${crop.height / height * 100}%`, boxShadow: "none", borderColor: "#22d3ee", background: "rgb(34 211 238 / 12%)", pointerEvents: drawing ? "none" : "auto" }}
        onPointerDown={e => begin(e, index, "move")}>
        <span className="canvas-video-crop-size">{index + 1}</span>
        {index === Math.min(active, crops.length - 1) && !drawing && handles.map(([handle, x, y]) => <button key={handle} type="button" aria-label={text("workspaceFollowup.m0c48637e39a9", { v0: index + 1, v1: handle })} className="canvas-video-crop-handle"
          style={{ left: `${x}%`, top: `${y}%`, cursor: `${handle}-resize`, background: "#22d3ee", borderRadius: 2 }} onPointerDown={e => begin(e, index, handle)} />)}
      </div></UiProps>)}
    </div>
  </div>;
}
