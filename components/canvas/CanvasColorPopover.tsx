"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

function hsvFromHex(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = !d ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: v ? d / v : 0, v };
}
function hexFromHsv({ h, s, v }: ReturnType<typeof hsvFromHex>) {
  return '#' + [5, 3, 1].map(n => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0');
  }).join('');
}
const palette = ['#ffffff', '#e4e4e7', '#a1a1aa', '#52525b', '#27272a', '#141414', '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#f472b6', '#c084fc', '#818cf8', '#e11d48', '#7c3aed', '#2563eb'];

export function CanvasColorPopover({ label, ownerId, value, onChange }: { label: string; ownerId: string; value: string; onChange: (value: string) => void }) {
  const { text } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [hsv, setHsv] = React.useState(() => hsvFromHex(value));
  const [draft, setDraft] = React.useState(value);
  const emitted = React.useRef(value);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const id = React.useId();
  React.useEffect(() => {
    setDraft(value);
    if (value !== emitted.current) setHsv(hsvFromHex(value));
    emitted.current = value;
  }, [value]);
  const apply = (hex: string) => { emitted.current = hex; setDraft(hex); setHsv(hsvFromHex(hex)); onChange(hex); };
  const change = (next: typeof hsv) => { const hex = hexFromHsv(next); emitted.current = hex; setHsv(next); setDraft(hex); onChange(hex); };
  const close = React.useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.offsetHeight || 420;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - height - 8)) });
    };
    place(); panel.current?.focus();
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open, close]);
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    change({ ...hsv, s: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), v: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) });
  };
  const commitHex = () => { const hex = draft.startsWith('#') ? draft : `#${draft}`; if (/^#[0-9a-f]{6}$/i.test(hex)) apply(hex.toLowerCase()); else setDraft(value); };
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
      className="h-6 w-9 cursor-pointer rounded border border-[var(--canvas-controls-border)] bg-transparent p-0.5"><span className="block h-full w-full rounded-sm border border-[var(--canvas-controls-border)]" style={{ background: value }} /></button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} data-canvas-color-popover={ownerId} tabIndex={-1}
      onWheel={event => event.stopPropagation()}
      className="fixed z-[1000] w-[280px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-2xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-4 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] outline-none" style={position}>
      <div className="mb-3 flex items-center justify-between text-xs font-medium"><span>{label.replace('自定义', '')}</span><UiProps ids={{"aria-label":["canvas.m755d77893e01"]}}><button type="button" aria-label="canvas.m755d77893e01" onClick={close} className="rounded p-1 hover:bg-[var(--canvas-controls-hover)]"><X className="h-3.5 w-3.5" /></button></UiProps></div>
      <UiProps ids={{"aria-label":["canvas.m28cf030c9ebb"]}}><div aria-label="canvas.m28cf030c9ebb" className="relative h-36 touch-none cursor-crosshair overflow-hidden rounded-lg" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0008]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div></UiProps>
      <UiProps ids={{"aria-label":["canvas.m3ff6d1c07cfc"]}}><input type="range" aria-label="canvas.m3ff6d1c07cfc" min={0} max={359} value={Math.round(hsv.h)} onChange={event => change({ ...hsv, h: Number(event.target.value) })} className="canvas-color-hue my-3 w-full" /></UiProps>
      <div className="mb-3 grid grid-cols-2 gap-3">{([['s', '饱和度'], ['v', '明度']] as const).map(([key, title]) => <label key={key} className="text-[10px] text-[var(--canvas-controls-text-muted)]"><span className="flex justify-between"><span>{title}</span><span>{Math.round(hsv[key] * 100)}%</span></span><input aria-label={title} type="range" min={0} max={100} value={Math.round(hsv[key] * 100)} onChange={event => change({ ...hsv, [key]: Number(event.target.value) / 100 })} className="w-full accent-[var(--canvas-controls-text)]" /></label>)}</div>
      <label className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--canvas-controls-border)] px-2.5 py-2 text-[11px]"><span className="h-5 w-5 rounded border border-[var(--canvas-controls-border)]" style={{ background: value }} /><span className="text-[var(--canvas-controls-text-muted)]">HEX</span><UiProps ids={{"aria-label":["canvas.mff4991644cab"]}}><input aria-label="canvas.mff4991644cab" value={draft} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commitHex} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }} className="min-w-0 flex-1 bg-transparent text-right font-mono uppercase outline-none" /></UiProps></label>
      <p className="mb-2 text-[11px] text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m1b8c6ed700a0" /></p>
      <div className="grid grid-cols-6 gap-2">{palette.map(color => <button key={color} type="button" aria-label={text("workspaceFollowup.m89b38a9e6f9d", { v0: color })} aria-pressed={value.toLowerCase() === color} title={color} onClick={() => apply(color)} className="relative h-7 rounded-md border border-black/10 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ background: color }}>{value.toLowerCase() === color && <Check className="absolute inset-0 m-auto h-4 w-4 rounded-full bg-black/60 p-0.5 text-white" />}</button>)}</div>
    </div>, document.body)}
  </>;
}
