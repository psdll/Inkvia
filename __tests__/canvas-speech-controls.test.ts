import { describe, expect, it } from "vitest";
import { buildMiniMaxSpeechRequest, getMiniMaxSpeechCapabilities, type MiniMaxSpeechSettings } from "@/lib/minimax-speech-models";
import { speechTextToDoc, speechDocToText, formatSpeechPause } from "@/lib/canvas/speech-prompt";

const settings: MiniMaxSpeechSettings = {
  model: "speech-2.8-hd", text: "你好<#0.25#>世界(laughs)", voiceId: "female-shaonv",
  speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "",
};

describe("speech controls and provider contract", () => {
  it("round-trips paragraph breaks and supported tokens without changing API syntax", () => {
    const text = "你好<#0.25#>世界(laughs)\n\n第二段 (普通文字)";
    const doc = speechTextToDoc(text, settings.model);
    expect(doc.content?.[0].content?.filter((node) => node.type === "speechToken")).toHaveLength(2);
    expect(speechDocToText(doc)).toBe(text);
    expect(speechDocToText(speechTextToDoc("<script>alert(1)</script>", settings.model))).toBe("<script>alert(1)</script>");
  });

  it("does not render unsupported models or unknown words as interactive tokens", () => {
    expect(getMiniMaxSpeechCapabilities("other-model").interjections).toHaveLength(0);
    expect(getMiniMaxSpeechCapabilities("other-model").pause).toBe(false);
    expect(speechTextToDoc("你好<#1#>(laughs)", "other-model").content?.[0].content).toEqual([{ type: "text", text: "你好<#1#>(laughs)" }]);
    expect(speechTextToDoc("(whistles)", settings.model).content?.[0].content).toEqual([{ type: "text", text: "(whistles)" }]);
  });

  it.each([0.25, 0.5, 1, 1.5, 0.01, 99.99])("formats a valid %s second pause", (seconds) => {
    expect(formatSpeechPause(seconds)).toBe(`<#${seconds}#>`);
  });
  it.each([0, -1, 100, 0.001, NaN])("rejects invalid custom pause %s", (seconds) => {
    expect(() => formatSpeechPause(seconds)).toThrow("停顿");
  });

  it("sends emotion in voice_setting and keeps inline tokens in text", () => {
    const request = buildMiniMaxSpeechRequest({ ...settings, emotion: "happy" });
    expect(request.body.voice_setting).toMatchObject({ emotion: "happy", speed: 1 });
    expect(request.body.text).toBe(settings.text);
    expect(buildMiniMaxSpeechRequest(settings).body.voice_setting).not.toHaveProperty("emotion");
  });
  it.each(["whisper", "fluent", "invalid"])("rejects unsupported 2.8 emotion %s", (emotion) => {
    expect(() => buildMiniMaxSpeechRequest({ ...settings, emotion } as MiniMaxSpeechSettings)).toThrow("情绪");
  });
  it.each(["<#1#>你好", "你好<#1#>", "你好<#1#> <#0.5#>世界", "你好<#100#>世界", "你好<#0.001#>世界"])("rejects unusable pause syntax: %s", (text) => {
    expect(() => buildMiniMaxSpeechRequest({ ...settings, text })).toThrow("停顿");
  });
});
