import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const run = async (command, args) =>
  execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });

const verify = async () => {
  const work = await mkdtemp(path.join(tmpdir(), "inkvia-media-probe-"));
  try {
    const image = path.join(work, "probe.png");
    const video = path.join(work, "probe.mp4");

    await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: { r: 16, g: 24, b: 40 },
      },
    })
      .png()
      .toFile(image);
    const imageMetadata = await sharp(image).metadata();
    if (imageMetadata.width !== 320 || imageMetadata.height !== 320) {
      throw new Error("sharp image round trip returned unexpected dimensions");
    }

    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=640x480:d=1:r=30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      video,
    ]);
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      video,
    ]);
    const metadata = JSON.parse(stdout);
    const stream = metadata.streams?.find((item) => item.codec_type === "video");
    if (stream?.codec_name !== "h264" || stream.width !== 640 || stream.height !== 480) {
      throw new Error("ffprobe video round trip returned unexpected metadata");
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

try {
  await verify();
  process.stdout.write("Media probe runtime verified: sharp, ffmpeg, ffprobe\n");
} catch (error) {
  process.stderr.write(
    `Media probe runtime verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
