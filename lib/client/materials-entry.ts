"use client";
import { fetchJsonOnce, type InFlightJsonResponse } from "./inflight-json";
import { isVideoMediaUrl } from "@/lib/media-url";
import { materialCardImageCandidates, materialCardVideoPosterCandidates, type MaterialCardPreviewSource } from "@/lib/material-card-preview";
import { readSavedMaterialStatus } from "@/lib/material-status";

const entries = new Map<string, { at: number; request: Promise<InFlightJsonResponse<unknown>> }>();
export function warmMaterialsEntry(userId: string) {
  if (!userId || typeof window === "undefined") return;
  const status = readSavedMaterialStatus();
  const url = `/api/material-assets?view=cards&page=1&pageSize=24&status=${encodeURIComponent(status)}`;
  const key = `${userId}:${url}`;
  const previous = entries.get(key);
  if (previous && Date.now() - previous.at < 30000) return;
  const request = fetchJsonOnce(url, userId);
  entries.set(key, { at: Date.now(), request });
  if (entries.size > 4) entries.delete(entries.keys().next().value!);
  void request.then(result => {
    if (!result.ok) { entries.delete(key); return; }
    const items = (result.json as { items?: MaterialCardPreviewSource[] })?.items || [];
    // Warm only the first visible row through the browser's ordinary image cache.
    for (const item of items.slice(0, 6)) {
      const video = item.mimeType?.startsWith("video/") || isVideoMediaUrl(item.imageUrl);
      const src = (video ? materialCardVideoPosterCandidates(item) : materialCardImageCandidates(item))[0];
      if (src && !/\.(mp4|webm|mov)(?:[?#]|$)/i.test(src)) { const image = new Image(); image.decoding = "async"; image.src = src; }
    }
  }).catch(() => entries.delete(key));
}

export function takeMaterialsEntry(url: string, userId: string) {
  const key = `${userId}:${url}`;
  const entry = entries.get(key);
  entries.delete(key);
  return entry && Date.now() - entry.at < 30000 ? entry.request : fetchJsonOnce(url, userId);
}
