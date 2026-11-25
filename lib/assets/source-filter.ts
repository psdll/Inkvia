import { getImageBatchModeLabel, isGroupedImageBatchMode } from "@/lib/image-batch/contracts";

export const TOOL_CANVAS_ASSET_SOURCES = ["tool", "canvas"] as const;
export const CREATION_ASSET_SOURCES = ["tool", "canvas", "batch", "agent"] as const;

export const ASSET_BATCH_MODES = ["style_replication", "multi_prompt", "live_video"] as const;
export type AssetBatchMode = (typeof ASSET_BATCH_MODES)[number];
export type AssetSourceFilterValue =
  | "creation"
  | "tool"
  | "canvas"
  | "agent"
  | "batch"
  | `batch:${AssetBatchMode}`;

type AssetSourceParams = Record<string, any> | null | undefined;
const LIVE_VIDEO_BATCH_MODE = "live_video";
const LIVE_VIDEO_BATCH_MODE_LABEL = "批量生成视频用于 Live";

function batchModeFromParams(params: AssetSourceParams) {
  return params?.batch?.mode ?? params?.batchMode;
}

export function attachAssetBatchMode(params: AssetSourceParams, mode: unknown) {
  if (!isGroupedImageBatchMode(mode) && mode !== LIVE_VIDEO_BATCH_MODE) return params || null;
  const current = params || {};
  const batch = current.batch && typeof current.batch === "object" && !Array.isArray(current.batch)
    ? current.batch
    : {};
  return { ...current, batch: { ...batch, mode } };
}

export function resolveAssetSource(source: string | null | undefined, params?: AssetSourceParams) {
  return batchModeFromParams(params) === LIVE_VIDEO_BATCH_MODE ? "batch" : String(source || "").trim();
}

export function isAssetBatchMode(value: unknown): value is AssetBatchMode {
  return ASSET_BATCH_MODES.includes(String(value || "") as AssetBatchMode);
}

export function splitAssetSourceFilter(value: AssetSourceFilterValue) {
  if (!value.startsWith("batch:")) return { source: value, batchMode: null } as const;
  const batchMode = value.slice("batch:".length);
  return {
    source: "batch" as const,
    batchMode: isAssetBatchMode(batchMode) ? batchMode : null,
  };
}

export function applyAssetSourceFilterSearchParams(
  params: URLSearchParams,
  value: AssetSourceFilterValue,
) {
  const { source, batchMode } = splitAssetSourceFilter(value);
  params.set("source", source);
  if (batchMode) params.set("batchMode", batchMode);
  else params.delete("batchMode");
}

export function buildAssetSourceWhere(
  source: string,
  batchMode?: AssetBatchMode | null,
): Record<string, unknown> | null {
  if (source === "batch") {
    if (batchMode === "live_video") return { liveVideoBatchOutput: { isNot: null } };
    if (batchMode === "style_replication" || batchMode === "multi_prompt") {
      return { batchOutput: { is: { batch: { mode: batchMode } } } };
    }
    return {
      OR: [
        { source: "batch" },
        { liveVideoBatchOutput: { isNot: null } },
      ],
    };
  }
  if (source === "creation") {
    return { source: { in: [...CREATION_ASSET_SOURCES] } };
  }
  if (source === "tool_canvas") {
    return {
      AND: [
        { source: { in: [...TOOL_CANVAS_ASSET_SOURCES] } },
        { liveVideoBatchOutput: { is: null } },
      ],
    };
  }
  if (source === "tool") {
    return {
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    };
  }
  if (source && source !== "all") return { source };
  return null;
}

export function getAssetSourceLabel(source: string | null | undefined, params?: AssetSourceParams) {
  const normalized = resolveAssetSource(source, params);
  if (normalized === "canvas") return "画布";
  if (normalized === "tool") return "创作";
  if (normalized === "batch") {
    const mode = batchModeFromParams(params);
    const modeLabel = mode === LIVE_VIDEO_BATCH_MODE
      ? LIVE_VIDEO_BATCH_MODE_LABEL
      : getImageBatchModeLabel(mode);
    return modeLabel ? `批量 · ${modeLabel}` : "批量";
  }
  if (normalized === "agent") return "Agent";
  if (normalized === "import") return "导入";
  return normalized || "其他";
}
