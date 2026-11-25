"use client";

import * as React from "react";
import { buildCanvasImageCandidates } from "@/lib/canvas/media-url";
import { buildMediaOriginalUrl } from "@/lib/media-url";
import { CanvasLru, CanvasWorkQueue } from "@/lib/canvas/render-runtime";
import { useCanvasInteracting } from "./canvas-runtime-context";

const resolutions = new CanvasLru<string>(1000);
type ResolutionRequest = { promise: Promise<string | undefined>; controller: AbortController; users: number; finish: (value?: string) => void };
const pending = new Map<string, ResolutionRequest>();
const queue = new CanvasWorkQueue(2);

function formatResolution(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? `${Math.round(width)} × ${Math.round(height)}` : undefined;
}

async function readResolution(src: string, controller: AbortController): Promise<string | undefined> {
  const { signal } = controller;
  if (signal.aborted) return;
  if (src.startsWith("/uploads/")) {
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/thumb?src=${encodeURIComponent(src)}&metadata=1`, { signal: controller.signal });
      if (!response.ok) return undefined;
      const metadata = await response.json();
      return formatResolution(metadata.width, metadata.height);
    } finally {
      clearTimeout(timeout);
    }
  }
  for (const candidate of buildCanvasImageCandidates(src, "original")) {
    if (signal.aborted) return;
    const resolution = await new Promise<string | undefined>((resolve) => {
      const image = new Image();
      const finish = (value?: string) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        image.src = "";
        resolve(value);
      };
      const abort = () => finish();
      const timeout = setTimeout(() => finish(), 15000);
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => finish(formatResolution(image.naturalWidth, image.naturalHeight));
      image.onerror = () => finish();
      image.src = candidate.url;
    });
    if (resolution) return resolution;
  }
}

function loadResolution(src: string) {
  const existing = pending.get(src);
  if (existing) { existing.users++; return existing; }
  let finish!: ResolutionRequest["finish"];
  const request: ResolutionRequest = {
    promise: new Promise(resolve => { finish = resolve; }),
    controller: new AbortController(), users: 1, finish: value => finish(value),
  };
  pending.set(src, request);
  queue.add(src, async () => {
    const resolution = await readResolution(src, request.controller).catch(() => undefined);
    if (resolution && !request.controller.signal.aborted) resolutions.set(src, resolution);
    if (pending.get(src) === request) pending.delete(src);
    request.finish(resolution);
  });
  return request;
}

/** Resolution belongs to the source file, independent of the displayed thumbnail tier. */
export function useCanvasImageResolution(url?: string, knownResolution?: string, enabled = true) {
  const interacting = useCanvasInteracting();
  const src = buildMediaOriginalUrl(url);
  const [loaded, setLoaded] = React.useState<{ src: string; resolution?: string }>();
  React.useEffect(() => {
    if (!enabled || interacting || !src || knownResolution || resolutions.get(src)) return;
    let cancelled = false;
    const request = loadResolution(src);
    void request.promise.then(resolution => {
      if (!cancelled) setLoaded({ src, resolution });
    });
    return () => {
      cancelled = true;
      if (--request.users === 0 && pending.get(src) === request) {
        queue.cancel(src);
        pending.delete(src);
        request.controller.abort();
        request.finish();
      }
    };
  }, [src, knownResolution, enabled, interacting]);
  return knownResolution || resolutions.get(src) || (loaded?.src === src ? loaded.resolution : undefined);
}
