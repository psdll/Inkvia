import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { createInterface } from "node:readline";

const execFileAsync = promisify(execFile);
const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  avif: "image/avif",
  heif: "image/heif",
};

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function frameRate(value) {
  const [numerator, denominator] = String(value || "").split("/").map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : 0;
}

async function probe(filePath, kind) {
if (!filePath || !["image", "video", "audio"].includes(kind)) throw new Error("invalid media probe arguments");
if (kind === "image") {
  const metadata = await sharp(filePath, { animated: true, limitInputPixels: 80_000_000 }).metadata();
  const width = finite(metadata.width);
  const height = finite(metadata.height);
  const pages = Math.max(1, Math.floor(finite(metadata.pages) || 1));
  const channels = Math.max(1, Math.floor(finite(metadata.channels) || 4));
  return {
    kind,
    detectedMime: MIME_BY_FORMAT[metadata.format] || `image/${metadata.format || "unknown"}`,
    width,
    height,
    frameCount: pages,
    trackCount: 1,
    decodedBytes: width && height ? width * height * pages * channels : undefined,
  };
} else {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,duration,nb_frames,avg_frame_rate",
    "-of", "json",
    filePath,
  ], { timeout: 25_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const result = JSON.parse(stdout);
  const streams = Array.isArray(result.streams) ? result.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const durationSeconds = finite(result.format?.duration) ?? finite(video?.duration);
  const explicitFrames = finite(video?.nb_frames);
  const estimatedFrames = durationSeconds && video ? Math.ceil(durationSeconds * frameRate(video.avg_frame_rate)) : undefined;
  return {
    kind,
    detectedMime: kind === "audio" ? "audio/processed" : "video/processed",
    width: finite(video?.width),
    height: finite(video?.height),
    durationSeconds,
    frameCount: explicitFrames ?? estimatedFrames,
    trackCount: streams.length,
  };
}
}

if (process.argv[2] === "--worker") {
  // One request at a time per isolated worker; the parent bounds concurrency/lifetime.
  sharp.cache(false);
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const { filePath, kind } = JSON.parse(line);
      process.stdout.write(JSON.stringify({ result: await probe(filePath, kind) }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message || "media probe failed" }) + "\n");
    }
  }
} else {
  process.stdout.write(JSON.stringify(await probe(...process.argv.slice(2))));
}
