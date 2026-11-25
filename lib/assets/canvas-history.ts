import type { GoogleGrounding } from "@/lib/google-image-settings";
import { isAudioMediaUrl, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";

export type CanvasHistoryKind = "image" | "video" | "audio";
export type CanvasHistoryAsset = {
  id: number;
  canvasId: number | null;
  type: string;
  createdAt: string;
  localPath: string;
  displayKind: CanvasHistoryKind;
  thumbUrl: string | null;
  posterUrl: string | null;
  previewUrl: string | null;
};
export type CanvasHistoryReference = { url: string; kind: CanvasHistoryKind; role?: string; name?: string };
export type CanvasHistoryDetail = CanvasHistoryAsset & {
  seedream55Output?: unknown;
  prompt: string;
  model: string | null;
  gptImage25Mode?: "flare" | "sunburst";
  creator: string | null;
  params: Record<string, string | number | boolean>;
  references: CanvasHistoryReference[];
  googleGrounding?: GoogleGrounding;
};
export type CanvasHistoryPage = { items: CanvasHistoryAsset[]; nextCursor: string | null; hasMore: boolean };
export type CanvasHistoryCounts = Record<CanvasHistoryKind, number>;

export function canvasHistoryMediaKind(url: string): CanvasHistoryKind {
  return isAudioMediaUrl(url) ? "audio" : isVideoMediaUrl(url) ? "video" : "image";
}

export function canvasHistoryReferences(params: Record<string, any>): CanvasHistoryReference[] {
  const result: CanvasHistoryReference[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, role?: string, kind?: string, name?: string) => {
    if (typeof value !== "string") return;
    const url = normalizeMediaUrl(value);
    if (!url || seen.has(url) || !/^(\/|https?:\/\/)/i.test(url)) return;
    seen.add(url);
    result.push({ url, role, name, kind: kind === "image" || kind === "video" || kind === "audio" ? kind : canvasHistoryMediaKind(url) });
  };
  for (const item of Array.isArray(params.inputMedia) ? params.inputMedia : []) if (item) add(item.localPreviewUrl || item.url, item.role, item.kind, item.name);
  for (const item of Array.isArray(params.references) ? params.references : []) {
    if (typeof item === "string") add(item);
    else if (item) add(item.url || item.audioUrl || item.audio_url || item.imageUrl || item.path, item.role, item.kind, item.name);
  }
  for (const key of ["imagePaths", "inputImages", "sourceImages", "image_urls", "mediaPaths", "sourceMediaPaths"]) {
    if (Array.isArray(params[key])) for (const value of params[key]) add(value);
  }
  for (const key of ["imagePath", "mediaPath", "inputUrl", "image_url", "facePath", "targetPath", "sourcePath", "firstFramePath", "endFramePath"]) add(params[key]);
  return result;
}

export type CanvasHistoryRow = { key: string; date?: string; items: CanvasHistoryAsset[] };

export function buildCanvasHistoryRows(items: CanvasHistoryAsset[], columns: number): CanvasHistoryRow[] {
  const rows: CanvasHistoryRow[] = [];
  let date = "";
  let row: CanvasHistoryRow | undefined;
  for (const item of items) {
    const time = new Date(item.createdAt);
    const day = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")}`;
    if (date !== day || !row || row.items.length >= Math.max(1, columns)) {
      row = { key: String(item.id), ...(date !== day ? { date: day } : {}), items: [] };
      rows.push(row);
    }
    row.items.push(item);
    date = day;
  }
  return rows;
}
