"use client";

import * as React from "react";
import { ReactFlow, applyNodeChanges, type NodeChange, type ReactFlowProps } from "@xyflow/react";
import type { CanvasFlowNode } from "./CanvasNodeCard";
import type { CanvasEdge } from "@/lib/canvas/document";

type PositionChange = Extract<NodeChange<CanvasFlowNode>, { type: "position" }>;
const EMPTY: PositionChange[] = [];

/** Transient single-node positions notify only the flow surface, not the editor. */
export function createCanvasDragPositions() {
  let changes = EMPTY;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => changes,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(next: PositionChange[]) { changes = next; listeners.forEach(listener => listener()); },
    clear() { if (changes === EMPTY) return; changes = EMPTY; listeners.forEach(listener => listener()); },
  };
}

export function CanvasDragFlow({ positions, nodes, ...props }: ReactFlowProps<CanvasFlowNode, CanvasEdge> & { positions: ReturnType<typeof createCanvasDragPositions> }) {
  const changes = React.useSyncExternalStore(positions.subscribe, positions.getSnapshot, positions.getSnapshot);
  const displayed = React.useMemo(() => changes.length ? applyNodeChanges(changes, nodes ?? []) : nodes, [changes, nodes]);
  return <ReactFlow<CanvasFlowNode, CanvasEdge> {...props} nodes={displayed} />;
}
