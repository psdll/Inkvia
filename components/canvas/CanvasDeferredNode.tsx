"use client";
import * as React from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import { CanvasNodeCard, getCanvasLowDetailImageUrl, type CanvasFlowNode } from "./CanvasNodeCard";
import { CanvasRuntimeContext, useCanvasInteracting } from "./canvas-runtime-context";
import { getCanvasFlowGeometry } from "@/lib/canvas/flow-geometry";
import { CanvasNodeSubscription } from "./CanvasNodeSubscriptions";
import { CanvasMediaImage } from "./CanvasMediaImage";
import { CanvasLodHandoff } from "./CanvasLodHandoff";
import { hasCanvasThumbnailContent } from "@/lib/canvas/thumbnail-eligibility";
import { getCanvasLocalVideoPosterSource } from "@/lib/canvas/media-url";
export const CanvasDeferredNode = React.memo(function CanvasDeferredNode(props: NodeProps<CanvasFlowNode>) {
  // Group frames fill React Flow's explicitly sized wrapper. Thumbnail handoff
  // containers have auto height and would collapse their percentage-height fill.
  return <CanvasNodeSubscription id={props.id}>{!hasCanvasThumbnailContent(props.data)
    ? <CanvasNodeCard {...props} />
    : <DeferredContent {...props} />}</CanvasNodeSubscription>;
});
function DeferredContent(props: NodeProps<CanvasFlowNode>) {
  const runtime = React.useContext(CanvasRuntimeContext);
  const interacting = useCanvasInteracting();
  const interactingRef = React.useRef(interacting);
  interactingRef.current = interacting;
  const [ready, setReady] = React.useState(() => !runtime || Boolean(runtime.mounts.has?.(props.id)));
  const deferredRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (!runtime) return; runtime.mounts.add(props.id, () => setReady(true), interactingRef.current); return () => runtime.mounts.cancel(props.id); }, [props.id, runtime]);
  const localUpload = (props.data.kind === "image" || props.data.kind === "video" || props.data.kind === "audio") && props.data.url.startsWith("blob:");
  const data = props.data;
  const source = getCanvasLowDetailImageUrl(data) || (data.kind === "video" ? data.posterUrl || data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.url) : data.kind === "videoTask" ? data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.outputUrl) : undefined);
  const videoSource = data.kind === "video" ? data.url : data.kind === "videoTask" && data.status === "success" ? data.outputUrl : undefined;
  const admitHoveredVideo = React.useCallback(() => {
    if (!ready && !interactingRef.current && videoSource) runtime?.mounts.prioritize(props.id);
  }, [ready, videoSource, runtime, props.id]);
  React.useEffect(() => {
    // A pointer can stop on this placeholder while the mount queue is paused.
    if (!interacting && deferredRef.current?.matches(":hover")) admitHoveredVideo();
  }, [interacting, admitHoveredVideo]);
  if (!ready && props.data.kind !== "group" && !props.selected && !props.dragging && !localUpload) {
    const preview = source ? runtime?.previews?.get(source) : undefined;
    // Metadata can outlive decoded pixels. Reuse decoded previews immediately;
    // cold images use the existing small-thumbnail queue, never a video player.
    const image = preview && !preview.original ? runtime?.decoded.get(preview.url) : undefined;
    // Extracted frames use a separate bounded cache. Its data URL already
    // contains the poster bytes; reusing it never initializes the video.
    const frame = videoSource ? runtime?.videoPosters?.get(videoSource) : undefined;
    const previewUrl = image?.complete && image.naturalWidth > 0 ? preview?.url
      : frame?.url.startsWith("data:image/") ? frame.url : undefined;
    const geometry = getCanvasFlowGeometry({ id: props.id, type: props.data.kind, data: props.data, position: { x: 0, y: 0 }, width: props.width, height: props.height });
    return <CanvasLodHandoff lowDetail source={videoSource || source}><div ref={deferredRef} onMouseEnter={admitHoveredVideo} data-canvas-deferred-node className="canvas-low-detail-skeleton" style={{ width: geometry.width, height: geometry.height, background: "var(--canvas-media-placeholder, var(--canvas-node-bg))", borderRadius: 12 }}>
      {previewUrl ? <img key={previewUrl} data-canvas-deferred-preview src={previewUrl} alt="" draggable={false} decoding="async" className="pointer-events-none h-full w-full rounded-[12px] object-cover" />
        : source ? <CanvasMediaImage src={source} thumbnailSize={100} alt="" className="pointer-events-none h-full w-full rounded-[12px] object-cover" /> : null}
      {geometry.handles.map((handle, index) => <Handle key={index} id={handle.id} type={handle.type} position={handle.position} className="!opacity-0" style={{ left: handle.x, top: handle.y, width: handle.width, height: handle.height, transform: "none" }} />)}
    </div></CanvasLodHandoff>;
  }
  return <CanvasLodHandoff lowDetail={false} source={videoSource || source}><CanvasNodeCard {...props} deferContent={!ready} /></CanvasLodHandoff>;
}
