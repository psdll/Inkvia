"use client";
import * as React from "react";
import { useStore, useStoreApi, type ReactFlowState } from "@xyflow/react";
import { CanvasMediaImage } from "./CanvasMediaImage";
import { getCanvasLowDetailImageUrl, type CanvasFlowNode } from "./CanvasNodeCard";
import { CANVAS_LOD_EXIT_ZOOM } from "@/lib/canvas/visual-policy";
import { getCanvasLocalVideoPosterSource } from "@/lib/canvas/media-url";

// Prepare resources outside the viewport; keep node and edge virtualization unchanged.
function nearViewport(state: ReactFlowState<CanvasFlowNode>, node: CanvasFlowNode & { internals: { positionAbsolute: { x: number; y: number } } }, margin: number, ahead = { x: 0, y: 0 }) {
  const [tx, ty, zoom] = state.transform;
  const x = tx + node.internals.positionAbsolute.x * zoom;
  const y = ty + node.internals.positionAbsolute.y * zoom;
  const right = x + (node.measured?.width ?? node.width ?? 350) * zoom;
  const bottom = y + (node.measured?.height ?? node.height ?? 200) * zoom;
  return right > -margin - Math.max(0, ahead.x) && bottom > -margin - Math.max(0, ahead.y)
    && x < state.width + margin + Math.max(0, -ahead.x) && y < state.height + margin + Math.max(0, -ahead.y);
}

function neighboringMedia(state: ReactFlowState<CanvasFlowNode>, previous: ReadonlySet<string>, ahead = { x: 0, y: 0 }) {
  const [tx, ty, zoom] = state.transform;
  // Overview thumbnails already cover a large world area. Never warm another
  // screen-sized ring (or offscreen video decoders) at these zoom levels.
  if (!state.width || !state.height || zoom < CANVAS_LOD_EXIT_ZOOM) return [];
  return [...state.nodeLookup.values()].filter(node => {
    if (node.hidden || !["image", "imageTask", "video", "videoTask"].includes(node.data.kind)) return false;
    if (!getCanvasLowDetailImageUrl(node.data) && !videoPoster(node.data)) return false;
    const margin = Math.min(900, Math.max(360, state.width * .5)) + (previous.has(node.id) ? 160 : 0);
    return (nearViewport(state, node, margin) || nearViewport(state, node, 240, ahead))
      && !nearViewport(state, node, 0);
  }).sort((a, b) => {
    const distance = (node: typeof a) => {
      const x = tx + node.internals.positionAbsolute.x * zoom + ahead.x * .25;
      const y = ty + node.internals.positionAbsolute.y * zoom + ahead.y * .25;
      return Math.hypot(Math.max(0, -x, x - state.width), Math.max(0, -y, y - state.height));
    };
    return distance(a) - distance(b);
  }).slice(0, 24);
}

function videoPoster(data: CanvasFlowNode["data"]) {
  return data.kind === "video" ? data.posterUrl || data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.url)
    : data.kind === "videoTask" ? data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.outputUrl) : undefined;
}

export function CanvasMediaPrefetch() {
  const store = useStoreApi<CanvasFlowNode>();
  const overview = useStore(state => state.transform[2] < CANVAS_LOD_EXIT_ZOOM);
  const [nodes, setNodes] = React.useState<ReturnType<typeof neighboringMedia>>([]);
  React.useEffect(() => {
    if (overview) {
      setNodes(current => current.length ? [] : current);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = new Set<string>();
    let last = store.getState().transform;
    let lastAt = performance.now();
    const update = () => {
      timer = undefined;
      const state = store.getState();
      const now = performance.now();
      const elapsed = Math.max(60, now - lastAt);
      // Throttled prediction follows the gesture; never scan the graph per frame.
      const ahead = state.transform[2] === last[2] ? {
        x: Math.max(-state.width * 2, Math.min(state.width * 2, (state.transform[0] - last[0]) * 400 / elapsed)),
        y: Math.max(-state.height * 2, Math.min(state.height * 2, (state.transform[1] - last[1]) * 400 / elapsed)),
      } : { x: 0, y: 0 };
      last = state.transform; lastAt = now;
      const next = neighboringMedia(state, previous, ahead);
      previous = new Set(next.map(node => node.id));
      setNodes(current => current.length === next.length && current.every((node, i) => node === next[i]) ? current : next);
    };
    update();
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.transform === previous.transform && state.width === previous.width && state.height === previous.height && state.nodes === previous.nodes) return;
      if (!timer) timer = setTimeout(update, 120);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [store, overview]);
  return <div hidden aria-hidden="true" data-canvas-media-prefetch>{!overview ? nodes.map(node => {
    const data = node.data;
    const image = getCanvasLowDetailImageUrl(data);
    const source = image || videoPoster(data);
    return source ? <CanvasMediaImage key={node.id} src={source} prefetch thumbnailSize={100} /> : null;
  }) : null}</div>;
}
