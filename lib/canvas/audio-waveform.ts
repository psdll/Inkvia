import type { CanvasDocumentV2 } from "@/lib/canvas/document";

export const CANVAS_AUDIO_WAVEFORM_PEAK_COUNT = 80;

export type CanvasAudioWaveformData = {
  waveformPeaks: number[];
  durationSeconds: number;
};

const waveformPromises = new Map<string, Promise<CanvasAudioWaveformData>>();

function safeDuration(seconds: number) {
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

export function sampleAudioChannels(
  channels: readonly Float32Array[],
  durationSeconds: number,
  peakCount = CANVAS_AUDIO_WAVEFORM_PEAK_COUNT,
): CanvasAudioWaveformData {
  const count = Math.max(1, Math.floor(peakCount));
  const sampleCount = Math.max(0, ...channels.map((channel) => channel.length));
  const rawPeaks = Array.from({ length: count }, (_, peakIndex) => {
    const start = Math.floor((peakIndex * sampleCount) / count);
    const end = Math.max(start + 1, Math.floor(((peakIndex + 1) * sampleCount) / count));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < Math.min(end, channel.length); index += 1) {
        peak = Math.max(peak, Math.abs(channel[index]));
      }
    }
    return peak;
  });
  const maxPeak = Math.max(0, ...rawPeaks);
  return {
    waveformPeaks: rawPeaks.map((peak) => maxPeak > 0 ? Math.max(4, Math.round((peak / maxPeak) * 100)) : 4),
    durationSeconds: safeDuration(durationSeconds),
  };
}

async function analyzeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<CanvasAudioWaveformData> {
  const AudioContextClass = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频波形解析");
  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
    return sampleAudioChannels(channels, audioBuffer.duration);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function analyzeAudioFile(file: File): Promise<CanvasAudioWaveformData> {
  return analyzeAudioBuffer(await file.arrayBuffer());
}

export function registerAudioWaveformPromise(
  url: string,
  promise: Promise<CanvasAudioWaveformData>,
): Promise<CanvasAudioWaveformData> {
  let tracked: Promise<CanvasAudioWaveformData>;
  tracked = promise.catch((error) => {
    if (waveformPromises.get(url) === tracked) waveformPromises.delete(url);
    throw error;
  });
  waveformPromises.set(url, tracked);
  return tracked;
}

export function analyzeAudioUrlCached(url: string): Promise<CanvasAudioWaveformData> {
  const existing = waveformPromises.get(url);
  if (existing) return existing;
  return registerAudioWaveformPromise(url, (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("音频加载失败");
    return analyzeAudioBuffer(await response.arrayBuffer());
  })());
}

export function hydrateCanvasAudioNode(
  document: CanvasDocumentV2,
  nodeId: string,
  waveform: CanvasAudioWaveformData,
): CanvasDocumentV2 {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (!target || target.data.kind !== "audio") return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === nodeId && node.data.kind === "audio"
      ? { ...node, data: { ...node.data, ...waveform } }
      : node),
  };
}

export function formatCanvasAudioTime(seconds: number) {
  const wholeSeconds = Math.floor(safeDuration(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function rounded(value: number) {
  return Number(value.toFixed(2));
}

export function createCanvasWaveformPath(peaks: readonly number[], width: number, height: number) {
  if (!peaks.length || width <= 0 || height <= 0) return "";
  const step = width / peaks.length;
  return peaks.map((peak, index) => {
    const amplitude = Math.max(1, (Math.min(100, Math.max(0, peak)) / 100) * height);
    const top = (height - amplitude) / 2;
    return `M${rounded((index + 0.5) * step)} ${rounded(top)}V${rounded(top + amplitude)}`;
  }).join(" ");
}
