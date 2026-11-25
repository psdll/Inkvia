import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import type { SeedanceMediaKind, SeedanceMediaProbe } from "@/lib/seedance-media-policy";
import { resolvePublicPath } from "@/lib/public-path";

export type MediaProbeErrorCode =
  | "MEDIA_PROBE_PATH_INVALID"
  | "MEDIA_PROBE_INVALID"
  | "MEDIA_PROBE_UNAVAILABLE";

export class MediaProbeError extends Error {
  readonly code: MediaProbeErrorCode;

  constructor(code: MediaProbeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaProbeError";
    this.code = code;
  }
}

type FfprobeOptions = {
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
};

export type FfprobeRunner = (
  executable: string,
  args: string[],
  options: FfprobeOptions,
) => Promise<{ stdout: string }>;

type ProbeInput = {
  kind: SeedanceMediaKind;
  fileName: string;
  declaredMime: string;
};

type LocalProbeInput = ProbeInput & {
  localPath: string;
};

type BufferProbeInput = ProbeInput & {
  buffer: Buffer;
};

const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  bmp: "image/bmp",
  heif: "image/heif",
};

const FFPROBE_TIMEOUT_MS = 25_000;
const FFPROBE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const FFPROBE_CONCURRENCY = 2;

let activeFfprobes = 0;
const ffprobeWaiters: Array<() => void> = [];

async function withFfprobeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeFfprobes >= FFPROBE_CONCURRENCY) {
    await new Promise<void>((resolve) => ffprobeWaiters.push(resolve));
  }
  activeFfprobes += 1;
  try {
    return await task();
  } finally {
    activeFfprobes -= 1;
    ffprobeWaiters.shift()?.();
  }
}

const defaultFfprobeRunner: FfprobeRunner = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(executable, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout) });
    });
  });

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function parseFrameRate(value: unknown): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (!text.includes("/")) return finiteNumber(text);
  const [numerator, denominator] = text.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function normalizeVideoCodec(codec: unknown): string | undefined {
  const value = String(codec ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (["hevc", "hev1", "hvc1", "h.265"].includes(value)) return "h265";
  if (["avc", "avc1", "h.264"].includes(value)) return "h264";
  return value;
}

function inferContainer(input: {
  kind: SeedanceMediaKind;
  fileName: string;
  declaredMime: string;
  formatName: string;
}): string {
  const extension = path.extname(input.fileName).slice(1).toLowerCase();
  if (["mp4", "mov", "mp3", "wav"].includes(extension)) return extension;
  if (input.declaredMime === "video/quicktime") return "mov";
  if (input.declaredMime === "video/mp4") return "mp4";
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(input.declaredMime)) {
    return "wav";
  }
  if (["audio/mpeg", "audio/mp3"].includes(input.declaredMime)) return "mp3";
  if (input.formatName.split(",").includes("wav")) return "wav";
  if (input.formatName.split(",").includes("mp3")) return "mp3";
  if (input.formatName.split(",").includes("mp4")) return "mp4";
  if (input.formatName.split(",").includes("mov")) return "mov";
  return input.formatName.split(",")[0] ?? "unknown";
}

function detectedMime(kind: SeedanceMediaKind, container: string): string {
  if (kind === "video") return container === "mov" ? "video/quicktime" : `video/${container}`;
  if (kind === "audio") return container === "wav" ? "audio/wav" : "audio/mpeg";
  return "application/octet-stream";
}

export function parseFfprobeJson(input: ProbeInput & { stdout: string }): SeedanceMediaProbe {
  let parsed: any;
  try {
    parsed = JSON.parse(input.stdout);
  } catch (error) {
    throw new MediaProbeError("MEDIA_PROBE_INVALID", "媒体探测结果无效。", { cause: error });
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const videoStream = streams.find((stream: any) => stream?.codec_type === "video");
  const audioStreams = streams.filter((stream: any) => stream?.codec_type === "audio");
  const formatName = String(parsed?.format?.format_name ?? "").trim().toLowerCase();
  const container = inferContainer({ ...input, formatName });
  const durationSeconds =
    finiteNumber(parsed?.format?.duration)
    ?? finiteNumber(videoStream?.duration)
    ?? finiteNumber(audioStreams[0]?.duration);
  const frameRate = parseFrameRate(videoStream?.avg_frame_rate);
  const explicitFrameCount = finiteNumber(videoStream?.nb_frames);
  const estimatedFrameCount =
    explicitFrameCount === undefined && durationSeconds !== undefined && frameRate !== undefined
      ? Math.ceil(durationSeconds * frameRate)
      : undefined;

  return {
    version: 1,
    kind: input.kind,
    detectedMime: detectedMime(input.kind, container),
    container,
    ...(finiteNumber(videoStream?.width) !== undefined
      ? { width: finiteNumber(videoStream.width) }
      : {}),
    ...(finiteNumber(videoStream?.height) !== undefined
      ? { height: finiteNumber(videoStream.height) }
      : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(normalizeVideoCodec(videoStream?.codec_name)
      ? { videoCodec: normalizeVideoCodec(videoStream.codec_name) }
      : {}),
    audioCodecs: audioStreams
      .map((stream: any) => String(stream?.codec_name ?? "").trim().toLowerCase())
      .filter(Boolean),
    ...(explicitFrameCount !== undefined || estimatedFrameCount !== undefined
      ? { frameCount: explicitFrameCount ?? estimatedFrameCount }
      : {}),
  };
}

async function probeImage(input: Buffer | string): Promise<SeedanceMediaProbe> {
  try {
    const metadata = await sharp(input, {
      animated: true,
      limitInputPixels: 80_000_000,
    }).metadata();
    const format = String(metadata.format ?? "unknown").toLowerCase();
    return {
      version: 1,
      kind: "image",
      detectedMime: IMAGE_MIME_BY_FORMAT[format] ?? `image/${format}`,
      ...(finiteNumber(metadata.width) !== undefined ? { width: metadata.width } : {}),
      ...(finiteNumber(metadata.height) !== undefined ? { height: metadata.height } : {}),
      frameCount: Math.max(1, Math.floor(finiteNumber(metadata.pages) ?? 1)),
    };
  } catch (error) {
    throw new MediaProbeError("MEDIA_PROBE_INVALID", "无法读取图片内容，请更换有效的图片文件。", {
      cause: error,
    });
  }
}

async function runFfprobe(
  input: LocalProbeInput,
  ffprobeRunner: FfprobeRunner,
): Promise<SeedanceMediaProbe> {
  let stdout: string;
  try {
    const result = await withFfprobeSlot(() =>
      ffprobeRunner(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration,format_name:stream=codec_type,codec_name,width,height,duration,nb_frames,avg_frame_rate",
          "-of",
          "json",
          input.localPath,
        ],
        {
          timeout: FFPROBE_TIMEOUT_MS,
          maxBuffer: FFPROBE_MAX_BUFFER_BYTES,
          windowsHide: true,
        },
      ),
    );
    stdout = result.stdout;
  } catch (error) {
    throw new MediaProbeError(
      "MEDIA_PROBE_UNAVAILABLE",
      "服务器暂时无法检测视频或音频，请稍后重试。",
      { cause: error },
    );
  }
  return parseFfprobeJson({ ...input, stdout });
}

export async function probeLocalMedia(
  input: LocalProbeInput,
  dependencies: { ffprobeRunner?: FfprobeRunner } = {},
): Promise<SeedanceMediaProbe> {
  if (input.kind === "image") return probeImage(input.localPath);
  return runFfprobe(input, dependencies.ffprobeRunner ?? defaultFfprobeRunner);
}

export async function probeMediaBuffer(
  input: BufferProbeInput,
  dependencies: { ffprobeRunner?: FfprobeRunner } = {},
): Promise<SeedanceMediaProbe> {
  if (input.kind === "image") return probeImage(input.buffer);

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-media-probe-"));
  const extension = path.extname(input.fileName).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
  const temporaryPath = path.join(temporaryDirectory, `input${extension}`);
  try {
    await fs.writeFile(temporaryPath, input.buffer);
    return await runFfprobe(
      { ...input, localPath: temporaryPath },
      dependencies.ffprobeRunner ?? defaultFfprobeRunner,
    );
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function resolveLocalUploadPath(localPath: string, uploadsRoot?: string): string {
  if (!localPath.startsWith("/uploads/") || localPath.includes("\0")) {
    throw new MediaProbeError("MEDIA_PROBE_PATH_INVALID", "只允许检测本地上传素材。" );
  }
  const configuredRoot = String(process.env.UPLOADS_DIR || "").trim();
  const root = path.resolve(uploadsRoot || configuredRoot || resolvePublicPath("uploads"));
  const relative = localPath.slice("/uploads/".length).replace(/\//g, path.sep);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new MediaProbeError("MEDIA_PROBE_PATH_INVALID", "素材路径超出上传目录。" );
  }
  return absolute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readStoredMediaProbe(metadata: unknown): SeedanceMediaProbe | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.mediaProbe)) return undefined;
  const probe = metadata.mediaProbe;
  if (
    probe.version !== 1
    || !["image", "video", "audio"].includes(String(probe.kind))
    || typeof probe.detectedMime !== "string"
  ) {
    return undefined;
  }
  return probe as SeedanceMediaProbe;
}

export function mergeStoredMediaProbe(
  metadata: unknown,
  probe: SeedanceMediaProbe,
): Record<string, unknown> {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    mediaProbe: probe,
  };
}
