"use client";

import * as React from "react";

const useBrowserLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export function libraryPositionKey(ownerId: number, canvasId: number, section: string) {
  return `canvas_library_position_v1_${ownerId}_${canvasId}_${section}`;
}

export function readLibraryPosition<T extends Record<string, unknown>>(key: string, defaults: T): T {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!value || typeof value !== "object") return defaults;
    return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
      const candidate = value[name];
      const valid = fallback === null ? candidate === null || typeof candidate === "string"
        : Array.isArray(fallback) ? Array.isArray(candidate) && candidate.every(item => typeof item === "string")
        : typeof candidate === typeof fallback;
      return [name, valid ? candidate : fallback];
    })) as T;
  } catch { return defaults; }
}

export function writeLibraryPosition(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
}

// Keep the last scroll event, including when the panel closes before the debounce finishes.
export function useLibraryScroll(key: string, ready: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [initial] = React.useState(() => {
    const { top } = readLibraryPosition(key, { top: 0 });
    return Number.isFinite(top) && top > 0 ? top : 0;
  });
  const top = React.useRef(initial);
  const restored = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>();
  useBrowserLayoutEffect(() => {
    if (!ready || !ref.current || restored.current) return;
    ref.current.scrollTop = initial;
    restored.current = true;
  }, [ready, initial]);
  React.useEffect(() => {
    const flush = () => { clearTimeout(timer.current); writeLibraryPosition(key, { top: top.current }); };
    window.addEventListener("pagehide", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); };
  }, [key]);
  const onScroll = React.useCallback((event: React.UIEvent<HTMLElement>) => {
    if (!ready) return;
    top.current = event.currentTarget.scrollTop;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => writeLibraryPosition(key, { top: top.current }), 120);
  }, [key, ready]);
  return { ref, onScroll, top };
}
