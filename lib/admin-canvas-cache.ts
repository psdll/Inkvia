import { loadCanvasBootstrap } from "@/lib/canvas/bootstrap-client";
import { warmCanvasViewport } from "@/lib/canvas/entry-previews";

export type AdminCanvasItem = { id: number; title: string; thumbnail: string | null; updatedAt: string; nodeCount: number; edgeCount: number; revision: string };
export type AdminCanvasList = { items: AdminCanvasItem[]; hasMore: boolean };
export type AdminCanvasDocument = Awaited<ReturnType<typeof loadCanvasBootstrap>>;

// Memory only: private canvas contents must never enter shared HTTP/disk caches.
// One bounded cache covers list pages and documents, with request coalescing.
export class AdminCanvasCache {
  private entries = new Map<string, { value: unknown; bytes: number; at: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private bytes = 0;
  private epoch = 0;
  constructor(private maxEntries = 20, private maxBytes = 32 * 1024 * 1024, private ttl = 30_000) {}
  peek<T>(key: string, allowExpired = false): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || (!allowExpired && Date.now() - entry.at >= this.ttl)) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value as T;
  }
  clear() { this.entries.clear(); this.inflight.clear(); this.bytes = 0; this.epoch++; }
  async load<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    const cached = !force ? this.peek<T>(key) : undefined;
    if (cached !== undefined) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const epoch = this.epoch;
    const request = loader().then(value => {
      if (epoch !== this.epoch) return value;
      const bytes = JSON.stringify(value).length * 2;
      const previous = this.entries.get(key);
      if (previous) { this.entries.delete(key); this.bytes -= previous.bytes; }
      if (bytes <= this.maxBytes) {
        this.entries.set(key, { value, bytes, at: Date.now() }); this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
          const oldest = this.entries.keys().next().value!;
          this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
        }
      }
      return value;
    }).finally(() => { if (this.inflight.get(key) === request) this.inflight.delete(key); });
    this.inflight.set(key, request);
    return request;
  }
}

export const adminCanvasCache = new AdminCanvasCache();
if (typeof window !== "undefined") window.addEventListener("inkvia:admin-session-ended", () => adminCanvasCache.clear());
const documentKey = (adminKey: string, id: number) => `document:${adminKey}:${id}`;
export const peekAdminCanvas = (adminKey: string, id: number) => adminCanvasCache.peek<AdminCanvasDocument>(documentKey(adminKey, id));

async function adminFetch(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 401 || response.status === 403) adminCanvasCache.clear();
  return response;
}

export function loadAdminCanvas(adminKey: string, id: number, force = false) {
  const cached = adminCanvasCache.peek<AdminCanvasDocument>(documentKey(adminKey, id), true);
  return adminCanvasCache.load(documentKey(adminKey, id), () => loadCanvasBootstrap(id, async input => {
    const query = new URL(String(input), "http://localhost").searchParams;
    query.set("adminKey", adminKey); query.set("canvasId", String(id));
    return adminFetch(`/api/admin/user/canvases?${query}`);
  }, {
    cached, readOnly: true,
    onPage: (nodes, viewport) => warmCanvasViewport(-Number(adminKey.split(":")[1]), id, nodes, viewport),
  }), force);
}

export function loadAdminCanvasList(adminKey: string, page: number, search: string, force = false) {
  const query = new URLSearchParams({ adminKey, page: String(page), q: search });
  return adminCanvasCache.load<AdminCanvasList>(`list:${query}`, async () => {
    const response = await adminFetch(`/api/admin/user/canvases?${query}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取画布列表失败");
    return body;
  }, force);
}
