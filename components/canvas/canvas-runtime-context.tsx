"use client";
import * as React from "react";
import { useStore } from "@xyflow/react";
import { getCanvasLodZone, resolveCanvasLodZone } from "@/lib/canvas/visual-policy";
import { CanvasLru, CanvasMountQueue, CanvasWorkQueue, CanvasVideoRetention } from "@/lib/canvas/render-runtime";
import { getCanvasEntryPreviews } from "@/lib/canvas/entry-previews";

function createRuntime(owner?: number | "guest") {
  const memory = typeof navigator === "undefined" ? 4 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  // Bound retained decoded pixels as well as count; originals can dwarf thumbnails.
  // This is an RGBA estimate for our cache, not a cap on total browser/GPU memory.
  const { decoded, previews } = getCanvasEntryPreviews(owner);
  return { owner, mounts: new CanvasMountQueue(), images: new CanvasWorkQueue(4), prefetchImages: new CanvasWorkQueue(2), referenceImages: new CanvasWorkQueue(4), previews, decoded, videoPosters: new CanvasLru<{ url: string; tier: number }>(memory <= 4 ? 100 : memory <= 8 ? 200 : 300), videos: new CanvasWorkQueue(3), retainedVideos: new CanvasVideoRetention(memory <= 4 ? 15 : 30) };
}
export const CanvasRuntimeContext = React.createContext<ReturnType<typeof createRuntime> | null>(null);
export const CanvasInteractingContext = React.createContext(false);
function createInteractionStore(initial: boolean) {
  let busy = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => busy,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: boolean) {
      if (next === busy) return;
      busy = next;
      listeners.forEach(listener => listener());
    },
  };
}
const InteractionStoreContext = React.createContext<ReturnType<typeof createInteractionStore> | null>(null);
const subscribeIdle = () => () => {};
export const CanvasPanelHiddenContext = React.createContext(false);
export const CanvasLodContext = React.createContext<boolean | null>(null);
export function CanvasLodProvider({ children }: { children: React.ReactNode }) {
  const zone = useStore(state => getCanvasLodZone(state.transform[2]));
  const deferredZone = React.useDeferredValue(zone);
  const busy = useCanvasInteracting();
  const previous = React.useRef(zone === "enter");
  // Keep mounted content stable in both zoom directions until the gesture settles.
  const low = busy ? previous.current : resolveCanvasLodZone(deferredZone, previous.current);
  previous.current = low;
  return <CanvasLodContext.Provider value={low}>{children}</CanvasLodContext.Provider>;
}
export function useCanvasInteracting(enabled = true) {
  const store = React.useContext(InteractionStoreContext);
  const fallback = React.useContext(CanvasInteractingContext);
  const snapshot = React.useCallback(() => enabled && (store?.getSnapshot() ?? fallback), [enabled, store, fallback]);
  return React.useSyncExternalStore(enabled && store ? store.subscribe : subscribeIdle, snapshot, snapshot);
}
export function CanvasRuntimeProvider({ interacting, children, owner }: { interacting: boolean; children: React.ReactNode; owner?: number | "guest" }) {
  const [runtime] = React.useState(() => createRuntime(owner));
  const [settling, setSettling] = React.useState(interacting);
  React.useEffect(() => { if(interacting) { setSettling(true); return; } const timer = setTimeout(() => setSettling(false), 180); return () => clearTimeout(timer); }, [interacting]);
  const busy = interacting || settling;
  const [interactionStore] = React.useState(() => createInteractionStore(busy));
  React.useLayoutEffect(() => interactionStore.set(busy), [busy, interactionStore]);
  React.useEffect(() => {
    let frame = 0;
    const wake = () => { if (!frame && runtime.mounts.size) frame = requestAnimationFrame(tick); };
    const tick = () => { frame = 0; runtime.mounts.flush(busy); wake(); };
    runtime.mounts.onPending = wake;
    wake();
    return () => { runtime.mounts.onPending = undefined; cancelAnimationFrame(frame); };
  }, [busy, runtime]);
  return <CanvasRuntimeContext.Provider value={runtime}><InteractionStoreContext.Provider value={interactionStore}>{children}</InteractionStoreContext.Provider></CanvasRuntimeContext.Provider>;
}
