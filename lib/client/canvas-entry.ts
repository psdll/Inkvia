"use client";

import { fetchJsonOnce } from "./inflight-json";
import { buildMediaPreviewCandidates } from "@/lib/media-url";
import { subscribeMaterialPreview } from "./material-preview-queue";
import { loadCanvasBootstrap, type CanvasBootstrap } from "@/lib/canvas/bootstrap-client";
import { readCanvasEntrySnapshot, writeCanvasEntrySnapshot } from "@/lib/canvas/entry-snapshot";
import { warmCanvasViewport } from "@/lib/canvas/entry-previews";

export type CanvasListItem = { id: number; publicId: string; title: string; thumbnail?: string | null; sortOrder: number; revision: string; updatedAt: string };
type ListCache = { at: number; items: CanvasListItem[] };
const lists = new Map<string, ListCache>();
const listRequests = new Map<string, Promise<CanvasListItem[]>>();
const snapshots = new Map<string, Promise<CanvasBootstrap>>();
const PREFIX = "canvas-projects-v1:";
let epoch = 0;
let boardRequest: Promise<unknown> | undefined;
export function warmCanvasBoard() {
  return boardRequest ??= import("@/components/canvas/SmartCanvasBoard").catch(() => { boardRequest = undefined; });
}

export function readCanvasProjects(owner: number, trash = false): CanvasListItem[] | undefined {
  const key = `${owner}:${trash}`;
  let cached = lists.get(key);
  if (!cached && typeof window !== "undefined") {
    try { cached = JSON.parse(localStorage.getItem(PREFIX + key) || "null") ?? undefined; } catch {}
  }
  return cached && Array.isArray(cached.items) && Date.now() - cached.at < 300_000 ? cached.items : undefined;
}

export function cacheCanvasProjects(owner: number, items: CanvasListItem[], trash = false) {
  const key = `${owner}:${trash}`, value = { at: Date.now(), items };
  lists.set(key, value);
  try { const text = JSON.stringify(value); if (text.length < 300_000) localStorage.setItem(PREFIX + key, text); } catch {}
}

export function loadCanvasProjects(owner: number, trash = false) {
  const key = `${owner}:${trash}`;
  const pending = listRequests.get(key);
  if (pending) return pending;
  const generation = epoch;
  const request = fetchJsonOnce<{ success?: boolean; items?: CanvasListItem[] }>(`/api/canvas${trash ? "?trash=1" : ""}`, String(owner)).then(result => {
    if (!result.ok || !result.json?.success) throw new Error("加载项目失败，请重试");
    const items = result.json.items ?? [];
    if (generation === epoch) cacheCanvasProjects(owner, items, trash);
    return items;
  }).finally(() => { if (listRequests.get(key) === request) listRequests.delete(key); });
  listRequests.set(key, request);
  return request;
}

export function warmCanvasEntry(owner: number) {
  if (readCanvasProjects(owner)) return;
  void loadCanvasProjects(owner).then(items => {
    items.slice(0, 10).forEach(item => {
      if (item.thumbnail) subscribeMaterialPreview(buildMediaPreviewCandidates(item.thumbnail, { width: 600, height: 375, mode: "cover" }), 1000, () => {});
    });
  }).catch(() => undefined);
}

export function loadCanvasForEntry(owner: number, canvasId: number, prefetch = false) {
  const key = `${owner}:${canvasId}:${prefetch}`;
  const pending = snapshots.get(key);
  if (pending) return pending;
  const generation = epoch;
  const request = (async () => {
    const cached = await readCanvasEntrySnapshot(owner, canvasId).catch(() => undefined);
    const loaded = await loadCanvasBootstrap(canvasId, undefined, { cached, readOnly: prefetch, onPage: (nodes, viewport) => {
      if (generation === epoch) warmCanvasViewport(owner, canvasId, nodes, viewport);
    } });
    if (generation === epoch) void writeCanvasEntrySnapshot(owner, canvasId, loaded).catch(() => undefined);
    return loaded;
  })().finally(() => { if (snapshots.get(key) === request) snapshots.delete(key); });
  snapshots.set(key, request);
  return request;
}

let lastWarm = "";
let lastWarmAt = 0;
export function warmCanvasProject(owner: number, canvasId: number) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /2g/.test(connection?.effectiveType || "")) return;
  const key = `${owner}:${canvasId}`;
  if ((lastWarm === key && Date.now() - lastWarmAt < 15_000) || snapshots.size > 1) return;
  lastWarm = key; lastWarmAt = Date.now();
  void warmCanvasBoard();
  void loadCanvasForEntry(owner, canvasId, true).catch(() => undefined);
}

export function clearCanvasEntries() {
  epoch++; lists.clear(); listRequests.clear(); snapshots.clear(); lastWarm = "";
  try { Object.keys(localStorage).filter(key => key.startsWith(PREFIX)).forEach(key => localStorage.removeItem(key)); } catch {}
}
if (typeof window !== "undefined") window.addEventListener("auth:logout", clearCanvasEntries);
