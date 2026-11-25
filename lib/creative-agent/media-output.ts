import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { probeCanvasMediaPooled } from "@/lib/canvas/media-probe-pool";
import { getCanvasMediaNodeSize } from "@/lib/canvas/media-size";

/** Inspect the saved output, using the same dimensions and scale as a canvas upload. */
export async function readCreativeAgentMediaSize(url: string, kind: "image" | "video") {
  if (!url.startsWith("/uploads/") || url.includes("..") || url.includes("\\") || url.includes("\0") || isPrivateUploadPath(url.slice(9))) return null;
  try {
    const root = await fs.realpath(resolveUploadsRootDirectory());
    const file = await fs.realpath(path.resolve(root, url.slice(9)));
    if (!file.startsWith(root + path.sep)) return null;
    const probe = await probeCanvasMediaPooled(file, kind);
    if (!probe.width || !probe.height || !Number.isFinite(probe.width) || !Number.isFinite(probe.height) || probe.width <= 0 || probe.height <= 0) return null;
    return { size: getCanvasMediaNodeSize(probe.width, probe.height), original: { url, width: probe.width, height: probe.height } };
  } catch {
    // Keep the durable result available; the canvas can hydrate it on media load.
    return null;
  }
}
