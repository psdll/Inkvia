import { encodeCanvasAudioClip, type CanvasAudioClip } from "./audio-trim";

export const CANVAS_AUDIO_SPEED_MIN = .1;
export const CANVAS_AUDIO_SPEED_MAX = 4;

export function getCanvasAudioSpeedName(name: string, speed: number) {
  return `${name.replace(/\.(mp3|wav|m4a|aac|ogg|opus|flac|webm)$/i, "")}_${Number(speed.toFixed(2))}x`;
}

export async function changeCanvasAudioSpeedChannels(channels: Float32Array[], sampleRate: number, speed: number): Promise<Float32Array[]> {
  if (!Number.isFinite(speed) || speed < CANVAS_AUDIO_SPEED_MIN || speed > CANVAS_AUDIO_SPEED_MAX) throw new Error("变速范围为 0.1x–4.0x");
  const length = channels[0]?.length ?? 0;
  if (!length || !Number.isFinite(sampleRate) || sampleRate <= 0 || channels.length > 2 || channels.some(channel => channel.length !== length)) {
    throw new Error("请选择有效的单声道或立体声音频");
  }
  const frames = Math.max(1, Math.round(length / speed));
  if (frames * channels.length > 48_000_000) throw new Error("变速后的音频过长，请先截取需要的片段");
  if (speed === 1) return channels.map(channel => channel.slice());
  const { Stretch } = await import("@soundtouchjs/core");
  const processor = new Stretch({ sampleRate, createBuffers: true });
  processor.tempo = speed;
  const output = channels.map(() => new Float32Array(frames));
  const block = 4096;
  const input = new Float32Array(block * 2);
  let written = 0;
  // Feed silence after EOF to flush the WSOLA overlap window, then trim to the exact duration.
  const flushEnd = length + processor.inputChunkSize * 3 + block;
  for (let position = 0; written < frames && position < flushEnd; position += block) {
    for (let i = 0; i < block; i++) {
      input[i * 2] = channels[0][position + i] ?? 0;
      input[i * 2 + 1] = (channels[1] ?? channels[0])[position + i] ?? 0;
    }
    processor.inputBuffer!.putSamples(input);
    processor.process();
    const count = Math.min(processor.outputBuffer!.frameCount, frames - written);
    if (count) {
      const samples = new Float32Array(count * 2);
      processor.outputBuffer!.extract(samples, 0, count);
      processor.outputBuffer!.receive(count);
      for (let i = 0; i < count; i++) {
        output[0][written + i] = samples[i * 2];
        if (output[1]) output[1][written + i] = samples[i * 2 + 1];
      }
      written += count;
    }
    if (position % (block * 16) === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  processor.clear();
  if (written !== frames) throw new Error("音频变速未完成，请重试");
  return output;
}

export async function changeCanvasAudioSpeed(url: string, speed: number): Promise<CanvasAudioClip> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("音频加载失败，请重试");
  const AudioContextClass = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频变速");
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    const channels = await changeCanvasAudioSpeedChannels(
      Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)), audio.sampleRate, speed,
    );
    return encodeCanvasAudioClip(channels, audio.sampleRate, 0, channels[0].length / audio.sampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}
