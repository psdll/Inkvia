import { z } from "zod";

// APIMart /audios/suno/generation and /overview, verified 2026-10-19.
export const SUNO_MODELS = [
  { id: "suno-v6-apimart", version: "v6", label: "Suno v6" },
  { id: "suno-v6-wild-apimart", version: "v6-wild", label: "Suno v6-wild" },
  { id: "suno-v6-mini-apimart", version: "v6-mini", label: "Suno v6-mini" },
] as const;
export const isSunoModel = (model: string) => SUNO_MODELS.some(m => m.id === model);
export const sunoSettingsSchema = z.object({
  custom: z.boolean().optional(),
  description: z.string().optional(),
  lyrics: z.string().optional(),
  style: z.string().optional(),
  title: z.string().optional(),
  instrumental: z.boolean().optional(),
  vocalGender: z.enum(["Male", "Female"]).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdness: z.number().min(0).max(1).optional(),
  variety: z.enum(["off", "normal", "high", "extra", "max"]).optional(),
  maxMode: z.boolean().optional(),
  duration: z.number().finite().optional(),
  audioFormat: z.enum(["mp3", "m4a", "wav"]).optional(),
  negativeTags: z.string().optional(),
  autoLyrics: z.boolean().optional(),
});
export type SunoSettings = z.infer<typeof sunoSettingsSchema>;
export type SunoInput = { model: string; suno?: SunoSettings; text?: string };
export function sunoPrompt(settings: SunoSettings = {}) {
  return settings.custom ? settings.instrumental ? "" : settings.lyrics || "" : settings.description || "";
}
export function buildSunoRequest(input: SunoInput): Record<string, unknown> {
  const model = SUNO_MODELS.find(m => m.id === input.model);
  if (!model) throw new Error("不支持的 Suno 模型");
  const s = sunoSettingsSchema.parse(input.suno || {});
  const custom = Boolean(s.custom), instrumental = Boolean(s.instrumental);
  const prompt = (custom && instrumental ? "" : input.text ?? sunoPrompt(s)).trim();
  if (!(custom && instrumental) && !prompt) throw new Error(custom ? "请输入歌词" : "请输入歌曲描述");
  if ([...prompt].length > (custom ? 5000 : 3000)) throw new Error(custom ? "歌词最多 5000 个字符" : "歌曲描述最多 3000 个字符");
  if (custom) {
    if ([...(s.title || "")].length > 80) throw new Error("歌曲标题最多 80 个字符");
    if ([...(s.style || "")].length > 1000) throw new Error("音乐风格最多 1000 个字符");
    if (s.duration !== undefined && (!Number.isInteger(s.duration) || s.duration < 10 || s.duration > 360)) throw new Error("目标时长应为 10–360 秒的整数");
  }
  return {
    model: "suno", version: model.version, custom, instrumental,
    ...(prompt ? { prompt } : {}),
    ...(custom ? {
      ...(s.title?.trim() ? { title: s.title.trim() } : {}),
      ...(s.style?.trim() ? { style: s.style.trim() } : {}),
      ...(s.negativeTags?.trim() ? { negative_tags: s.negativeTags.trim() } : {}),
      ...(!instrumental && s.autoLyrics !== undefined ? { auto_lyrics: s.autoLyrics } : {}),
      ...(s.duration !== undefined ? { duration: s.duration } : {}),
      ...(s.maxMode ? { max_mode: true } : {}),
    } : {}),
    ...(!instrumental && s.vocalGender ? { vocal_gender: s.vocalGender } : {}),
    ...(s.styleWeight !== undefined ? { style_weight: s.styleWeight } : {}),
    ...(s.weirdness !== undefined ? { weirdness_constraint: s.weirdness } : {}),
    ...(s.variety ? { variety: s.variety } : {}),
    ...(s.audioFormat ? { audio_format: s.audioFormat } : {}),
  };
}

export const sunoTrackSchema = z.object({
  audioIndex: z.number().int().positive(),
  taskId: z.string().optional(),
  title: z.string().optional(),
  lyrics: z.string().optional(),
  tags: z.string().optional(),
  coverUrl: z.string().optional(),
  durationSeconds: z.number().finite().nonnegative().optional(),
});
export type SunoTrack = z.infer<typeof sunoTrackSchema>;
export function parseSunoTask(raw: any) {
  const data = raw?.data || raw;
  const state = String(data?.status || "unknown");
  if (state === "failed") return { kind: "failed" as const, providerStatus: state, message: String(data?.error?.message || "Suno 音乐生成失败") };
  if (state !== "completed") return { kind: "pending" as const, providerStatus: state };
  const music: any[] = Array.isArray(data?.result?.music) ? data.result.music : [];
  if (!music.length || music.some(t => !/^https?:\/\//i.test(String(t?.audio_url || "")))) return { kind: "failed" as const, providerStatus: state, message: "Suno 已完成，但返回的音轨不完整" };
  const sunoTracks: SunoTrack[] = music.map((t, index) => ({
    audioIndex: index + 1, taskId: data.id,
    title: typeof t.title === "string" ? t.title : undefined,
    lyrics: typeof t.lyrics === "string" ? t.lyrics : undefined,
    tags: typeof t.display_tags === "string" ? t.display_tags : typeof t.tags === "string" ? t.tags : undefined,
    coverUrl: typeof t.image_url === "string" ? t.image_url : undefined,
    durationSeconds: typeof t.duration === "number" && Number.isFinite(t.duration) && t.duration >= 0 ? t.duration : undefined,
  }));
  return { kind: "done" as const, providerStatus: state, urls: music.map(t => String(t.audio_url)),
    providerUsage: { cost: data.cost ?? null, credits_cost: data.credits_cost ?? null },
    templatePatch: { sunoTracks, durationSeconds: sunoTracks[0].durationSeconds } };
}
