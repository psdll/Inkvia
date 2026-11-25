import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMiniMaxVoiceCacheForTests,
  getCachedMiniMaxVoices,
  invalidateMiniMaxVoiceCache,
} from "@/lib/minimax-voice-cache";
import type { MiniMaxVoice } from "@/lib/minimax-speech";

function voice(id: string): MiniMaxVoice {
  return {
    id,
    name: id,
    description: "",
    source: "system",
    gender: "unknown",
    age: "unknown",
  };
}

describe("MiniMax voice catalog cache", () => {
  beforeEach(() => clearMiniMaxVoiceCacheForTests());

  it("does not restore a deleted voice from an in-flight stale refresh", async () => {
    await getCachedMiniMaxVoices({ scopeKey: "scope-a", load: async () => [voice("deleted")], now: 1000 });
    let resolveOld!: (voices: MiniMaxVoice[]) => void;
    const old = new Promise<MiniMaxVoice[]>(resolve => { resolveOld = resolve; });
    await getCachedMiniMaxVoices({ scopeKey: "scope-a", load: () => old, now: 301001 });
    invalidateMiniMaxVoiceCache("scope-a");
    await getCachedMiniMaxVoices({ scopeKey: "scope-a", load: async () => [], now: 302000 });
    resolveOld([voice("deleted")]);
    await old;
    const result = await getCachedMiniMaxVoices({ scopeKey: "scope-a", load: async () => [], now: 303000 });
    expect(result.voices).toEqual([]);
  });

  it("deduplicates fresh requests inside one provider scope", async () => {
    const load = vi.fn().mockResolvedValue([voice("voice-a")]);
    const first = await getCachedMiniMaxVoices({
      scopeKey: "scope-a",
      load,
      now: 1_000,
    });
    const second = await getCachedMiniMaxVoices({
      scopeKey: "scope-a",
      load,
      now: 2_000,
    });
    expect(first).toMatchObject({
      stale: false,
      voices: [expect.objectContaining({ id: "voice-a" })],
    });
    expect(second.voices).toEqual(first.voices);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves retained data when a blocking refresh fails", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([voice("voice-a")])
      .mockRejectedValueOnce(new Error("upstream unavailable"));
    await getCachedMiniMaxVoices({ scopeKey: "scope-a", load, now: 1_000 });
    const result = await getCachedMiniMaxVoices({
      scopeKey: "scope-a",
      load,
      now: 3_700_001,
    });
    expect(result).toMatchObject({
      stale: true,
      voices: [expect.objectContaining({ id: "voice-a" })],
    });
  });

  it("does not share voices across provider scopes", async () => {
    const a = await getCachedMiniMaxVoices({
      scopeKey: "scope-a",
      load: async () => [voice("voice-a")],
      now: 1_000,
    });
    const b = await getCachedMiniMaxVoices({
      scopeKey: "scope-b",
      load: async () => [voice("voice-b")],
      now: 1_000,
    });
    expect(a.voices.map((item) => item.id)).toEqual(["voice-a"]);
    expect(b.voices.map((item) => item.id)).toEqual(["voice-b"]);
  });
});
