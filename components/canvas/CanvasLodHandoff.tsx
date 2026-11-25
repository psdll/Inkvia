"use client";
import * as React from "react";

/** Keep decoded thumbnail pixels until the replacement node has a usable image. */
export function CanvasLodHandoff({ lowDetail, source, children }: { lowDetail: boolean; source?: string; children: React.ReactNode }) {
  const host = React.useRef<HTMLDivElement>(null);
  const previous = React.useRef<{ low: boolean; source?: string; url?: string }>({ low: lowDetail, source });
  const [overlay, setOverlay] = React.useState<{ url: string; fading: boolean } | null>(null);
  const remember = React.useCallback(() => {
    if (!lowDetail) return;
    const image = host.current?.querySelector<HTMLImageElement>("img:not(.canvas-thumbnail-handoff)");
    if (image?.complete && image.naturalWidth) previous.current = { low: true, source, url: image.currentSrc || image.src };
  }, [lowDetail, source]);
  React.useLayoutEffect(() => {
    const old = previous.current;
    if (!lowDetail && old.low && old.source === source && old.url) setOverlay({ url: old.url, fading: false });
    else if (lowDetail || old.source !== source) setOverlay(null);
    previous.current = { low: lowDetail, source, url: lowDetail && old.source === source ? old.url : undefined };
    remember();
  }, [lowDetail, source, remember]);
  React.useEffect(() => {
    if (!overlay || lowDetail || !host.current) return;
    const element = host.current;
    let cancelled = false;
    let decoding: HTMLImageElement | null = null;
    let decodingUrl: string | undefined;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const failed = () => {
      if (cancelled) return;
      finished = true;
      clearTimeout(fadeTimer);
      setOverlay(null);
    };
    const ready = () => {
      if (cancelled || finished) return;
      finished = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setOverlay(null); return; }
      setOverlay(current => current ? { ...current, fading: true } : null);
      fadeTimer = setTimeout(() => setOverlay(null), 120);
    };
    const inspect = () => {
      const image = element.querySelector<HTMLImageElement>("img:not(.canvas-thumbnail-handoff)");
      if (finished || !image || !image.complete || !image.naturalWidth) return;
      if (decoding === image && decodingUrl === (image.currentSrc || image.src)) return;
      decoding = image;
      const url = image.currentSrc || image.src;
      decodingUrl = url;
      const finish = () => {
        if (!cancelled && image.isConnected && (image.currentSrc || image.src) === url) ready();
        else decoding = null;
      };
      if (image.decode) void image.decode().then(finish, () => { if (!cancelled && (image.currentSrc || image.src) === url) failed(); });
      else finish();
    };
    const observer = new MutationObserver(inspect);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
    element.addEventListener("load", inspect, true);
    element.addEventListener("error", failed, true);
    const timeout = setTimeout(() => setOverlay(null), 15000);
    inspect();
    return () => { cancelled = true; observer.disconnect(); element.removeEventListener("load", inspect, true); element.removeEventListener("error", failed, true); clearTimeout(timeout); clearTimeout(fadeTimer); };
  }, [Boolean(overlay), lowDetail, source]);
  return <div ref={host} onLoadCapture={remember} className="relative" data-canvas-lod-handoff>
    {children}
    {overlay && !lowDetail ? <img aria-hidden="true" alt="" src={overlay.url} draggable={false} className="canvas-thumbnail-handoff" data-fading={overlay.fading || undefined} /> : null}
  </div>;
}
