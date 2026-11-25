import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { llmVideoBlock, prepareLlmVideo } from "@/lib/media-delivery/llm";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import { safeFetch } from "@/lib/ssrf-guard";
import { resolveLlmRoute } from "@/lib/llm-routing/resolver";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";
import { getLlmModelVisibility, isLlmModelVisible } from "@/lib/llm-routing/visibility";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import type { LlmChatMessage, ResolvedLlmRoute } from "@/lib/llm-routing/types";
import { getLlmThinkingCapabilities, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";
import {
  BREAKDOWN_MAX_DURATION_SECONDS,
  BREAKDOWN_SCENE_THRESHOLDS,
  buildShotsFromCuts,
  formatBreakdownTime,
  parseSceneCutTimes,
  type DetectedShot,
} from "./scenes";
import {
  BREAKDOWN_SYSTEM_PROMPT,
  buildCastPrompt,
  buildOverviewPartPrompt,
  buildOverviewPrompt,
  readCastResult,
  type BreakdownCast,
  type BreakdownSpeech,
  buildSegmentsPrompt,
  buildShotsPrompt,
  mergeSegmentResults,
  mergeShotResults,
  normalizeSegmentPlan,
  parseBreakdownJson,
  readOverviewResult,
} from "./prompts";
import { isVolcAsrAvailable, transcribeAudio, VOLC_ASR_MAX_BYTES } from "@/lib/volcengine-asr";
import {
  type BreakdownAudio,
  breakdownOverviewSchema,
  breakdownShotSchema,
  type BreakdownEvent,
  type BreakdownOverview,
  type BreakdownSegment,
  type BreakdownShot,
  type BreakdownVideo,
} from "./types";

const run = promisify(execFile);
const FRAME_FOLDER = "canvas_breakdowns";
/**
 * Deep thinking makes each call slow in proportion to what it must write, so work
 * is cut into small calls that run side by side: total time ≈ the slowest call.
 */
const SHOT_BATCH_SIZE = 2;
const SHOT_CONCURRENCY = 10;
const SEGMENT_BATCH_SIZE = 1;
const SEGMENT_CONCURRENCY = 4;
const OVERVIEW_FRAME_LIMIT = 24;
const LLM_TIMEOUT_MS = 300_000;
const MAX_REMOTE_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
/** Above this, each shot batch is analysed on its own time range instead of the whole film. */
const CLIP_ANALYSIS_SECONDS = 90;
const STAGE_ATTEMPTS = 3;
const CAST_FRAME_LIMIT = 40;
const ANALYSIS_FOLDER = `${"canvas_breakdowns"}/analysis`;

const activeUsers = new Set<number>();
let activeJobs = 0;

export class ShotBreakdownError extends Error {}

export type ShotBreakdownInput = {
  authUserId: number;
  videoUrl: string;
  providerId: string;
  modelId: string;
  signal?: AbortSignal;
  emit: (event: BreakdownEvent) => void;
};

/** Only plain, non-private files under the uploads root; never `..` or private folders. */
export function resolveBreakdownLocalVideo(url: string) {
  let pathname = url;
  if (/^https?:\/\//i.test(url)) return null;
  try { pathname = decodeURIComponent(new URL(url, "http://local").pathname); } catch { throw new ShotBreakdownError("视频地址无效"); }
  if (!pathname.startsWith("/uploads/")) throw new ShotBreakdownError("只能拉片画布中的视频素材");
  const relative = pathname.slice("/uploads/".length);
  if (!relative || relative.split("/").some(part => part === ".." || part === ".")) throw new ShotBreakdownError("视频地址无效");
  if (isPrivateUploadPath(relative)) throw new ShotBreakdownError("个人素材库中的视频请先放到画布后再拉片");
  const root = resolveUploadsRootDirectory();
  const file = path.resolve(root, relative);
  const inside = path.relative(root, file);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new ShotBreakdownError("视频地址无效");
  return file;
}

async function downloadRemoteVideo(url: string, directory: string, signal?: AbortSignal) {
  const response = await safeFetch(url, { signal: signal ?? AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new ShotBreakdownError("无法下载视频，请稍后重试");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_REMOTE_VIDEO_BYTES) throw new ShotBreakdownError("视频超过 2GB，请先压缩或剪短");
  const file = path.join(directory, "source.mp4");
  const reader = response.body.getReader();
  const handle = await fs.open(file, "w");
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_REMOTE_VIDEO_BYTES) throw new ShotBreakdownError("视频超过 2GB，请先压缩或剪短");
      await handle.write(part.value);
    }
  } finally {
    await handle.close();
    await reader.cancel().catch(() => undefined);
  }
  return file;
}

async function probeVideo(file: string): Promise<{ video: BreakdownVideo; codec: string }> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", [
      "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
  } catch {
    throw new ShotBreakdownError("无法读取视频，请确认文件是有效的视频");
  }
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, any>> };
  const stream = info.streams?.find(item => item.codec_type === "video");
  if (!stream) throw new ShotBreakdownError("文件中没有视频画面");
  const duration = Number(info.format?.duration ?? stream.duration);
  if (!(duration > 0)) throw new ShotBreakdownError("无法读取视频时长");
  const [numerator, denominator] = String(stream.avg_frame_rate || stream.r_frame_rate || "0/1").split("/").map(Number);
  const rotated = Math.abs(Number(stream.tags?.rotate ?? stream.side_data_list?.find((item: any) => item.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
  return {
    codec: String(stream.codec_name || ""),
    video: {
      duration,
      width: Number(rotated ? stream.height : stream.width) || undefined,
      height: Number(rotated ? stream.width : stream.height) || undefined,
      fps: denominator ? Math.round(numerator / denominator * 100) / 100 : undefined,
      hasAudio: Boolean(info.streams?.some(item => item.codec_type === "audio")),
    },
  };
}

/**
 * A light 720p H.264 copy for analysis: models fetch it in seconds, every provider
 * decodes it, and scene detection runs several times faster than on a 2K/4K HEVC master.
 */
async function transcodeForAnalysis(file: string, video: BreakdownVideo, output: string, range?: { start: number; end: number }, signal?: AbortSignal) {
  const landscape = (video.width ?? 16) >= (video.height ?? 9);
  const scale = landscape ? "scale=-2:'min(720,ih)'" : "scale='min(720,iw)':-2";
  const seconds = range ? range.end - range.start : video.duration;
  await run("ffmpeg", [
    "-v", "error", "-y",
    ...(range ? ["-ss", range.start.toFixed(3)] : []),
    "-i", file,
    ...(range ? ["-t", seconds.toFixed(3)] : []),
    "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
    ...(video.hasAudio ? ["-c:a", "aac", "-b:a", "64k", "-ac", "1"] : ["-an"]),
    "-movflags", "+faststart", output,
  ], { timeout: Math.max(120_000, seconds * 4000), maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal });
}

async function detectCuts(file: string, threshold: number, signal?: AbortSignal) {
  // Scene scores on a 320px proxy are as reliable as full resolution and far cheaper.
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-threads", "2", "-i", file,
    "-vf", `scale=320:-2,select='gt(scene\\,${threshold})',showinfo`,
    "-an", "-f", "null", "-",
  ], { timeout: 180_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal });
  return parseSceneCutTimes(stderr);
}

async function extractFrame(file: string, time: number, signal?: AbortSignal) {
  const { stdout } = await run("ffmpeg", [
    "-v", "error", "-threads", "1", "-ss", time.toFixed(3), "-i", file,
    "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2",
    "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
  ], { encoding: "buffer", timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, signal });
  if (!stdout.length) throw new ShotBreakdownError("关键帧提取失败");
  return stdout as Buffer;
}

/** Content-addressed, so re-running a breakdown on the same video reuses its stills. */
async function saveFrame(buffer: Buffer) {
  const jpeg = await sharp(buffer).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const hash = crypto.createHash("sha1").update(jpeg).digest("hex");
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join(resolveUploadsRootDirectory(), FRAME_FOLDER, date);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${hash}.jpg`);
  await fs.writeFile(file, jpeg, { flag: "wx" }).catch(error => { if (error?.code !== "EEXIST") throw error; });
  return { url: `/uploads/${FRAME_FOLDER}/${date}/${hash}.jpg`, jpeg };
}

/** One segment of the original, re-encoded to H.264 (≤1080p) so every browser plays it on the canvas. */
async function cutSegmentClip(file: string, video: BreakdownVideo, range: { start: number; end: number }, temp: string, signal?: AbortSignal) {
  const landscape = (video.width ?? 16) >= (video.height ?? 9);
  const scale = landscape ? "scale=-2:'min(1080,ih)'" : "scale='min(1080,iw)':-2";
  const seconds = Math.max(0.2, range.end - range.start);
  const output = path.join(temp, `segment-${crypto.randomUUID()}.mp4`);
  await run("ffmpeg", [
    "-v", "error", "-y", "-ss", range.start.toFixed(3), "-i", file, "-t", seconds.toFixed(3),
    "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    ...(video.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags", "+faststart", output,
  ], { timeout: Math.max(120_000, seconds * 6000), maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal });
  return saveMedia(await fs.readFile(output), "mp4");
}

/** Content-addressed media under the 拉片 uploads folder (immutable cache). */
async function saveMedia(buffer: Buffer, extension: string) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join(resolveUploadsRootDirectory(), FRAME_FOLDER, date);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${hash}.${extension}`), buffer, { flag: "wx" }).catch(error => { if (error?.code !== "EEXIST") throw error; });
  return `/uploads/${FRAME_FOLDER}/${date}/${hash}.${extension}`;
}

const SEPARATOR_ROOT = path.resolve(process.cwd(), ".runtime-local/audio-separation");
const SEPARATOR_MAX_SECONDS = 600;

/**
 * 原片音轨 for reference, then 背景音乐 with voices removed by the local separator (no API
 * cost) so a re-make can reuse the music bed. Each is reported as soon as it exists.
 */
async function extractSoundtrack(file: string, video: BreakdownVideo, temp: string, report: (audio: BreakdownAudio) => void, signal?: AbortSignal) {
  if (!video.hasAudio) return;
  const mp3 = path.join(temp, "soundtrack.mp3");
  const seconds = video.duration;
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-ac", "2", "-ar", "44100", "-b:a", "192k", mp3],
    { timeout: Math.max(120_000, seconds * 2000), maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal });
  const audio: BreakdownAudio = { soundtrack: await saveMedia(await fs.readFile(mp3), "mp3") };
  report({ ...audio });
  const python = process.env.CANVAS_AUDIO_SEPARATOR_PYTHON || path.join(SEPARATOR_ROOT, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (seconds > SEPARATOR_MAX_SECONDS || !await fs.access(python).then(() => true, () => false)) return;
  const wav = path.join(temp, "background.wav");
  const backgroundMp3 = path.join(temp, "background.mp3");
  await run(python, [path.join(process.cwd(), "scripts/canvas-audio-separator/separate.py"), "--input", mp3, "--output", wav, "--stem", "background"], {
    timeout: 15 * 60_000, maxBuffer: 1024 * 1024, windowsHide: true, signal,
    env: { ...process.env, TORCH_HOME: process.env.CANVAS_AUDIO_SEPARATOR_MODELS || path.join(SEPARATOR_ROOT, "models") },
  });
  await run("ffmpeg", ["-v", "error", "-y", "-i", wav, "-b:a", "192k", backgroundMp3], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal });
  audio.background = await saveMedia(await fs.readFile(backgroundMp3), "mp3");
  report({ ...audio });
}

/** Dialogue comes from speech recognition: the vision models only see frames. */
/** An account without the ASR resource stays that way for a while; don't pay the round trip every run. */
const ASR_NOT_GRANTED_NOTE = "火山引擎账号尚未开通「录音文件识别极速版」，本次台词按画面字幕判断";
let asrNotGrantedUntil = 0;

async function recognizeSpeech(file: string, video: BreakdownVideo, temp: string, signal?: AbortSignal): Promise<BreakdownSpeech> {
  if (!video.hasAudio) return { lines: [] };
  if (Date.now() < asrNotGrantedUntil) return { lines: [], note: ASR_NOT_GRANTED_NOTE };
  if (!await isVolcAsrAvailable().catch(() => false)) return { lines: [], note: "未启用语音识别，台词只能按画面字幕判断（管理员在 API 配置中启用「豆包语音识别」后可逐字提取台词）" };
  try {
    const audio = path.join(temp, "speech.mp3");
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio],
      { timeout: Math.max(120_000, video.duration * 1000), maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal });
    const data = await fs.readFile(audio);
    if (data.length > VOLC_ASR_MAX_BYTES) return { lines: [], note: "音轨过大，未做语音识别" };
    // A slow speech service must never hold up the breakdown; subtitles still carry the text.
    const limit = AbortSignal.timeout(Math.min(90_000, 25_000 + video.duration * 500));
    const result = await transcribeAudio({ data, format: "mp3", signal: signal ? AbortSignal.any([signal, limit]) : limit });
    return { lines: result.segments };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/not grant|resource/i.test(message)) {
      asrNotGrantedUntil = Date.now() + 10 * 60_000;
      return { lines: [], note: ASR_NOT_GRANTED_NOTE };
    }
    return { lines: [], note: /timeout|abort/i.test(message) ? "台词识别超时，本次台词按画面字幕判断" : "台词识别暂不可用，本次台词按画面字幕判断" };
  }
}

async function dataUrl(jpeg: Buffer, width: number) {
  const small = await sharp(jpeg).resize({ width, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function resolveBreakdownRoute(providerId: string, modelId: string): Promise<ResolvedLlmRoute> {
  const resolved = await resolveLlmRoute("canvas.chat", { providerId, modelId });
  if (resolved.status !== "ready") throw new ShotBreakdownError(`${modelId} 尚未配置或启用`);
  if (!isLlmModelVisible(await getLlmModelVisibility(), resolved.route.providerId, resolved.route.modelId)) {
    throw new ShotBreakdownError("该模型已隐藏，请重新选择");
  }
  const modalities = getLlmModelModalities(resolved.route.providerId, resolved.route.modelId);
  if (!modalities?.input.includes("video")) {
    throw new ShotBreakdownError(`${modelId} 不支持视频理解，请选择支持视频输入的模型`);
  }
  // Watching a whole video and writing every shot takes longer than ordinary chat.
  return { ...resolved.route, timeoutMs: Math.max(resolved.route.timeoutMs, LLM_TIMEOUT_MS) };
}

type Frame = { shot: DetectedShot; url: string; jpeg: Buffer };

async function frameBlocks(frames: readonly Frame[], width: number) {
  const blocks: unknown[] = [];
  for (const frame of frames) {
    blocks.push({ type: "text", text: `镜头${frame.shot.index} 关键帧（镜头 ${formatBreakdownTime(frame.shot.start)}–${formatBreakdownTime(frame.shot.end)}，取自 ${formatBreakdownTime(frame.shot.keyTime)}）` });
    blocks.push({ type: "image_url", image_url: { url: await dataUrl(frame.jpeg, width) } });
  }
  return blocks;
}

function sampleFrames<T>(items: readonly T[], limit: number) {
  if (items.length <= limit) return [...items];
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * (items.length - 1) / (limit - 1))]);
}

/** Every pass thinks hard; the whole-film pass asks for the deepest level the model offers. */
const THINKING = {
  light: ["low", "none", "adaptive"],
  deepest: ["max", "high", "adaptive"],
  high: ["high", "adaptive"],
} as const satisfies Record<string, readonly LlmThinkingLevel[]>;

function thinking(route: ResolvedLlmRoute, preference: readonly LlmThinkingLevel[]) {
  const supported = getLlmThinkingCapabilities(route).thinkingLevels;
  return preference.find(level => supported.includes(level));
}

async function ask(route: ResolvedLlmRoute, authUserId: number, content: unknown[] | string, tokens: number, level: readonly LlmThinkingLevel[], signal?: AbortSignal) {
  if (signal?.aborted) throw new ShotBreakdownError("拉片已取消");
  const messages: LlmChatMessage[] = [
    { role: "system", content: BREAKDOWN_SYSTEM_PROMPT },
    { role: "user", content: content as LlmChatMessage["content"] },
  ];
  // Some models (GLM) count their thinking against max_tokens: a generous budget keeps
  // the answer from being crowded out, and one retry covers an empty or cut-off reply.
  for (let attempt = 1; ; attempt += 1) {
    const result = await callLlmForScenario(route, messages, {
      billingIdentity: { authUserId },
      outputLimit: { tokens, parameter: "max_tokens" },
      thinkingLevel: thinking(route, level),
      signal,
    });
    try {
      return parseBreakdownJson(result.text);
    } catch (error) {
      if (attempt >= 2 || signal?.aborted) throw error;
    }
  }
}

function stagingErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|超时/i.test(message)) return "视频上传到云存储超时（网络繁忙），请稍后重新拉片";
  return /[\u4e00-\u9fff]/.test(message) ? message : "视频无法提供给分析模型，请稍后重新拉片";
}

/**
 * Use a native video input when available. Keep staging and retries for URL delivery.
 */
async function stageForModel(file: string, staged: string[], route: ResolvedLlmRoute, fps: number, signal?: AbortSignal) {
  if (await getMediaDeliveryMode() === "platform") {
    const source = await prepareLlmVideo(file, route, { fps, signal });
    if (source) return llmVideoBlock(source);
  }
  const name = `${crypto.randomUUID()}${path.extname(file) || ".mp4"}`;
  const directory = path.join(resolveUploadsRootDirectory(), ANALYSIS_FOLDER);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  await fs.copyFile(file, target);
  staged.push(target);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const url = await resolveAssetUrlForExternalApi(`/uploads/${ANALYSIS_FOLDER}/${name}`, "canvas-shot-breakdown");
      return llmVideoBlock({ url, ...(route.providerId === "volcengine" ? { fps } : {}) });
    } catch (error) {
      if (signal?.aborted) throw new ShotBreakdownError("拉片已取消");
      if (error instanceof Error && error.name === "MissingExternalAssetStorageError") throw new ShotBreakdownError(error.message);
      if (attempt >= STAGE_ATTEMPTS) throw new ShotBreakdownError(stagingErrorMessage(error));
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/** Ark samples frames itself; keep roughly 120-360 frames whatever the length. */
function overviewFps(duration: number) {
  if (duration <= 60) return 2;
  if (duration <= 180) return 1;
  return Math.max(0.3, Math.round(240 / duration * 10) / 10);
}

/**
 * The whole 拉片 pipeline. Emits partial results as soon as they exist so the canvas
 * shows timecodes and stills within seconds, then fills in the analysis.
 */
export async function runShotBreakdown(input: ShotBreakdownInput) {
  if (activeUsers.has(input.authUserId)) throw new ShotBreakdownError("已有拉片任务在进行，请等它完成后再试");
  if (activeJobs >= 3) throw new ShotBreakdownError("拉片任务繁忙，请稍后再试");
  activeUsers.add(input.authUserId);
  activeJobs += 1;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-breakdown-"));
  const staged: string[] = [];
  const { emit, signal } = input;
  try {
    const route = await resolveBreakdownRoute(input.providerId, input.modelId);

    emit({ type: "stage", stage: "probe", progress: 0.02, message: "读取视频" });
    const local = resolveBreakdownLocalVideo(input.videoUrl);
    if (local) await fs.access(local).catch(() => { throw new ShotBreakdownError("视频文件不存在或已被删除"); });
    const file = local ?? await downloadRemoteVideo(input.videoUrl, temp, signal);
    const { video, codec } = await probeVideo(file);
    if (video.duration > BREAKDOWN_MAX_DURATION_SECONDS + 0.5) {
      throw new ShotBreakdownError(`视频时长 ${Math.round(video.duration)} 秒，单次拉片最长 ${BREAKDOWN_MAX_DURATION_SECONDS / 60} 分钟，请先用"片段截取"分段`);
    }
    emit({ type: "video", video });
    // Speech recognition runs beside transcoding, cut detection and keyframes.
    const speechTask = recognizeSpeech(file, video, temp, signal);
    // Soundtrack and music bed come out beside the analysis; a failure only loses the audio nodes.
    const soundtrackTask = extractSoundtrack(file, video, temp, audio => emit({ type: "audio", audio }), signal).catch(error => {
      if (signal?.aborted) throw error;
    });
    soundtrackTask.catch(() => undefined);
    let soundtrackSettled = false;
    soundtrackTask.finally(() => { soundtrackSettled = true; }).catch(() => undefined);
    speechTask.catch(() => undefined);

    // Any size, resolution or codec: models and scene detection work on a 720p H.264 proxy.
    const { size } = await fs.stat(file);
    const longSide = Math.max(video.width ?? 0, video.height ?? 0);
    let analysis = file;
    if (codec !== "h264" || size > 40 * 1024 * 1024 || longSide > 1920 || video.duration > 60) {
      emit({ type: "stage", stage: "probe", progress: 0.04, message: `转成分析用的 720p 代理视频（原片 ${video.width ?? "?"}×${video.height ?? "?"} ${codec.toUpperCase()}）` });
      analysis = path.join(temp, "analysis.mp4");
      await transcodeForAnalysis(file, video, analysis, undefined, signal);
    }

    emit({ type: "stage", stage: "scenes", progress: 0.1, message: "逐帧检测镜头切点" });
    let cuts: number[] = [];
    for (const threshold of BREAKDOWN_SCENE_THRESHOLDS) {
      cuts = await detectCuts(analysis, threshold, signal);
      if (cuts.length || video.duration < 6) break;
    }
    const detected = buildShotsFromCuts(cuts, video.duration);

    emit({ type: "stage", stage: "frames", progress: 0.14, message: `提取 ${detected.length} 个镜头的关键帧` });
    // Stills come from the original master, so they keep its full detail.
    const frames: Frame[] = await mapLimit(detected, 3, async shot => {
      const saved = await saveFrame(await extractFrame(file, shot.keyTime, signal));
      return { shot, ...saved };
    });
    let shots: BreakdownShot[] = frames.map(frame => breakdownShotSchema.parse({
      index: frame.shot.index, start: frame.shot.start, end: frame.shot.end, frameUrl: frame.url,
    }));
    emit({ type: "shots", shots });

    const fullVideo = await stageForModel(analysis, staged, route, overviewFps(video.duration), signal);

    // A short naming pass fixes who is called what and how shots group into segments,
    // so the deep overview and every shot batch can run at the same time.
    emit({ type: "stage", stage: "frames", progress: 0.17, message: "确定人物称呼与片段划分" });
    let cast: BreakdownCast = [];
    let plan = normalizeSegmentPlan([], detected);
    let planFixed = false;
    try {
      const value = readCastResult(await ask(route, input.authUserId, [
        { type: "text", text: buildCastPrompt(video, detected) },
        ...await frameBlocks(sampleFrames(frames, CAST_FRAME_LIMIT), 384),
      ], 8000, THINKING.light, signal));
      cast = value.characters.filter(item => item.name);
      if (value.segments.length) { plan = normalizeSegmentPlan(value.segments, detected); planFixed = true; }
    } catch (error) {
      if (signal?.aborted) throw error;
    }

    const speech = await speechTask;
    if (speech.note) emit({ type: "warning", message: speech.note });
    emit({ type: "stage", stage: "shots", progress: 0.2, message: speech.lines.length
      ? `通看全片与逐镜拆解同时进行（已识别 ${speech.lines.length} 句台词）`
      : "通看全片与逐镜拆解同时进行" });
    let overview: BreakdownOverview | undefined;
    const overviewStills = await frameBlocks(sampleFrames(frames, OVERVIEW_FRAME_LIMIT), 384);
    const overviewTask = (async () => {
      try {
        if (!planFixed) {
          const value = readOverviewResult(await ask(route, input.authUserId, [
            { type: "text", text: buildOverviewPrompt(video, detected, speech) }, fullVideo, ...overviewStills,
          ], 16000, THINKING.deepest, signal));
          overview = value.overview;
          plan = normalizeSegmentPlan(value.segments, detected);
        } else {
          // Story/structure and look/sound are thought through side by side, each at full depth.
          const parts = await Promise.allSettled((["story", "look"] as const).map(part => ask(route, input.authUserId, [
            { type: "text", text: buildOverviewPartPrompt(part, video, detected, speech, cast) }, fullVideo, ...overviewStills,
          ], 12000, THINKING.deepest, signal)));
          if (signal?.aborted) throw new ShotBreakdownError("拉片已取消");
          const done = parts.filter((part): part is PromiseFulfilledResult<unknown> => part.status === "fulfilled").map(part => readOverviewResult(part.value).overview);
          if (!done.length) throw (parts[0] as PromiseRejectedResult).reason;
          const merged = Object.assign({}, ...done.map(item => Object.fromEntries(Object.entries(item).filter(([, value]) => Array.isArray(value) ? value.length : value))));
          overview = breakdownOverviewSchema.parse({ ...merged, characters: merged.characters?.length ? merged.characters : cast });
          if (done.length < parts.length) emit({ type: "warning", message: "全片拆解有一部分未生成，可重新拉片补全" });
        }
        emit({ type: "overview", overview });
      } catch (error) {
        if (signal?.aborted) throw error;
        emit({ type: "warning", message: `全片拆解未完成：${error instanceof Error ? error.message : "未知错误"}，其余结果照常生成` });
      }
    })();
    overviewTask.catch(() => undefined);
    // Without a fixed plan (naming pass failed) segments must wait for the overview's plan.
    if (!planFixed) await overviewTask;

    const batches: Frame[][] = [];
    for (let i = 0; i < frames.length; i += SHOT_BATCH_SIZE) batches.push(frames.slice(i, i + SHOT_BATCH_SIZE));
    const useClips = video.duration > CLIP_ANALYSIS_SECONDS;
    let finishedBatches = 0;
    const analyseBatch = async (batch: readonly Frame[]) => {
      let clip: { start: number; end: number } | undefined;
      let content = fullVideo;
      if (useClips) {
        // Long films: the model watches only this batch's time range, at 2 fps.
        clip = { start: Math.max(0, batch[0].shot.start - 0.3), end: Math.min(video.duration, batch[batch.length - 1].shot.end + 0.3) };
        const output = path.join(temp, `clip-${batch[0].shot.index}-${crypto.randomUUID()}.mp4`);
        await transcodeForAnalysis(analysis, video, output, clip, signal);
        content = await stageForModel(output, staged, route, 2, signal);
      }
      const value = await ask(route, input.authUserId, [
        { type: "text", text: buildShotsPrompt(video, batch.map(frame => frame.shot), cast.length ? cast : overview?.characters, clip, speech) },
        content,
        ...await frameBlocks(batch, 640),
      ], Math.min(32000, 4000 * batch.length + 4000), THINKING.high, signal);
      return mergeShotResults(shots.filter(shot => batch.some(frame => frame.shot.index === shot.index)), value);
    };

    // A segment's prompt needs only its own shots, so it starts as soon as they are
    // analysed instead of waiting for the whole film.
    const settledShots = new Set<number>();
    const segmentBatches: (typeof plan)[] = [];
    for (let i = 0; i < plan.length; i += SEGMENT_BATCH_SIZE) segmentBatches.push(plan.slice(i, i + SEGMENT_BATCH_SIZE));
    const segmentWaiters = segmentBatches.map(batch => {
      let release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; });
      return { batch, ready, release, needs: batch.flatMap(item => item.shots) };
    });
    const releaseReadySegments = () => {
      for (const waiter of segmentWaiters) if (waiter.needs.every(index => settledShots.has(index))) waiter.release();
    };
    const clipUrls = new Map<number, string>();
    const withClips = (items: BreakdownSegment[]) => items.map(segment => clipUrls.has(segment.index) ? { ...segment, clipUrl: clipUrls.get(segment.index) } : segment);
    let segments: BreakdownSegment[] = mergeSegmentResults(plan, shots, {});
    // Each segment's source clip goes on the canvas next to its breakdown; cutting runs beside the analysis.
    const clipsDone = mapLimit(plan, 2, async item => {
      const first = detected.find(shot => shot.index === item.shots[0]);
      const last = detected.find(shot => shot.index === item.shots[item.shots.length - 1]);
      if (!first || !last) return;
      try {
        clipUrls.set(item.index, await cutSegmentClip(file, video, { start: first.start, end: last.end }, temp, signal));
        segments = withClips(segments);
        emit({ type: "segments", segments });
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    });
    clipsDone.catch(() => undefined);
    let finishedSegments = 0;
    let segmentSlots = SEGMENT_CONCURRENCY;
    const slotQueue: (() => void)[] = [];
    const acquireSegmentSlot = async () => {
      if (segmentSlots > 0) { segmentSlots -= 1; return; }
      await new Promise<void>(resolve => slotQueue.push(resolve));
    };
    const releaseSegmentSlot = () => {
      const next = slotQueue.shift();
      if (next) next(); else segmentSlots += 1;
    };
    const cancelled = new Promise<never>((_, reject) => {
      if (signal?.aborted) reject(new ShotBreakdownError("拉片已取消"));
      signal?.addEventListener("abort", () => reject(new ShotBreakdownError("拉片已取消")), { once: true });
    });
    cancelled.catch(() => undefined);
    const segmentTasks = segmentWaiters.map(async ({ batch, ready }) => {
      await Promise.race([Promise.all([ready, overviewTask]), cancelled]);
      await acquireSegmentSlot();
      try {
        const value = await ask(route, input.authUserId, buildSegmentsPrompt({ video, overview, plan: batch, shots }), 8000 * batch.length, THINKING.high, signal);
        const merged = new Map(mergeSegmentResults(batch, shots, value).map(segment => [segment.index, segment]));
        segments = withClips(segments.map(segment => merged.get(segment.index) ?? segment));
        emit({ type: "segments", segments });
      } catch (error) {
        if (signal?.aborted) throw error;
        emit({ type: "warning", message: `片段 ${batch.map(item => item.index).join("、")} 的复刻提示词未生成：${error instanceof Error ? error.message : "未知错误"}` });
      } finally {
        releaseSegmentSlot();
        finishedSegments += 1;
        if (finishedBatches === batches.length) {
          emit({ type: "stage", stage: "segments", progress: 0.84 + 0.15 * finishedSegments / segmentWaiters.length, message: `生成复刻提示词 ${finishedSegments}/${segmentWaiters.length}` });
        }
      }
    });
    const segmentsDone = Promise.all(segmentTasks);
    segmentsDone.catch(() => undefined);

    await mapLimit(batches, SHOT_CONCURRENCY, async batch => {
      let result = await analyseBatch(batch).catch(error => {
        if (signal?.aborted) throw error;
        return null;
      });
      // One focused retry for shots the model skipped or a batch that failed outright.
      const missing = result ? result.missing : batch.map(frame => frame.shot.index);
      if (missing.length) {
        const retry = await analyseBatch(batch.filter(frame => missing.includes(frame.shot.index))).catch(error => {
          if (signal?.aborted) throw error;
          return null;
        });
        if (retry) result = { shots: [...(result?.shots ?? []).filter(shot => !missing.includes(shot.index)), ...retry.shots], missing: retry.missing };
      }
      if (result) {
        const updated = new Map(result.shots.map(shot => [shot.index, shot]));
        shots = shots.map(shot => updated.get(shot.index) ?? shot);
      }
      finishedBatches += 1;
      const done = shots.filter(shot => shot.description).length;
      emit({ type: "shots", shots });
      emit({ type: "stage", stage: "shots", progress: 0.2 + 0.64 * finishedBatches / batches.length, message: `逐镜拆解 ${done}/${detected.length}${overview ? "" : " · 同时通看全片"}` });
      for (const frame of batch) settledShots.add(frame.shot.index);
      releaseReadySegments();
    });
    const unanalysed = shots.filter(shot => !shot.description).map(shot => shot.index);
    if (unanalysed.length) emit({ type: "warning", message: `镜头 ${unanalysed.join("、")} 未能完成拆解，可稍后重新拉片` });

    if (finishedSegments < segmentWaiters.length) {
      emit({ type: "stage", stage: "segments", progress: 0.84 + 0.15 * finishedSegments / segmentWaiters.length, message: `生成复刻提示词 ${finishedSegments}/${segmentWaiters.length}` });
    }
    await overviewTask;
    await segmentsDone;
    await clipsDone;
    if (!soundtrackSettled) emit({ type: "stage", stage: "segments", progress: 0.99, message: "正在分离背景音乐（去人声）" });
    await soundtrackTask;
    segments = withClips(segments);
    emit({ type: "segments", segments });
    emit({ type: "stage", stage: "done", progress: 1, message: "拉片完成" });
    emit({ type: "done" });
  } finally {
    activeUsers.delete(input.authUserId);
    activeJobs -= 1;
    await Promise.all(staged.map(file => fs.rm(file, { force: true }).catch(() => undefined)));
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
