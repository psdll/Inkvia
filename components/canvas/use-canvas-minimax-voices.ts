"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  MINIMAX_VERIFIED_VOICE_SEED,
  inferCanvasVoiceMetadata,
  type CanvasMiniMaxVoice,
} from "@/lib/canvas/minimax-voice-library";

export const canvasMiniMaxVoicesQueryKey = [
  "canvas",
  "speech",
  "minimax",
  "voices",
] as const;
export const canvasVoiceFavoritesQueryKey = [
  "canvas",
  "speech",
  "minimax",
  "favorites",
] as const;

export type CanvasMiniMaxVoiceEnvelope = {
  voices: CanvasMiniMaxVoice[];
  stale: boolean;
};

function errorMessage(payload: unknown, fallback: string) {
  return String((payload as { error?: unknown } | null)?.error || fallback);
}

export async function fetchCanvasMiniMaxVoices(
  request: typeof fetch = fetch,
): Promise<CanvasMiniMaxVoiceEnvelope> {
  const response = await request("/api/canvas/speech/voices", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(errorMessage(payload, "音色加载失败"));
  }
  const voices = Array.isArray(payload.voices)
    ? payload.voices
        .filter((voice: unknown) =>
          Boolean((voice as { id?: unknown } | null)?.id),
        )
        .map((voice: CanvasMiniMaxVoice) => inferCanvasVoiceMetadata(voice))
    : [];
  return { voices, stale: Boolean(payload.stale) };
}

export async function fetchCanvasVoiceFavorites(
  request: typeof fetch = fetch,
): Promise<string[]> {
  const response = await request("/api/canvas/speech/favorites", {
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(errorMessage(payload, "音色收藏读取失败"));
  }
  return Array.isArray(payload.voiceIds)
    ? payload.voiceIds.map(String).filter(Boolean)
    : [];
}

function voiceQueryOptions() {
  return {
    queryKey: canvasMiniMaxVoicesQueryKey,
    queryFn: () => fetchCanvasMiniMaxVoices(),
    staleTime: 5 * 60 * 1_000,
    gcTime: 60 * 60 * 1_000,
    refetchOnWindowFocus: false,
  } as const;
}

function favoriteQueryOptions() {
  return {
    queryKey: canvasVoiceFavoritesQueryKey,
    queryFn: () => fetchCanvasVoiceFavorites(),
    staleTime: 30 * 1_000,
    gcTime: 60 * 60 * 1_000,
    refetchOnWindowFocus: false,
  } as const;
}

export function useCanvasMiniMaxVoiceLibrary() {
  const queryClient = useQueryClient();
  const voiceQuery = useQuery({
    ...voiceQueryOptions(),
    initialData: { voices: MINIMAX_VERIFIED_VOICE_SEED, stale: true },
    initialDataUpdatedAt: 0,
  });
  const favoriteQuery = useQuery({
    ...favoriteQueryOptions(),
    initialData: [] as string[],
    initialDataUpdatedAt: 0,
  });
  const favoriteMutation = useMutation({
    mutationFn: async (input: { voiceId: string; favorite: boolean }) => {
      const response = await fetch("/api/canvas/speech/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(errorMessage(payload, "音色收藏更新失败"));
      }
      return input;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: canvasVoiceFavoritesQueryKey });
      const previous =
        queryClient.getQueryData<string[]>(canvasVoiceFavoritesQueryKey) || [];
      const next = new Set(previous);
      if (input.favorite) next.add(input.voiceId);
      else next.delete(input.voiceId);
      queryClient.setQueryData(canvasVoiceFavoritesQueryKey, [...next]);
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          canvasVoiceFavoritesQueryKey,
          context.previous,
        );
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: canvasVoiceFavoritesQueryKey }),
  });
  const errors = [voiceQuery.error, favoriteQuery.error, favoriteMutation.error]
    .filter((value): value is Error => value instanceof Error)
    .map((value) => value.message);

  return {
    voices: voiceQuery.data.voices,
    favoriteIds: new Set(favoriteQuery.data),
    errorMessage: errors[0] || "",
    refetchVoices: voiceQuery.refetch,
    deleteVoice: async (voiceId: string) => {
      const response = await fetch("/api/canvas/speech/voices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(errorMessage(payload, "音色删除失败"));
      }
      await queryClient.cancelQueries({ queryKey: canvasMiniMaxVoicesQueryKey });
      await queryClient.cancelQueries({ queryKey: canvasVoiceFavoritesQueryKey });
      queryClient.setQueryData<CanvasMiniMaxVoiceEnvelope>(canvasMiniMaxVoicesQueryKey, (previous) =>
        previous ? { ...previous, voices: previous.voices.filter(voice => voice.id !== voiceId) } : previous,
      );
      queryClient.setQueryData<string[]>(canvasVoiceFavoritesQueryKey, (previous) =>
        previous?.filter(id => id !== voiceId),
      );
    },
    renameVoice: async (voiceId: string, name: string) => {
      const response = await fetch("/api/canvas/speech/voices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId, name }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(errorMessage(payload, "音色改名失败"));
      }
      queryClient.setQueryData<CanvasMiniMaxVoiceEnvelope>(canvasMiniMaxVoicesQueryKey, (previous) =>
        previous ? { ...previous, voices: previous.voices.map(voice =>
          voice.id === voiceId ? { ...voice, name: payload.name } : voice,
        ) } : previous,
      );
    },
    setFavorite: (voiceId: string, favorite: boolean) =>
      favoriteMutation.mutateAsync({ voiceId, favorite }),
  };
}

export function useCanvasMiniMaxVoiceWarmup(enabled: boolean) {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    if (!enabled) return;
    void queryClient.prefetchQuery(voiceQueryOptions());
    void queryClient.prefetchQuery(favoriteQueryOptions());
  }, [enabled, queryClient]);
}
