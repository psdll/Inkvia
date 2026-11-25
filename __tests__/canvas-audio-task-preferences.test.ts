import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { applyCanvasTaskPreferences, readCanvasTaskPreferences, rememberCanvasTaskPreferences, restoreCanvasAudioModelPreference, writeCanvasTaskPreferences } from "@/lib/canvas/task-preferences";

type AudioTask = Extract<CanvasNodeData, { kind: "audioTask" }>;
const audio = (overrides: Partial<AudioTask> = {}): AudioTask => ({
  kind: "audioTask", model: "speech-2.8-hd", prompt: "当前文本", voiceId: "female-shaonv", voiceName: "少女音色",
  speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle", ...overrides,
});

describe("canvas audio preferences", () => {
  it("restores each model independently without copying text or results", () => {
    const hd = audio({ voiceId: "custom-voice", voiceName: "自定义", speed: 1.5, emotion: "happy", soundEffect: "robotic", outputUrl: "/old.mp3" });
    const turbo = audio({ model: "speech-2.8-turbo", volume: 2, modifyTimbre: 20 });
    const preferences = rememberCanvasTaskPreferences(rememberCanvasTaskPreferences({}, hd), turbo);
    expect(preferences.audio?.byModel[hd.model]).not.toHaveProperty("prompt");
    expect(preferences.audio?.byModel[hd.model]).not.toHaveProperty("outputUrl");
    expect(restoreCanvasAudioModelPreference(audio(), hd.model, preferences)).toMatchObject({ voiceId: "custom-voice", speed: 1.5, emotion: "happy", soundEffect: "robotic", prompt: "当前文本", status: "idle" });
    expect(restoreCanvasAudioModelPreference(hd, turbo.model, preferences)).toMatchObject({ speed: 1, volume: 2, modifyTimbre: 20, emotion: undefined, soundEffect: "" });
    expect(applyCanvasTaskPreferences(audio({ model: "" }), preferences)).toMatchObject({ model: turbo.model, volume: 2, modifyTimbre: 20 });
  });

  it("uses defaults for an unremembered model instead of leaking current settings", () => {
    expect(restoreCanvasAudioModelPreference(audio({ speed: 2, emotion: "angry", voiceId: "custom" }), "speech-2.8-turbo", {})).toMatchObject({ voiceId: "female-shaonv", speed: 1, emotion: undefined });
  });

  it("isolates browser storage by user and discards invalid values and unrelated fields", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writeCanvasTaskPreferences(storage, 1, rememberCanvasTaskPreferences({}, audio({ speed: 1.5 })));
    expect(readCanvasTaskPreferences(storage, 2)).toEqual({});
    expect(readCanvasTaskPreferences(storage, 1).audio?.byModel["speech-2.8-hd"].speed).toBe(1.5);
    storage.setItem("canvas_task_preferences_v2_1", JSON.stringify({ audio: { lastModel: "speech-2.8-hd", byModel: { "speech-2.8-hd": { speed: 99, pitch: 1.5, volume: 0, modifyPitch: 101, modifyIntensity: -101, modifyTimbre: 2.5, emotion: "invalid", soundEffect: "invalid", voiceName: "孤立名称", prompt: "不该保存", status: "running", voiceId: "custom" } } } }));
    const restored = restoreCanvasAudioModelPreference(audio(), "speech-2.8-hd", readCanvasTaskPreferences(storage, 1));
    expect(restored).toMatchObject({ speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, emotion: undefined, soundEffect: "", prompt: "当前文本", status: "idle" });
    expect(restoreCanvasAudioModelPreference(audio(), "unsupported", { audio: { byModel: { unsupported: { emotion: "happy" } } } }).emotion).toBeUndefined();
  });
});
