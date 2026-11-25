import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import sharp from "sharp";
import { probeLocalMedia, resolveLocalUploadPath } from "@/lib/tool-media/media-probe";

export type MediaFacts = { state: "verified" | "failed" | "unavailable"; kind: string; contentVersion: string; sizeBytes?: number; width?: number; height?: number; durationSeconds?: number; detectedMime?: string; videoCodec?: string; container?: string; frameRate?: number; audioCodecs?: string[]; frameCount?: number; reason?: string };
let active = 0;
const queue: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>) {
  if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
  else active++;
  try { return await fn(); } finally { const next = queue.shift(); if (next) next(); else active--; }
}
async function executable(command: string, args: string[], maxBuffer: number, timeout = 10_000) {
  if (!['ffmpeg', 'ffprobe'].includes(command)) throw new Error("AGENT_MEDIA_EXECUTABLE_INVALID");
  return slot(() => new Promise<Buffer>((resolve, reject) => execFile(command, args, { timeout, maxBuffer, windowsHide: true, encoding: "buffer" }, (error, stdout) => error ? reject(error) : resolve(stdout))));
}

/** Callers must establish row ownership first. Refuse remote URLs, symlinks escaping uploads, and oversized inputs. */
export async function checkedMediaFile(storageRef: string, kind: string) {
  const local = resolveLocalUploadPath(storageRef);
  const root = await fs.realpath(resolveLocalUploadPath('/uploads/'));
  const real = await fs.realpath(local);
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error("AGENT_MEDIA_PATH_INVALID");
  const stat = await fs.stat(real);
  if (!stat.isFile() || !stat.size || stat.size > (kind === "image" ? 30_000_000 : 512_000_000)) throw new Error("AGENT_MEDIA_SIZE_INVALID");
  return { local: real, stat };
}
export async function probeRuntimeMedia(storageRef: string, kind: "image" | "video" | "audio"): Promise<MediaFacts> {
  try {
    const { local, stat } = await checkedMediaFile(storageRef, kind);
    if (kind !== 'image') {
      const handle = await fs.open(local, 'r');
      const header = Buffer.alloc(16);
      try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
      const container = header.toString('ascii');
      const allowed = container.slice(4, 8) === 'ftyp' || header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || kind === 'audio' && (container.startsWith('RIFF') || container.startsWith('ID3') || container.startsWith('OggS') || header[0] === 0xff);
      if (!allowed) throw new Error('AGENT_MEDIA_CONTAINER_UNSUPPORTED');
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(local)) hash.update(chunk);
    const contentVersion = hash.digest('hex');
    let rotation = 0;
    const facts = await probeLocalMedia({ localPath: local, kind, fileName: path.basename(local), declaredMime: `${kind}/*` }, { ffprobeRunner: async (_cmd, args) => {
      const entries = args.indexOf('-show_entries') + 1;
      const extended = [...args];
      // stream_side_data_list 在 ffprobe 4.x 与新版都可用（4.x 没有 stream_side_data 小节，写成那样会整条探测失败）
      if (entries > 0) extended[entries] += ':stream_side_data_list:stream_tags=rotate';
      const stdout = (await executable('ffprobe', ['-protocol_whitelist', 'file,pipe', ...extended], 2_000_000)).toString('utf8');
      const stream = JSON.parse(stdout).streams?.find((s: any) => s.codec_type === 'video');
      rotation = Number(stream?.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? stream?.tags?.rotate ?? 0);
      return { stdout };
    } });
    if (kind === 'video' && Math.abs(rotation % 180) === 90) [facts.width, facts.height] = [facts.height, facts.width];
    if (kind === 'image') {
      const metadata = await sharp(local, { limitInputPixels: 40_000_000 }).metadata();
      if (metadata.orientation && metadata.orientation >= 5) [facts.width, facts.height] = [facts.height, facts.width];
      await sharp(local, { limitInputPixels: 40_000_000 }).resize(1, 1).raw().toBuffer();
    }
    if ((facts.width || 0) * (facts.height || 0) > 40_000_000) throw new Error('AGENT_MEDIA_PIXELS_EXCEEDED');
    if (kind === 'video') await videoFrames(local, facts.durationSeconds || 0, [0]);
    if (!facts.detectedMime.startsWith(`${kind}/`)) return { state: "failed", kind, contentVersion, reason: "mime_mismatch" };
    return { ...facts, state: "verified", contentVersion, sizeBytes: stat.size };
  } catch (error: any) {
    const unavailable = error?.code === 'ENOENT' && /ffprobe|ffmpeg/.test(error?.path || '') || error?.code === 'MEDIA_PROBE_UNAVAILABLE';
    return { state: unavailable ? "unavailable" : "failed", kind, contentVersion: "unverified", reason: unavailable ? "decoder_unavailable" : "missing_or_invalid_media" };
  }
}

async function videoFrames(local: string, duration: number, fractions = [0, .5, .9]) {
  const frames: Buffer[] = [];
  for (const fraction of fractions) {
    const buffer = await executable('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(Math.max(0, duration * fraction)), '-i', local, '-frames:v', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease', '-threads', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], 1_000_000);
    if (!buffer.length) throw new Error('AGENT_MEDIA_DECODE_FAILED');
    frames.push(buffer);
  }
  return frames;
}
export async function runtimeVisionParts(storageRef: string, facts: MediaFacts) {
  if (facts.state !== 'verified' || !['image', 'video'].includes(facts.kind)) throw new Error('AGENT_MEDIA_OBSERVATION_UNAVAILABLE');
  const { local } = await checkedMediaFile(storageRef, facts.kind);
  const buffers = facts.kind === 'image'
    ? [await sharp(local, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()]
    : await videoFrames(local, facts.durationSeconds || 0);
  if (buffers.some(b => b.length > 1_000_000)) throw new Error('AGENT_MEDIA_OBSERVATION_TOO_LARGE');
  return buffers.map(buffer => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}`, detail: "low" } }));
}

const ffmpegInput = ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe'];

/** 镜头切点（秒）：缩小画面后做场景变化检测，只看前 maxSeconds 秒 */
export async function videoSceneCuts(storageRef: string, maxSeconds: number, threshold = 0.3) {
  const { local } = await checkedMediaFile(storageRef, 'video');
  const stdout = (await executable('ffmpeg', [...ffmpegInput, '-t', String(maxSeconds), '-i', local, '-an', '-vf', `scale=160:-2,select='gt(scene,${threshold})',metadata=print:file=-`, '-f', 'null', '-'], 4_000_000, 90_000)).toString('utf8');
  return [...stdout.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite);
}

/** 按指定时间点抽帧（JPEG），读不出的时间点跳过 */
export async function videoFramesAtSeconds(storageRef: string, seconds: number[], size = 512) {
  const { local } = await checkedMediaFile(storageRef, 'video');
  const frames: { second: number; buffer: Buffer }[] = [];
  for (const second of seconds) {
    const buffer = await executable('ffmpeg', [...ffmpegInput, '-ss', String(Math.max(0, second)), '-i', local, '-frames:v', '1', '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-threads', '1', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], 1_000_000).catch(() => Buffer.alloc(0));
    if (buffer.length) frames.push({ second, buffer });
  }
  return frames;
}

/** 抽出音轨：16kHz 单声道 MP3，供语音识别 */
export async function videoAudioTrack(storageRef: string, kind: 'video' | 'audio', maxSeconds: number) {
  const { local } = await checkedMediaFile(storageRef, kind);
  return executable('ffmpeg', [...ffmpegInput, '-t', String(maxSeconds), '-i', local, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'mp3', '-'], 60_000_000, 120_000);
}

export type ComposeClip = { storageRef: string; durationSeconds: number; hasAudio: boolean; caption?: string };
const assTime = (second: number) => {
  const cs = Math.max(0, Math.round(second * 100));
  return `${Math.floor(cs / 360_000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
/** ASS 字幕：画布尺寸与成片一致，字号、边距都按像素算；底部留出平台按钮区 */
function captionScript(captions: { text: string; start: number; end: number }[], width: number, height: number) {
  const size = Math.round(Math.min(width, height) * 0.052), margin = Math.round(width * 0.06);
  return ['[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,PingFang SC,${size},&H00FFFFFF,&H000000FF,&H99000000,&H00000000,1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 14))},0,2,${margin},${margin},${Math.round(height * (height > width ? 0.16 : 0.08))},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...captions.map(caption => `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,${caption.text.replace(/\r?\n/g, '\\N')}`)].join('\n');
}

/**
 * 把多段视频按顺序拼成一条成片：统一尺寸（等比缩放加黑边）、30fps、立体声；
 * 可选背景音乐（循环到成片长度、末尾淡出）和每段字幕（烧录进画面）。返回 MP4 字节。
 */
export async function composeVideoClips(clips: ComposeClip[], options: { width: number; height: number; bgm?: { storageRef: string; volume: number }; keepOriginalAudio: boolean }) {
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-compose-'));
  try {
    const width = Math.max(2, Math.round(options.width / 2) * 2), height = Math.max(2, Math.round(options.height / 2) * 2);
    const inputs: string[] = [], filters: string[] = [], joined: string[] = [];
    for (const [index, clip] of clips.entries()) {
      const { local } = await checkedMediaFile(clip.storageRef, 'video');
      inputs.push('-i', local);
      filters.push(`[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`);
      filters.push(clip.hasAudio && options.keepOriginalAudio
        ? `[${index}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${clip.durationSeconds.toFixed(3)}[a${index}]`
        : `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${clip.durationSeconds.toFixed(3)}[a${index}]`);
      joined.push(`[v${index}][a${index}]`);
    }
    const total = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0);
    filters.push(`${joined.join('')}concat=n=${clips.length}:v=1:a=1[vcat][acat]`);
    let video = '[vcat]', audio = '[acat]';
    const captions = clips.map((clip, index) => ({ clip, start: clips.slice(0, index).reduce((sum, item) => sum + item.durationSeconds, 0) })).filter(item => item.clip.caption?.trim());
    if (captions.length) {
      const file = path.join(dir, 'captions.ass');
      await fs.writeFile(file, captionScript(captions.map(({ clip, start }) => ({ text: clip.caption!.trim(), start: start + 0.1, end: start + clip.durationSeconds - 0.1 })), width, height));
      filters.push(`${video}ass=${file.replace(/([:\\'])/g, '\\$1')}[vsub]`);
      video = '[vsub]';
    }
    if (options.bgm) {
      const { local } = await checkedMediaFile(options.bgm.storageRef, 'audio').catch(() => checkedMediaFile(options.bgm!.storageRef, 'video'));
      inputs.push('-stream_loop', '-1', '-i', local);
      const fade = Math.min(2, total / 4);
      filters.push(`[${clips.length}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${options.bgm.volume.toFixed(2)},atrim=0:${total.toFixed(3)},afade=t=out:st=${(total - fade).toFixed(3)}:d=${fade.toFixed(3)}[bgm]`);
      filters.push(`${audio}[bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
      audio = '[amix]';
    }
    const output = path.join(dir, 'composed.mp4');
    await slot(() => new Promise<void>((resolve, reject) => execFile('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', ...inputs, '-filter_complex', filters.join(';'), '-map', video, '-map', audio, '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-y', output], { timeout: 600_000, maxBuffer: 4_000_000, windowsHide: true }, (error, _stdout, stderr) => error ? reject(Object.assign(error, { stderr: String(stderr).slice(-600) })) : resolve())));
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
