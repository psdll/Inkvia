import "server-only";
import { locateCreativeMedia } from "./media-inspection";
import { probeRuntimeMedia, videoAudioTrack, videoFramesAtSeconds, videoSceneCuts, type MediaFacts } from "./media-files";
import { creativeAgentStore } from "./store";
import { creativeAgentSupportsVision, resolveCreativeAgentModel } from "./model-catalog";
import { transcribeAudio, type TranscriptSegment } from "@/lib/volcengine-asr";
import type { ToolExecutionInput } from "./tools";
import { CreativeAgentError } from "./errors";

/** 爆款短视频一般在几分钟内；更长的只拆前 10 分钟 */
const MAX_SECONDS = 600;
const MAX_FRAMES = 16;
/** 前 3 秒决定完播，固定多抽几帧看钩子 */
const HOOK_SECONDS = [0.2, 1.5, 2.8];

export type VideoShot = { start: number; end: number };
export type VideoBreakdown = {
  kind: "video" | "audio";
  facts: MediaFacts;
  analyzedSeconds: number;
  shots: VideoShot[];
  frames: { second: number; shot: number; data: string; mimeType: "image/jpeg" }[];
  transcript: TranscriptSegment[];
  /** 没有台词时的说明：无声音、纯音乐、识别不可用等 */
  transcriptNote?: string;
  visionNote?: string;
};

export function splitShots(cuts: number[], duration: number, minShot = 0.4): VideoShot[] {
  const bounds = [0];
  for (const cut of [...cuts].sort((a, b) => a - b)) if (cut - bounds[bounds.length - 1] >= minShot && duration - cut >= minShot) bounds.push(cut);
  bounds.push(duration);
  return bounds.slice(0, -1).map((start, index) => ({ start, end: bounds[index + 1] }));
}

/** 关键帧：前 3 秒的钩子帧 + 每个镜头的中点；超出上限时均匀抽取镜头 */
export function pickFrameSeconds(shots: VideoShot[], duration: number, limit = MAX_FRAMES) {
  const hook = HOOK_SECONDS.filter(second => second < duration);
  let middles = shots.map(shot => (shot.start + shot.end) / 2);
  const room = Math.max(0, limit - hook.length);
  if (middles.length > room) middles = Array.from({ length: room }, (_, index) => middles[Math.floor(index * middles.length / room)]);
  const picked: number[] = [];
  for (const second of [...hook, ...middles].sort((a, b) => a - b)) if (!picked.length || second - picked[picked.length - 1] >= 0.5) picked.push(Math.round(second * 10) / 10);
  return picked;
}

export const shotOf = (shots: VideoShot[], second: number) => Math.max(1, shots.findIndex(shot => second >= shot.start && second < shot.end) + 1 || shots.length);

export async function analyzeCreativeVideo(input: ToolExecutionInput): Promise<VideoBreakdown> {
  const { kind, storageRef } = await locateCreativeMedia(input);
  if (kind !== "video" && kind !== "audio") throw new CreativeAgentError("REFERENCE_KIND_INVALID", "只能拆解视频或音频素材", 400);
  if (!storageRef) throw new CreativeAgentError("MEDIA_FILE_UNAVAILABLE", "没有找到这个素材的本地文件，请重新上传视频后再试", 400);
  const facts = await probeRuntimeMedia(storageRef, kind);
  if (facts.state !== "verified") throw new CreativeAgentError("MEDIA_DECODE_FAILED", facts.reason === "decoder_unavailable" ? "服务器缺少视频解码工具（ffmpeg），暂时无法拆解" : "视频文件无法解码，请换一个文件", 400);
  const duration = facts.durationSeconds || 0;
  const analyzedSeconds = Math.min(duration, MAX_SECONDS);

  const transcribe = async () => {
    if (kind === "video" && !facts.audioCodecs?.length) return { transcript: [], transcriptNote: "视频没有声音" };
    try {
      const audio = await videoAudioTrack(storageRef, kind, analyzedSeconds || MAX_SECONDS);
      const result = await transcribeAudio({ data: audio, format: "mp3", signal: input.signal });
      return result.segments.length ? { transcript: result.segments } : { transcript: [], transcriptNote: "没有识别到人声台词（可能是纯音乐或音效）" };
    } catch (error) {
      return { transcript: [], transcriptNote: `台词识别暂不可用：${error instanceof Error ? error.message : "未知原因"}` };
    }
  };

  if (kind === "audio") return { kind, facts, analyzedSeconds, shots: [], frames: [], ...await transcribe() };

  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  const resolved = await resolveCreativeAgentModel(run.input.model);
  const vision = resolved.status === "ready" && creativeAgentSupportsVision(resolved.route.providerId, resolved.route.modelId);
  const [cuts, speech] = await Promise.all([videoSceneCuts(storageRef, analyzedSeconds).catch(() => []), transcribe()]);
  const shots = splitShots(cuts, analyzedSeconds);
  const frames = vision ? (await videoFramesAtSeconds(storageRef, pickFrameSeconds(shots, analyzedSeconds))).map(frame => ({ second: frame.second, shot: shotOf(shots, frame.second), data: frame.buffer.toString("base64"), mimeType: "image/jpeg" as const })) : [];
  return { kind, facts, analyzedSeconds, shots, frames, ...speech, ...(vision ? {} : { visionNote: "当前对话模型不支持看图，只拆了镜头节奏和台词；需要画面分析请在创作偏好里换一个支持看图的对话模型" }) };
}

const clock = (second: number) => `${String(Math.floor(second / 60)).padStart(2, "0")}:${(second % 60).toFixed(1).padStart(4, "0")}`;
const ratioOf = (width?: number, height?: number) => {
  if (!width || !height) return "";
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const value = width / height;
  const common = [["9:16", 9 / 16], ["3:4", 3 / 4], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9]] as const;
  const near = common.find(([, ratio]) => Math.abs(ratio - value) / ratio < 0.03);
  return near ? near[0] : `${width / gcd(width, height)}:${height / gcd(width, height)}`;
};

/** 给 Agent 的拆解素材（文字部分；关键帧按 frames 顺序作为图片附上） */
export function describeBreakdown(alias: string, breakdown: VideoBreakdown) {
  const { facts, shots, frames, transcript } = breakdown;
  const duration = facts.durationSeconds || 0;
  const info = [`${duration.toFixed(1)} 秒`, facts.width && facts.height ? `${facts.width}×${facts.height}（${ratioOf(facts.width, facts.height)}）` : "", facts.frameRate ? `${Math.round(facts.frameRate)}fps` : "", breakdown.kind === "video" ? (facts.audioCodecs?.length ? "有声音" : "无声音") : "音频"].filter(Boolean).join(" · ");
  const lines = [`#${alias} 拆解素材${duration > breakdown.analyzedSeconds ? `（较长，只分析了前 ${Math.round(breakdown.analyzedSeconds)} 秒）` : ""}`, `基本信息：${info}`];
  if (shots.length) {
    lines.push(`镜头：共 ${shots.length} 个，平均 ${(breakdown.analyzedSeconds / shots.length).toFixed(1)} 秒/镜`);
    lines.push(...shots.map((shot, index) => `${index + 1}. ${clock(shot.start)}–${clock(shot.end)}（${(shot.end - shot.start).toFixed(1)} 秒）`));
  }
  lines.push(transcript.length ? "台词（语音识别，含时间）：" : `台词：${breakdown.transcriptNote || "无"}`);
  lines.push(...transcript.map(segment => `[${clock(segment.start)}–${clock(segment.end)}] ${segment.text}`));
  if (frames.length) lines.push(`关键帧（依次对应下面的图片）：${frames.map((frame, index) => `${index + 1}) ${clock(frame.second)} 第${frame.shot}镜`).join("；")}`);
  if (breakdown.visionNote) lines.push(breakdown.visionNote);
  return lines.join("\n");
}
