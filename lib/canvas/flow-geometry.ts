import { Position, type NodeHandle } from "@xyflow/react";
import type { CanvasNode } from "@/lib/canvas/document";
import { DEFAULT_CANVAS_AUDIO_NODE_SIZE, DEFAULT_CANVAS_MEDIA_NODE_SIZE } from "@/lib/canvas/media-size";
import { getCanvasImageResultLayout, getCanvasTaskResultFrameSize } from "@/lib/canvas/task-references";
import { getCanvasTextTaskFrameSize } from "@/lib/canvas/text-node";
import { CANVAS_LEFT_OUTPUT_HANDLE_ID, CANVAS_MEDIA_BODY_TARGET_HANDLE_ID, CANVAS_MEDIA_INPUT_HANDLE_ID, CANVAS_RIGHT_OUTPUT_HANDLE_ID, CANVAS_TASK_BODY_TARGET_HANDLE_ID, CANVAS_TASK_INPUT_HANDLE_ID } from "@/lib/canvas/connection-rules";

/** Offscreen nodes need handle geometry too, so crossing edges exist before DOM measurement. */
export function getCanvasFlowGeometry(node: CanvasNode) {
  const kind = node.data.kind;
  const task = kind === "imageTask" || kind === "videoTask" || kind === "llm";
  const media = kind === "image" || kind === "video" || kind === "audio";
  const uploadedMedia = (node.data.kind === "image" || node.data.kind === "video" || node.data.kind === "audio") && node.data.origin === "upload";
  const fallback = kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE
    : kind === "image" || kind === "video" ? DEFAULT_CANVAS_MEDIA_NODE_SIZE
      : kind === "prompt" || kind === "llm" ? { width: 350, height: 200 }
        : { width: 280, height: 180 };
  const size = kind === "imageTask" || kind === "videoTask" ? getCanvasTaskResultFrameSize(node.data)
    : node.data.kind === "llm" ? getCanvasTextTaskFrameSize(node.data)
      : { width: node.width ?? fallback.width, height: node.height ?? fallback.height };
  const connectionFrame = node.data.kind === "imageTask" ? getCanvasImageResultLayout(node.data).primary : { x: 0, y: 0, ...size };
  const plainGroup = node.data.kind === "group" && !node.data.stacked;
  const handles: NodeHandle[] = plainGroup || kind === "compare" ? [] : [
    { type: "source", position: Position.Right, id: CANVAS_RIGHT_OUTPUT_HANDLE_ID, x: connectionFrame.x + connectionFrame.width, y: connectionFrame.y + connectionFrame.height / 2, width: 0, height: 0 },
  ];
  if (!plainGroup && !uploadedMedia) {
    handles.push({ type: "target", position: Position.Left, id: media ? CANVAS_MEDIA_INPUT_HANDLE_ID : task ? CANVAS_TASK_INPUT_HANDLE_ID : undefined, x: connectionFrame.x, y: connectionFrame.y + connectionFrame.height / 2, width: 0, height: 0 });
  }
  if (media || task || kind === "prompt") {
    handles.push({ type: "source", position: Position.Left, id: CANVAS_LEFT_OUTPUT_HANDLE_ID, x: connectionFrame.x, y: connectionFrame.y + connectionFrame.height / 2, width: 0, height: 0 });
  }
  if ((media && !uploadedMedia) || task || kind === "compare") {
    const inset = media || kind === "compare" ? 20 : 0;
    handles.push({ type: "target", position: Position.Left, id: media ? CANVAS_MEDIA_BODY_TARGET_HANDLE_ID : CANVAS_TASK_BODY_TARGET_HANDLE_ID, x: connectionFrame.x - inset, y: connectionFrame.y - inset, width: connectionFrame.width + inset * 2, height: connectionFrame.height + inset * 2 });
  }
  return { ...size, initialWidth: size.width, initialHeight: size.height, measured: size, handles };
}
