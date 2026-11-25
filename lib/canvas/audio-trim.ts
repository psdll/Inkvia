import { sampleAudioChannels, type CanvasAudioWaveformData } from "./audio-waveform";

export type CanvasAudioClip = CanvasAudioWaveformData & { blob: Blob };

export function getCanvasAudioClipName(name: string) {
  return `${name.replace(/\.(mp3|wav|m4a|aac|ogg|opus|flac|webm)$/i, "")}_截取`;
}

export function encodeCanvasAudioClip(channels: Float32Array[], sampleRate: number, start: number, end: number): CanvasAudioClip {
  const length = channels[0]?.length ?? 0;
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0
    || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > length / sampleRate) {
    throw new Error("请选择有效的音频截取范围");
  }
  const from = Math.round(start * sampleRate);
  const to = Math.min(length, Math.round(end * sampleRate));
  if (to <= from) throw new Error("截取片段太短");
  const clipped = channels.map(channel => channel.subarray(from, to));
  const frames = to - from;
  const blockAlign = channels.length * 2;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, frames * blockAlign, true);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < clipped.length; channel++) {
      const value = Math.max(-1, Math.min(1, clipped[channel][frame] || 0));
      view.setInt16(44 + frame * blockAlign + channel * 2, Math.round(value * (value < 0 ? 0x8000 : 0x7fff)), true);
    }
  }
  return { blob: new Blob([buffer], { type: "audio/wav" }), ...sampleAudioChannels(clipped, frames / sampleRate) };
}

export async function trimCanvasAudio(url: string, start: number, end: number): Promise<CanvasAudioClip> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("音频加载失败，请重试");
  const AudioContextClass = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频截取");
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    return encodeCanvasAudioClip(
      Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)),
      audio.sampleRate, start, Math.min(end, audio.duration),
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}
