"use client";
import * as React from "react";
import type { CanvasNode } from "@/lib/canvas/document";
import { listCanvasCurrentMaterials } from "@/lib/canvas/current-materials";
import { warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates } from "@/lib/media-url";

const LIBRARY_PREVIEW_SIZE = { width: 120, height: 120 };
const LIBRARY_FIRST_SCREEN = 12;

export function useCanvasLibraryPreviewWarmup(nodes: CanvasNode[] | null | undefined) {
  const signature = React.useMemo(() => JSON.stringify(
    listCanvasCurrentMaterials(nodes || []).slice(0, LIBRARY_FIRST_SCREEN)
      .filter((item) => !item.temporary && item.kind !== "audio"
        && (item.kind === "image" || item.thumbnailUrl !== item.url)
        && !/^(blob:|data:)/.test(item.thumbnailUrl))
      .map((item) => item.thumbnailUrl),
  ), [nodes]);

  React.useEffect(() => {
    const urls: string[] = JSON.parse(signature);
    if (!urls.length) return;
    return warmResilientImageCandidatesBatch(
      [...new Set(urls)].map((url) => buildMediaPreviewCandidates(url, LIBRARY_PREVIEW_SIZE)),
      { limit: LIBRARY_FIRST_SCREEN, batchSize: 4 },
    );
  }, [signature]);
}

