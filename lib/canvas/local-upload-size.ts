"use client";

import {
  DEFAULT_CANVAS_MEDIA_NODE_SIZE,
  DEFAULT_CANVAS_AUDIO_NODE_SIZE,
  getCanvasMediaNodeSize,
} from "@/lib/canvas/media-size";
import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import { fitCanvasGroupBounds } from "@/lib/canvas/group-layout";

export type CanvasLocalUploadKind = "image" | "video" | "audio";

export { CANVAS_LOCAL_UPLOAD_GAP, getCanvasLocalUploadPositions } from "./material-placement";
export const CANVAS_IMAGE_UPLOAD_BATCH_LIMIT = 20;
export const CANVAS_PENDING_AUDIO_NODE_SIZE = { width: 300, height: 300 } as const;

/** Apply newly discovered dimensions without undoing edits made while reading the files. */
export function hydrateCanvasLocalUploadLayout(document: CanvasDocumentV2, before: CanvasNode[], after: CanvasNode[]) {
  const previous = new Map(before.map(node => [node.id, node]));
  const next = new Map(after.map(node => [node.id, node]));
  const groups = new Set<string>();
  let changed = false;
  const nodes = document.nodes.map(node => {
    const old = previous.get(node.id) ?? before.find(candidate =>
      "url" in candidate.data && "url" in node.data && candidate.data.url === node.data.url && node.data.url.startsWith("blob:"));
    const ready = old && next.get(old.id);
    if (!old || !ready) return node;
    const size = node.width === old.width && node.height === old.height
      ? { width: ready.width, height: ready.height } : { width: node.width, height: node.height };
    const position = node.id === old.id && !node.parentId && node.position.x === old.position.x && node.position.y === old.position.y
      ? ready.position : node.position;
    if (size.width === node.width && size.height === node.height && position.x === node.position.x && position.y === node.position.y) return node;
    changed = true;
    if (node.parentId) groups.add(node.parentId);
    return { ...node, ...size, position };
  });
  return changed ? { ...document, nodes: groups.size ? fitCanvasGroupBounds(nodes, groups, true) : nodes } : document;
}


function inferCanvasLocalUploadKind(file: File): CanvasLocalUploadKind {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "image";
}

function readImageDimensions(objectUrl: string) {
  const image = document.createElement("img");

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to read image dimensions"));
    };
    const timeout = setTimeout(handleError, 10_000);

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    try {
      image.src = objectUrl;
    } catch (error) {
      cleanup();
      reject(error);
    }
  }).finally(() => {
    image.removeAttribute("src");
  });
}

function readVideoDimensions(objectUrl: string) {
  const video = document.createElement("video");
  video.preload = "metadata";

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleMetadata);
      video.removeEventListener("error", handleError);
    };
    const handleMetadata = () => {
      cleanup();
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to read video dimensions"));
    };
    const timeout = setTimeout(handleError, 10_000);

    video.addEventListener("loadedmetadata", handleMetadata, { once: true });
    video.addEventListener("error", handleError, { once: true });
    try {
      video.src = objectUrl;
      video.load();
    } catch (error) {
      cleanup();
      reject(error);
    }
  }).finally(() => {
    video.removeAttribute("src");
    video.load();
  });
}

/** Read the source media, not its potentially cropped thumbnail. */
export async function getCanvasUrlMediaNodeSize(url: string, kind: CanvasLocalUploadKind) {
  if (kind === "audio") return DEFAULT_CANVAS_AUDIO_NODE_SIZE;
  const dimensions = kind === "video" ? await readVideoDimensions(url) : await readImageDimensions(url);
  if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error("无法读取素材尺寸，请重试");
  return getCanvasMediaNodeSize(dimensions.width, dimensions.height);
}

export async function getCanvasLocalUploadNodeSize(
  file: File,
  kind: CanvasLocalUploadKind = inferCanvasLocalUploadKind(file),
  previewUrl?: string,
): Promise<{ width: number; height: number }> {
  if (kind === "audio") return CANVAS_PENDING_AUDIO_NODE_SIZE;
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return DEFAULT_CANVAS_MEDIA_NODE_SIZE;
  }

  let objectUrl: string | null = null;
  try {
    objectUrl = previewUrl || URL.createObjectURL(file);
    const dimensions =
      kind === "video"
        ? await readVideoDimensions(objectUrl)
        : await readImageDimensions(objectUrl);
    return getCanvasMediaNodeSize(dimensions.width, dimensions.height);
  } catch {
    return DEFAULT_CANVAS_MEDIA_NODE_SIZE;
  } finally {
    if (objectUrl && !previewUrl) URL.revokeObjectURL(objectUrl);
  }
}
