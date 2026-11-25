import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
let previous: Promise<unknown> = Promise.resolve();
/** Only sanitized local paths enter here. Bound ffmpeg CPU independently of image resizing. */
export function createCanvasVideoThumbnail(source: string, width: number): Promise<Buffer> {
  const task = previous.catch(() => undefined).then(async () => {
    const { stdout } = await run("ffmpeg", [
      "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-ss", "0.1", "-i", source,
      "-frames:v", "1", "-vf", `scale=${Math.min(width, 1600)}:-2:force_original_aspect_ratio=decrease`,
      "-threads", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ], { encoding: "buffer", timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return sharp(stdout).webp({ quality: 82, effort: 3 }).toBuffer();
  });
  previous = task;
  return task;
}
