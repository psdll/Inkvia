"use client";

import { canvasObserverUrl } from "./CanvasReadOnlyContext";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { personalMaterialPreviewUrl, type PersonalLibrary } from "@/lib/canvas/personal-library-types";

export type LibraryItem = { id: string; url: string; thumbnailUrl: string; kind: "image" | "video" | "audio" | "file"; name: string; folder: string };
export type WorkflowLibrary = { folders: string[]; items: LibraryItem[] };
const policy = { staleTime: 30_000, gcTime: 15 * 60_000 };

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(payload.error || "素材库读取失败");
  return payload;
}

export function personalLibraryOptions(ownerId: number, adminKey?: string) {
  return {
    ...policy, queryKey: ["canvas-library", ownerId, "personal"] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await read<{ library: PersonalLibrary }>(canvasObserverUrl("/api/canvas/materials", adminKey), signal)).library,
  };
}

export function workflowLibraryOptions(ownerId: number) {
  return {
    ...policy, queryKey: ["canvas-library", ownerId, "workflow"] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<WorkflowLibrary> => {
      const [folders, items] = await Promise.all([
        read<{ folders: string[] }>("/api/canvas/library/folders", signal),
        read<{ items: LibraryItem[] }>("/api/canvas/library", signal),
      ]);
      return { folders: folders.folders, items: items.items };
    },
  };
}

// Use the app's QueryClient and bounded image hotspot pool, after the canvas's first frame.
export function useCanvasLibraryCacheWarmup(ownerId: number | undefined, enabled: boolean) {
  const client = useQueryClient();
  React.useEffect(() => {
    if (!ownerId) return;
    const personalChanged = () => { void client.invalidateQueries({ queryKey: personalLibraryOptions(ownerId).queryKey }); };
    const workflowChanged = () => { void client.invalidateQueries({ queryKey: workflowLibraryOptions(ownerId).queryKey }); };
    const logout = () => client.removeQueries({ queryKey: ["canvas-library", ownerId] });
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("canvas-personal-library") : null;
    if (channel) channel.onmessage = personalChanged;
    window.addEventListener("canvas-library-changed", workflowChanged);
    window.addEventListener("auth:logout", logout);
    return () => { channel?.close(); window.removeEventListener("canvas-library-changed", workflowChanged); window.removeEventListener("auth:logout", logout); };
  }, [client, ownerId]);
  React.useEffect(() => {
    if (!ownerId || !enabled) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void client.fetchQuery(personalLibraryOptions(ownerId)).then(library => {
      if (disposed) return;
      stop = warmResilientImageCandidatesBatch(library.items.filter(item => item.kind === "image").slice(0, 12)
        .map(item => [personalMaterialPreviewUrl(item.id, ownerId, 120)]), { limit: 12, batchSize: 4 });
    }).catch(() => {});
    void client.prefetchQuery(workflowLibraryOptions(ownerId));
    return () => { disposed = true; stop?.(); };
  }, [client, ownerId, enabled]);
}
