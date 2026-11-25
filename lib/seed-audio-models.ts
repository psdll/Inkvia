// Contract: https://docs.volcengine.com/docs/6561/2550782?lang=zh (2026-08-20).
export const SEED_AUDIO_MODEL_ID = "seed-audio-1.0" as const;
export const SEED_AUDIO_PROVIDER_ID = "volcengine-speech" as const;
export const SEED_AUDIO_TEXT_MAX_LENGTH = 3000;
export const SEED_AUDIO_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const SEED_AUDIO_TIMEOUT_MS = 300_000;
export const SEED_AUDIO_FORMATS = ["wav", "mp3", "pcm", "ogg_opus"] as const;
export type SeedAudioFormat = typeof SEED_AUDIO_FORMATS[number];
export const SEED_AUDIO_DEFAULT_FORMAT: SeedAudioFormat = "wav";
export const SEED_AUDIO_DEFAULT_SAMPLE_RATE = 24000;
export const SEED_AUDIO_SAMPLE_RATES: Record<SeedAudioFormat, readonly number[]> = {
  wav: [8000, 16000, 24000, 32000, 40000, 44100, 48000],
  pcm: [8000, 16000, 24000, 32000, 40000, 44100, 48000],
  mp3: [8000, 16000, 24000, 32000, 44100, 48000],
  ogg_opus: [48000],
};
export const SEED_AUDIO_OUTPUT_FILES: Record<SeedAudioFormat, { extension: string; contentType: string }> = {
  wav: { extension: "wav", contentType: "audio/wav" },
  mp3: { extension: "mp3", contentType: "audio/mpeg" },
  pcm: { extension: "pcm", contentType: "application/octet-stream" },
  ogg_opus: { extension: "ogg", contentType: "audio/ogg" },
};

export function isSeedAudioModel(model: string): model is typeof SEED_AUDIO_MODEL_ID {
  return model === SEED_AUDIO_MODEL_ID;
}

export type SeedAudioMediaReference = {
  kind: "image" | "audio";
  url: string;
  durationSeconds?: number;
};

export type SeedAudioReference =
  | { audio_url: string }
  | { audio_data: string }
  | { image_url: string }
  | { image_data: string };

export type SeedAudioSettings = {
  model: typeof SEED_AUDIO_MODEL_ID;
  text: string;
  speed: number;
  volume: number;
  pitch: number;
  audioFormat?: SeedAudioFormat;
  sampleRate?: number;
  references?: SeedAudioMediaReference[];
};

export function validateSeedAudioReferences(references: readonly SeedAudioMediaReference[]) {
  if (!Array.isArray(references)) throw new Error("Seed Audio 参考素材格式不合法");
  const images = references.filter((ref) => ref?.kind === "image");
  const audios = references.filter((ref) => ref?.kind === "audio");
  if (images.length + audios.length !== references.length) throw new Error("Seed Audio 只支持图片或音频参考");
  if (images.length && audios.length) throw new Error("Seed Audio 图片参考不能与音频参考混用");
  if (images.length > 1) throw new Error("Seed Audio 最多支持 1 张参考图片");
  if (audios.length > 3) throw new Error("Seed Audio 最多支持 3 条音频参考");
  for (const ref of references) {
    if (typeof ref.url !== "string" || !ref.url.trim() || ref.url.startsWith("blob:")) throw new Error("请等待参考素材上传完成");
    if (ref.kind === "audio" && ref.durationSeconds !== undefined && (!Number.isFinite(ref.durationSeconds) || ref.durationSeconds <= 0 || ref.durationSeconds > 30)) {
      throw new Error("Seed Audio 单条参考音频不能超过 30 秒");
    }
  }
}

export function validateSeedAudioMedia(input: { kind: "image" | "audio"; byteSize: number; mime: string; durationSeconds?: number; audioCodecs?: string[] }) {
  if (input.byteSize > SEED_AUDIO_REFERENCE_MAX_BYTES) throw new Error("Seed Audio 单条参考素材不能超过 10 MB");
  const supported = input.kind === "image"
    ? ["image/jpeg", "image/png", "image/webp"].includes(input.mime)
    : ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/mpeg", "audio/mp3", "audio/pcm"].includes(input.mime)
      || (["audio/ogg", "audio/opus"].includes(input.mime) && input.audioCodecs?.every((codec) => codec === "opus"));
  if (!supported) throw new Error(input.kind === "image" ? "Seed Audio 参考图片仅支持 JPEG、PNG、WebP" : "Seed Audio 参考音频仅支持 WAV、MP3、PCM、Ogg Opus");
  if (input.kind === "audio" && (!Number.isFinite(input.durationSeconds) || input.durationSeconds! <= 0 || input.durationSeconds! > 30)) {
    throw new Error("Seed Audio 参考音频须能读取时长且不超过 30 秒");
  }
}

function rate(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0.5 || value > 2) throw new Error(`Seed Audio ${label}必须在 0.5 到 2 倍之间`);
  return Math.round((value - 1) * 100);
}

export function buildSeedAudioRequest(input: SeedAudioSettings, preparedReferences?: SeedAudioReference[]) {
  if (!isSeedAudioModel(input.model)) throw new Error("不支持的 Seed Audio 模型");
  const text = String(input.text || "").trim();
  if (!text) throw new Error("请输入音频提示词");
  if ([...text].length > SEED_AUDIO_TEXT_MAX_LENGTH) throw new Error("Seed Audio 提示词不能超过 3000 个字符");
  if (!Number.isInteger(input.pitch) || input.pitch < -12 || input.pitch > 12) throw new Error("Seed Audio 音调必须为 -12 到 12 的整数");
  const format = input.audioFormat ?? SEED_AUDIO_DEFAULT_FORMAT;
  if (!SEED_AUDIO_FORMATS.includes(format)) throw new Error("Seed Audio 输出格式不合法");
  const sampleRate = input.sampleRate ?? (format === "ogg_opus" ? 48000 : SEED_AUDIO_DEFAULT_SAMPLE_RATE);
  if (!SEED_AUDIO_SAMPLE_RATES[format].includes(sampleRate)) throw new Error(`Seed Audio ${format} 不支持该采样率${format === "ogg_opus" ? "，仅支持 48k" : ""}`);
  validateSeedAudioReferences(input.references || []);
  const references: SeedAudioReference[] = preparedReferences ?? [
    ...(input.references || []).map((ref): SeedAudioReference => ref.kind === "image" ? { image_url: ref.url } : { audio_url: ref.url }),
  ];
  // Only send this model's documented fields. Duration and emotions belong in text_prompt.
  return {
    endpoint: "/api/v3/tts/create",
    body: {
      model: SEED_AUDIO_MODEL_ID,
      text_prompt: text,
      ...(references.length ? { references } : {}),
      audio_config: {
        format,
        sample_rate: sampleRate,
        speech_rate: rate(input.speed, "语速"),
        loudness_rate: rate(input.volume, "音量"),
        pitch_rate: input.pitch,
      },
    },
  };
}
