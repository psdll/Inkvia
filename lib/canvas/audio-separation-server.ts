import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { resolveLocalUploadDirectory } from "@/lib/storage";

export const MAX_SEPARATION_AUDIO_BYTES = 32 * 1024 * 1024;
const activeUsers = new Set<number>();

export async function readSeparationAudio(request: Request) {
  if (!request.body) throw new Error("请选择有效的音轨");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SEPARATION_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("音轨文件不能超过 32 MB");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("请选择有效的音轨");
  return Buffer.concat(chunks);
}

export async function extractCanvasAudioStem(request: Request, userId: number, stem: "vocals" | "background") {
  if (activeUsers.has(userId)) throw new Error("已有音频正在提取，请等待完成后重试");
  if (activeUsers.size >= 2) throw new Error("音频处理繁忙，请稍后重试");
  activeUsers.add(userId);
  let directory: string | undefined;
  try {
    const root = path.resolve(process.cwd(), ".runtime-local/audio-separation");
    const python = process.env.CANVAS_AUDIO_SEPARATOR_PYTHON || path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    try { await fs.access(python); }
    catch { throw new Error("人声分离引擎尚未安装，请先运行音频分离安装脚本"); }
    const audio = await readSeparationAudio(request);
    const temporaryRoot = resolveLocalUploadDirectory("canvas_audio_processing");
    await fs.mkdir(temporaryRoot, { recursive: true });
    directory = await fs.mkdtemp(path.join(temporaryRoot, ".separate-"));
    const input = path.join(directory, "input.m4a");
    const output = path.join(directory, "output.wav");
    await fs.writeFile(input, audio);
    await new Promise<void>((resolve, reject) => {
      execFile(python, [path.join(process.cwd(), "scripts/canvas-audio-separator/separate.py"), "--input", input, "--output", output, "--stem", stem], {
        timeout: 15 * 60_000, maxBuffer: 1024 * 1024, windowsHide: true,
        env: { ...process.env, TORCH_HOME: process.env.CANVAS_AUDIO_SEPARATOR_MODELS || path.join(root, "models") },
      }, error => error ? reject(new Error(error.killed ? "音频提取超时，请使用较短的视频重试" : "音源分离失败，请确认模型已安装且视频不超过 5 分钟")) : resolve());
    });
    return await fs.readFile(output);
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    activeUsers.delete(userId);
  }
}
