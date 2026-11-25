import { MEDIAKIT_MAX_REGIONS, MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
import { z } from "zod";
import type { CanvasNode } from "./document";

export const subtitleRegionSchema = z.object({
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
}).refine(r => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, "选区超出视频范围");
export const subtitleRemovalSchema = z.union([
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("region"), regions: z.array(subtitleRegionSchema).min(1).max(MEDIAKIT_MAX_REGIONS) }),
  z.object({ mode: z.literal("region"), region: subtitleRegionSchema }),
]);
export type SubtitleRemovalOptions = z.infer<typeof subtitleRemovalSchema>;
export const SUBTITLE_REMOVAL_MODEL = MEDIAKIT_SUBTITLE_MODEL;

export function createSubtitleRemovalNode(id: string, title: string, sourceUrl: string, size: { width: number; height: number }, options: SubtitleRemovalOptions): CanvasNode {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 2 || size.height < 2) throw new Error("请等待视频加载完成");
  return { id, type: "videoTask", position: { x: 0, y: 0 }, data: {
    kind: "videoTask", title, model: SUBTITLE_REMOVAL_MODEL, prompt: "", mediaPaths: [sourceUrl],
    ratio: `${size.width}:${size.height}`, status: "running", startedAt: Date.now(),
    subtitleRemoval: subtitleRemovalSchema.parse(options),
  } };
}

export function buildSubtitleRemovalRequest(videoUrl: string, options: SubtitleRemovalOptions) {
  const parsed = subtitleRemovalSchema.parse(options);
  const regions = parsed.mode === "region" ? ("regions" in parsed ? parsed.regions : [parsed.region]) : [];
  return {
    video_url: videoUrl, model_version: "v5", output_encode_mode: "Quality",
    mode: parsed.mode === "auto" ? "Subtitle" : "Text",
    ...(regions.length ? { erase_ratio_location: regions.map(region => ({
      top_left_x: region.x, top_left_y: region.y,
      bottom_right_x: Math.min(1, region.x + region.width), bottom_right_y: Math.min(1, region.y + region.height),
    })) } : {}),
  };
}
