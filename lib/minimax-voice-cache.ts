import "server-only";

import type { MiniMaxVoice } from "@/lib/minimax-speech";

const FRESH_MS = 5 * 60 * 1_000;
const RETAIN_MS = 60 * 60 * 1_000;

type Entry = {
  voices: MiniMaxVoice[];
  fetchedAt: number;
  pending?: Promise<MiniMaxVoice[]>;
};

const entries = new Map<string, Entry>();

function beginLoad(
  scopeKey: string,
  load: () => Promise<MiniMaxVoice[]>,
  now: number,
) {
  const previous = entries.get(scopeKey);
  if (previous?.pending) return previous.pending;
  const pending = load()
    .then((voices) => {
      if (entries.get(scopeKey)?.pending === pending) {
        entries.set(scopeKey, { voices, fetchedAt: now });
      }
      return voices;
    })
    .finally(() => {
      const current = entries.get(scopeKey);
      if (current?.pending === pending) {
        entries.set(scopeKey, {
          voices: current.voices,
          fetchedAt: current.fetchedAt,
        });
      }
    });
  entries.set(scopeKey, {
    voices: previous?.voices || [],
    fetchedAt: previous?.fetchedAt || 0,
    pending,
  });
  return pending;
}

export async function getCachedMiniMaxVoices(input: {
  scopeKey: string;
  load: () => Promise<MiniMaxVoice[]>;
  now?: number;
}): Promise<{ voices: MiniMaxVoice[]; stale: boolean; fetchedAt: number }> {
  const now = input.now ?? Date.now();
  const current = entries.get(input.scopeKey);
  const age = current ? now - current.fetchedAt : Number.POSITIVE_INFINITY;

  if (current && current.fetchedAt > 0 && age <= FRESH_MS) {
    return {
      voices: current.voices,
      stale: false,
      fetchedAt: current.fetchedAt,
    };
  }

  if (current && current.fetchedAt > 0 && age <= RETAIN_MS) {
    if (!current.pending) {
      void beginLoad(input.scopeKey, input.load, now).catch(() => undefined);
    }
    return {
      voices: current.voices,
      stale: true,
      fetchedAt: current.fetchedAt,
    };
  }

  try {
    await beginLoad(input.scopeKey, input.load, now);
    const refreshed = entries.get(input.scopeKey);
    if (!refreshed) throw new Error("MiniMax 音色缓存刷新失败");
    return {
      voices: refreshed.voices,
      stale: false,
      fetchedAt: refreshed.fetchedAt,
    };
  } catch (error) {
    const retained = entries.get(input.scopeKey);
    if (retained && retained.fetchedAt > 0) {
      return {
        voices: retained.voices,
        stale: true,
        fetchedAt: retained.fetchedAt,
      };
    }
    throw error;
  }
}

export function invalidateMiniMaxVoiceCache(scopeKey: string) {
  entries.delete(scopeKey);
}

export function clearMiniMaxVoiceCacheForTests() {
  entries.clear();
}
