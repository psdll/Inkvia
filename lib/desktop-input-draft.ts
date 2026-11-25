"use client";

import {
  buildToolMediaDraftRequestUrl,
  getToolMediaDraftItems,
  reconcileToolMediaDraftItems,
  type ToolMediaClientItem,
  type ToolMediaDraftServerItem,
} from "@/lib/tool-media/client-draft";

export const INTERRUPTED_UPLOAD_NOTICE = "上传已中断，请重新上传";

function ownerPrefix(ownerId: string) {
  return `inkvia:desktop-draft:${encodeURIComponent(ownerId)}:`;
}

export function readDesktopInputDraft<T>(desktopMode: boolean, surface: string, ownerId: string): T | null {
  if (!desktopMode || !ownerId) return null;
  try {
    const value = sessionStorage.getItem(ownerPrefix(ownerId) + surface);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

export function writeDesktopInputDraft<T>(desktopMode: boolean, surface: string, ownerId: string, draft: T) {
  if (!desktopMode || !ownerId) return;
  try {
    sessionStorage.setItem(ownerPrefix(ownerId) + surface, JSON.stringify(draft));
  } catch {}
}

export function clearDesktopInputDrafts(ownerId: string) {
  if (!ownerId) return;
  try {
    const prefix = ownerPrefix(ownerId);
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {}
}

export function desktopDraftUploadWasPending(items: ToolMediaClientItem[]) {
  return items.some((item) => item.file || item.uploadState === "queued"
    || item.uploadState === "uploading" || item.uploadState === "verifying"
    || item.uploadState === "failed");
}

export function desktopDraftMediaItems<T extends ToolMediaClientItem>(items: T[]) {
  return items.flatMap((item) => {
    const url = String(item.url || "").trim();
    if (url.startsWith("blob:") || (!item.mediaId && url.startsWith("data:"))) return [];
    return [{ ...item, url: url.startsWith("data:") ? null : url }];
  });
}

export async function recoverDesktopDraftMedia<T extends ToolMediaClientItem>(
  draftSessionId: string,
  items: T[],
  fetcher = fetch,
): Promise<T[]> {
  const saved = getToolMediaDraftItems(items);
  if (!saved.length) return items;
  try {
    const draft = { draftSessionId, items: saved };
    const response = await fetcher(buildToolMediaDraftRequestUrl(draft), { cache: "no-store" });
    if (!response.ok) return items;
    const result: { items: ToolMediaDraftServerItem[] } = await response.json();
    const ready = new Map(reconcileToolMediaDraftItems(draft, result.items)
      .map((item) => [item.mediaId, item]));
    return items.flatMap((item) => {
      if (!item.mediaId) return [item];
      const resolved = ready.get(item.mediaId);
      if (!resolved) return [];
      const { url, kind, probe, byteSize } = resolved;
      return [{ ...item, url, kind, probe, byteSize }];
    });
  } catch {
    return items;
  }
}
