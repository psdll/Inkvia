import "server-only";

import fs from "node:fs";
import path from "node:path";
import { resolveUploadsRootDirectory } from "@/lib/storage";

type DeletedUploadListener = (url: string) => void;

const listeners = new Set<DeletedUploadListener>();
const pendingPaths = new Map<string, ReturnType<typeof setTimeout>>();
let watcher: fs.FSWatcher | null = null;
let watchedRoot = "";

export function deletedUploadUrlFromPath(uploadsRoot: string, filePath: string) {
  const root = path.resolve(uploadsRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return `/uploads/${relative.split(path.sep).join("/")}`;
}

function stopWatching() {
  watcher?.close();
  watcher = null;
  watchedRoot = "";
  for (const timer of pendingPaths.values()) clearTimeout(timer);
  pendingPaths.clear();
}

function startWatching() {
  if (watcher || !listeners.size) return;
  const uploadsRoot = resolveUploadsRootDirectory();
  if (!fs.existsSync(uploadsRoot)) return;
  watchedRoot = uploadsRoot;
  try {
    watcher = fs.watch(uploadsRoot, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (!filename) return;
      const filePath = path.resolve(uploadsRoot, filename.toString());
      const url = deletedUploadUrlFromPath(uploadsRoot, filePath);
      if (!url) return;
      const previous = pendingPaths.get(filePath);
      if (previous) clearTimeout(previous);
      pendingPaths.set(filePath, setTimeout(() => {
        pendingPaths.delete(filePath);
        if (fs.existsSync(filePath)) return;
        for (const listener of listeners) listener(url);
      }, 25));
    });
    watcher.on("error", stopWatching);
  } catch {
    stopWatching();
  }
}

export function subscribeCanvasUploadDeletion(listener: DeletedUploadListener) {
  listeners.add(listener);
  startWatching();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stopWatching();
  };
}
