import { describe, expect, it } from "vitest";
import { buildSunoRequest, SUNO_MODELS, parseSunoTask } from "@/lib/suno-models";

describe("APIMart Suno current generation contract", () => {
  it.each(SUNO_MODELS)("maps $version without sending speech fields", ({ id, version }) => {
    const request = buildSunoRequest({ model: id, suno: { description: "温暖的钢琴配乐" } });
    expect(request).toEqual({ model: "suno", version, custom: false, instrumental: false, prompt: "温暖的钢琴配乐" });
    for (const field of ["n", "voice_id", "speed", "style", "title", "duration", "max_mode", "audio_urls"]) expect(request).not.toHaveProperty(field);
  });
  it("keeps descriptions separate from lyrics and omits inactive custom parameters", () => {
    expect(buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { description: "描述", lyrics: "歌词", style: "pop", title: "标题", duration: 30, maxMode: true } })).toEqual({ model: "suno", version: "v6", custom: false, instrumental: false, prompt: "描述" });
  });
  it("sends exact custom fields and preserves zero weights", () => {
    expect(buildSunoRequest({ model: SUNO_MODELS[1].id, suno: { custom: true, lyrics: "[Verse]\n雨夜", style: "pop", title: "雨", vocalGender: "Female", styleWeight: 0, weirdness: 0, variety: "max", maxMode: true, duration: 360, audioFormat: "wav", autoLyrics: true, negativeTags: "metal" } })).toEqual({ model: "suno", version: "v6-wild", custom: true, instrumental: false, prompt: "[Verse]\n雨夜", style: "pop", title: "雨", vocal_gender: "Female", style_weight: 0, weirdness_constraint: 0, variety: "max", max_mode: true, duration: 360, audio_format: "wav", auto_lyrics: true, negative_tags: "metal" });
  });
  it("allows custom instrumental without lyrics and omits vocal controls", () => {
    const body = buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { custom: true, instrumental: true, lyrics: "保留草稿", style: "piano", vocalGender: "Male", autoLyrics: true } });
    expect(body).toMatchObject({ custom: true, instrumental: true, style: "piano" });
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("vocal_gender");
    expect(body).not.toHaveProperty("auto_lyrics");
  });
  it("validates Unicode character boundaries and custom duration", () => {
    expect(() => buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { description: "🎵".repeat(3000) } })).not.toThrow();
    expect(() => buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { description: "🎵".repeat(3001) } })).toThrow();
    for (const duration of [9, 361, 20.5]) expect(() => buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { custom: true, instrumental: true, duration } })).toThrow();
    expect(() => buildSunoRequest({ model: "unknown", suno: { description: "音乐" } })).toThrow();
    expect(() => buildSunoRequest({ model: SUNO_MODELS[0].id, suno: { custom: true } })).toThrow();
  });
  it("retains all tracks and original one-based indices, even duplicate URLs", () => {
    const result = parseSunoTask({ data: { status: "completed", credits_cost: 0.5, result: { music: [
      { title: "一", audio_url: "https://cdn.test/a", duration: 12.5 },
      { title: "二", audio_url: "https://cdn.test/a", duration: 14 },
      { title: "三", audio_url: "https://cdn.test/c", lyrics: "歌词" },
    ] } } });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.urls).toHaveLength(3);
    expect(result.templatePatch.sunoTracks.map(t => t.audioIndex)).toEqual([1, 2, 3]);
    expect(result.templatePatch.sunoTracks[0].durationSeconds).toBe(12.5);
  });
  it("unknown remains pending; completed without music is invalid", () => {
    expect(parseSunoTask({ data: { status: "unknown" } })).toMatchObject({ kind: "pending", providerStatus: "unknown" });
    expect(parseSunoTask({ data: { status: "completed", result: { music: [] } } })).toMatchObject({ kind: "failed" });
  });
});
