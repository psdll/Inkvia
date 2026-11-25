import { getCanvasPrimaryImageOutput } from "./image-task";
import type { CanvasNode, CanvasViewport } from "./document";
import { CanvasLru, CanvasWorkQueue } from "./render-runtime";
import { buildCanvasImageCandidates, getCanvasLocalVideoPosterSource } from "./media-url";
import { readCanvasViewportPreference } from "./viewport-preference";

function decodedBudget() {
  const memory = typeof navigator === "undefined" ? 4 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  // Re-entering nodes repaint synchronously only while their pixels are retained.
  return (memory <= 2 ? 64 : memory <= 4 ? 128 : 256) * 1024 * 1024;
}

function createCache() {
  return {
    decoded: new CanvasLru<HTMLImageElement>(400, decodedBudget(), image => image.naturalWidth * image.naturalHeight * 4),
    previews: new CanvasLru<{ url: string; original: boolean }>(1000),
  };
}
let ownerCache: { owner: number | "guest"; cache: ReturnType<typeof createCache> } | undefined;
const queue = new CanvasWorkQueue(3);
const pending = new Set<string>();
export function getCanvasEntryPreviews(owner?: number | "guest") {
  if (owner === undefined) return createCache();
  if (ownerCache?.owner !== owner) ownerCache = { owner, cache: createCache() };
  return ownerCache.cache;
}

export function warmCanvasViewport(owner: number, canvasId: number, nodes: CanvasNode[], viewport: CanvasViewport) {
  if (typeof window === "undefined") return;
  try { viewport = readCanvasViewportPreference(localStorage, owner, canvasId) ?? viewport; } catch {}
  const cache = getCanvasEntryPreviews(owner);
  const sources = nodes.filter(node => {
    if (node.parentId) return false;
    const x = node.position.x * viewport.zoom + viewport.x, y = node.position.y * viewport.zoom + viewport.y;
    return x < window.innerWidth + 200 && y < window.innerHeight + 200 && x + (node.width ?? 350) * viewport.zoom > -200 && y + (node.height ?? 250) * viewport.zoom > -200;
  }).map(node => {
    const data = node.data;
    return data.kind === "image" ? data.url
      : data.kind === "imageTask" ? getCanvasPrimaryImageOutput(data.task.batches.at(-1))?.url
      : data.kind === "video" ? data.posterUrl || data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.url)
      : data.kind === "videoTask" ? data.variants?.poster?.url || data.variants?.thumbnail?.url || getCanvasLocalVideoPosterSource(data.outputUrl) : undefined;
  }).filter((source): source is string => Boolean(source)).slice(0, 32);
  for (const source of new Set(sources)) {
    const candidate = buildCanvasImageCandidates(source, 200).find(item => !item.original);
    if (!candidate || cache.decoded.get(candidate.url)) continue;
    const key = `${owner}:${candidate.url}`;
    if (pending.has(key)) continue;
    pending.add(key);
    queue.add(key, () => new Promise<void>(resolve => {
      const image = new Image(); image.decoding = "async";
      const finish = () => { clearTimeout(timer); image.onload = image.onerror = null; pending.delete(key); resolve(); };
      const timer = setTimeout(() => { image.src = ""; finish(); }, 5000);
      image.onerror = finish;
      image.onload = () => {
        void (image.decode ? image.decode() : Promise.resolve()).then(() => {
          cache.decoded.set(candidate.url, image); cache.previews.set(source, candidate);
        }).catch(() => undefined).finally(finish);
      };
      image.src = candidate.url;
    }), 0);
  }
}
if (typeof window !== "undefined") window.addEventListener("auth:logout", () => { ownerCache = undefined; });
