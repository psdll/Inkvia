// Persistent media cache: bounded entries and bounded background writes.
// Keep v2 so this fix does not make every existing thumbnail cold at once.
const CACHE_NAME = "media-thumb-cache-v2";
const CACHEABLE_PREFIXES = ["/uploads/", "/api/media-proxy", "/api/thumb"];
const MAX_ENTRIES = 1000;
const MAX_WRITES = 6;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = "x-sw-cached-at";
let activeWrites = 0;

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("media-thumb-cache-") && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

function shouldHandle(request) {
  if (request.method !== "GET" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (!CACHEABLE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) return false;
  if (request.destination && request.destination !== "image") return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  if (!shouldHandle(event.request)) return;
  let cacheWrite = Promise.resolve();
  const response = handleFetch(event.request, task => { cacheWrite = task; });
  event.respondWith(response);
  event.waitUntil(response.then(() => cacheWrite).catch(() => undefined));
});

async function handleFetch(request, retainWrite = () => {}) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER) || 0);
    if (cachedAt > 0 && Date.now() - cachedAt < MAX_AGE_MS) return cached;
    await cache.delete(request).catch(() => undefined);
  }
  let response;
  try { response = await fetch(request); }
  catch {
    return cached || new Response("", { status: 504, statusText: "Gateway Timeout" });
  }
  // The HTTP cache still handles requests skipped here. Never queue hundreds of
  // cloned response streams or buffer original videos/files in the SW heap.
  if (response.ok && response.status !== 206 && activeWrites < MAX_WRITES
      && (response.headers.get("content-type") || "").startsWith("image/")
      && Number(response.headers.get("content-length") || 0) <= 4 * 1024 * 1024) {
    activeWrites++;
    retainWrite(writeToCache(cache, request, response.clone()).catch(() => undefined).finally(() => { activeWrites--; }));
  }
  return response;
}

async function writeToCache(cache, request, response) {
  await enforceMaxEntries(cache);
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  // Stream to storage instead of materializing an extra whole-file Blob.
  const stamped = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  try { await cache.put(request, stamped); }
  catch (err) {
    if (err && (err.name === "QuotaExceededError" || /quota/i.test(String(err.message || "")))) {
      await purgeFraction(cache, 0.5);
      // A failed put may have consumed the body; do not clone/retry that stream.
    }
  }
}

async function enforceMaxEntries(cache) {
  const keys = await cache.keys();
  if (keys.length < MAX_ENTRIES - MAX_WRITES + 1) return;
  // Cache.keys() is insertion ordered. Evict in batches without opening every
  // stored response (the previous implementation did 500 reads per new image).
  const removeCount = keys.length - (MAX_ENTRIES - 50);
  for (const key of keys.slice(0, removeCount)) await cache.delete(key).catch(() => undefined);
}

async function purgeFraction(cache, fraction) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.ceil(keys.length * fraction))) await cache.delete(key).catch(() => undefined);
}
