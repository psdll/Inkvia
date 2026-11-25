"use client";

import * as React from "react";
import { useStoreApi } from "@xyflow/react";
import { bindCanvasEdgeViewport } from "@/lib/canvas/edge-viewport";

/** Keep native SVG coordinates inside a bounded, screen-resolution edge layer. */
export function CanvasEdgeViewport({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const store = useStoreApi();
  React.useEffect(() => {
    const edges = canvasRef.current?.querySelector<HTMLDivElement>(".react-flow__edges");
    if (!edges) return;
    const sync = bindCanvasEdgeViewport(edges, () => {
      const { transform, width, height } = store.getState();
      return { transform, width, height };
    });
    const unsubscribe = store.subscribe(sync.update);
    return () => { unsubscribe(); sync.dispose(); };
  }, [canvasRef, store]);
  return null;
}
