import type { UploadKind } from "@/lib/upload-validation";

export type CanvasMediaProbe = {
  kind: UploadKind;
  detectedMime?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameCount?: number;
  trackCount?: number;
  decodedBytes?: number;
};

export type CanvasMediaSecurityErrorCode =
  | "MEDIA_DIMENSIONS_EXCEEDED"
  | "MEDIA_PIXEL_COUNT_EXCEEDED"
  | "MEDIA_DURATION_EXCEEDED"
  | "MEDIA_FRAME_COUNT_EXCEEDED"
  | "MEDIA_TRACK_COUNT_EXCEEDED"
  | "MEDIA_DECODED_BYTES_EXCEEDED"
  | "MEDIA_COMPRESSION_RATIO_EXCEEDED";

const MAX_IMAGE_DIMENSION = 20_000;
const MAX_VIDEO_DIMENSION = 8_192;
const MAX_PIXELS = 80_000_000;
const MAX_DURATION_SECONDS = 7_200;
const MAX_FRAMES = 1_000_000;
const MAX_TRACKS = 16;
const MAX_DECODED_BYTES = 1_024 * 1_024 * 1_024;
const MAX_COMPRESSION_RATIO = 200;

export function validateCanvasMediaProbe(
  probe: CanvasMediaProbe,
  compressedBytes: number,
): CanvasMediaSecurityErrorCode[] {
  const errors: CanvasMediaSecurityErrorCode[] = [];
  const width = Number(probe.width || 0);
  const height = Number(probe.height || 0);
  if (width > 0 && height > 0) {
    const maxDimension = probe.kind === "image" ? MAX_IMAGE_DIMENSION : MAX_VIDEO_DIMENSION;
    if (width > maxDimension || height > maxDimension) errors.push("MEDIA_DIMENSIONS_EXCEEDED");
    if (width * height > MAX_PIXELS) errors.push("MEDIA_PIXEL_COUNT_EXCEEDED");
  }
  if (Number(probe.durationSeconds || 0) > MAX_DURATION_SECONDS) errors.push("MEDIA_DURATION_EXCEEDED");
  if (Number(probe.frameCount || 0) > MAX_FRAMES) errors.push("MEDIA_FRAME_COUNT_EXCEEDED");
  if (Number(probe.trackCount || 0) > MAX_TRACKS) errors.push("MEDIA_TRACK_COUNT_EXCEEDED");
  if (Number(probe.decodedBytes || 0) > MAX_DECODED_BYTES) errors.push("MEDIA_DECODED_BYTES_EXCEEDED");
  if (compressedBytes > 0 && Number(probe.decodedBytes || 0) / compressedBytes > MAX_COMPRESSION_RATIO) {
    errors.push("MEDIA_COMPRESSION_RATIO_EXCEEDED");
  }
  return errors;
}
