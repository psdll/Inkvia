export type CanvasVideoPoster = { url: string; tier: number };

const CACHE_NAME = "canvas-video-posters-v1";
const MAX_ENTRIES = 256;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let writes = Promise.resolve();

function cacheKey(owner: number | "guest" | undefined, source: string) {
  if (owner === undefined || owner === "guest" || !source || /^(blob:|data:)/.test(source)) return null;
  return `${location.origin}/__canvas_video_poster__/${owner}/${encodeURIComponent(source)}`;
}

function valid(value: unknown): value is CanvasVideoPoster & { savedAt: number } {
  const item = value as CanvasVideoPoster & { savedAt: number } | null;
  return Boolean(item && typeof item.url === "string" && item.url.startsWith("data:image/jpeg;")
    && item.url.length <= 512_000 && Number.isFinite(item.tier) && item.tier > 0
    && Number.isFinite(item.savedAt) && Date.now() - item.savedAt < MAX_AGE_MS);
}

// The player has its own fallback timer. Keep late cache hits alive: main-thread
// work during mount can delay storage callbacks beyond that timer.
export async function readCanvasVideoPoster(owner: number | "guest" | undefined, source: string): Promise<CanvasVideoPoster | null> {
  if (typeof caches === "undefined") return null;
  const key = cacheKey(owner, source);
  if (!key) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(key);
    if (!response) return null;
    const value: unknown = await response.json();
    if (!valid(value)) { void cache.delete(key).catch(() => {}); return null; }
    return { url: value.url, tier: value.tier };
  } catch { return null; }
}

export function writeCanvasVideoPoster(owner: number | "guest" | undefined, source: string, poster: CanvasVideoPoster) {
  if (typeof caches === "undefined") return;
  const key = cacheKey(owner, source);
  if (!key || !valid({ ...poster, savedAt: Date.now() })) return;
  // Serialize pruning and writes, so simultaneous captures cannot grow the cache unboundedly.
  writes = writes.then(async () => {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.match(key);
    const previous: unknown = existing ? await existing.json().catch(() => null) : null;
    if (valid(previous) && previous.tier >= poster.tier) return;
    await cache.delete(key);
    await cache.put(key, new Response(JSON.stringify({ ...poster, savedAt: Date.now() }), { headers: { "Content-Type": "application/json" } }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map(request => cache.delete(request)));
  }).catch(() => {});
  return writes;
}

export function invalidateCanvasVideoPoster(owner: number | "guest" | undefined, source: string) {
  if (typeof caches === "undefined") return;
  const key = cacheKey(owner, source);
  if (!key) return;
  writes = writes.then(async () => { await (await caches.open(CACHE_NAME)).delete(key); }).catch(() => {});
  return writes;
}
