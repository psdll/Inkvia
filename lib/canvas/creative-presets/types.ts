import { z } from "zod";

// Preset selections were retired; keys saved by older canvases are dropped, not rejected.
export const creativeSelectionSchema = z.object({}).strip();
export type CreativeSelection = z.infer<typeof creativeSelectionSchema>;
export const imageAngleSchema = z.object({
  azimuth: z.number().finite().int().min(0).max(359),
  elevation: z.number().finite().int().min(-90).max(90),
  zoom: z.number().finite().min(0).max(10),
  lens: z.enum(["standard", "fisheye"]).optional(),
}).strict();
export type ImageAngle = z.infer<typeof imageAngleSchema>;
export type CanvasCreativeSettings = { creativePresets?: CreativeSelection; imageAngle?: ImageAngle };
export function hasCreativeSettings(settings: CanvasCreativeSettings) {
  return Boolean(settings.imageAngle);
}
