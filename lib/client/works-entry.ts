"use client";

import { buildMediaPreviewCandidates, isAudioMediaUrl, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";

type WorkPreview = { thumbUrl?: string | null; displayUrl?: string | null; previewUrl?: string | null; posterUrl?: string | null; localPath?: string | null };
type Entry = { at: number; request: Promise<{ ok: boolean; json: any }> };
const entries = new Map<string, Entry>();

export function getWorkThumbnailCandidates(item: WorkPreview) {
  const preview = [item.posterUrl, item.previewUrl, item.displayUrl, item.localPath]
    .map(url => normalizeMediaUrl(url || "")).find(url => url && !isVideoMediaUrl(url) && !isAudioMediaUrl(url));
  const thumb = normalizeMediaUrl(item.thumbUrl || "");
  const prepared = thumb && thumb !== preview && !isVideoMediaUrl(thumb) && !isAudioMediaUrl(thumb) ? [thumb] : [];
  return Array.from(new Set([...prepared, ...(preview ? buildMediaPreviewCandidates(preview, { width: 600, height: 600, mode: "cover" }) : [])]));
}

function entryKey(url: string, userId: string) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.sort();
  return `${userId}:${parsed.pathname}?${parsed.searchParams}`;
}

export function clearWorksEntry() {
  entries.clear();
}

export function warmWorksEntry(userId: string) {
  if (!userId || typeof window === "undefined") return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
  const url = `/api/assets?userId=${encodeURIComponent(userId)}&tab=generated&take=60&source=creation&type=all&view=cards`;
  const key = entryKey(url, userId);
  const old = entries.get(key);
  if (old && Date.now() - old.at < 30000) return;
  clearWorksEntry();
  const entry: Entry = { at: Date.now(), request: fetch(url, { cache: "no-store" }).then(async response => ({ ok: response.ok, json: await response.json() })) };
  entries.set(key, entry);
  void entry.request.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
}

export async function takeWorksEntry(url: string, userId: string, signal: AbortSignal, force = false) {
  const key = entryKey(url, userId);
  const entry = entries.get(key);
  if (!force && entry && Date.now() - entry.at < 30000) {
    try {
      const result = await entry.request;
      if (result.ok && !signal.aborted) return result;
    } catch { /* A failed idle prefetch must not prevent a foreground retry. */ }
  }
  if (signal.aborted) throw new DOMException("Asset request superseded", "AbortError");
  const response = await fetch(url, { cache: "no-store" });
  return { ok: response.ok, json: await response.json() };
}

if (typeof window !== "undefined") window.addEventListener("auth:logout", clearWorksEntry);
