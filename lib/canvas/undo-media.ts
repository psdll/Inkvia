import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import type { CanvasHistory } from "@/lib/canvas/history";
import { collectCanvasImportRefs } from "@/lib/canvas/import-refs";
import { collectCanvasNodeMediaIds } from "@/lib/canvas/media-references";

export type CanvasUndoMediaRef = {
  key: string;
  mediaId?: string;
  publicRef?: string;
};

export function collectCanvasDocumentUndoMediaRefs(
  document: CanvasDocumentV2,
): CanvasUndoMediaRef[] {
  const refs = new Map<string, CanvasUndoMediaRef>();
  for (const node of document.nodes) {
    for (const mediaId of collectCanvasNodeMediaIds(node)) {
      const key = `media:${mediaId}`;
      refs.set(key, { key, mediaId });
    }
  }
  for (const publicRef of collectCanvasImportRefs(document)) {
    const key = `url:${publicRef}`;
    refs.set(key, { key, publicRef });
  }
  return [...refs.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function collectCanvasHistoryUndoMediaRefs(
  history: CanvasHistory,
): CanvasUndoMediaRef[] {
  const currentKeys = new Set(
    collectCanvasDocumentUndoMediaRefs(history.present).map((ref) => ref.key),
  );
  const held = new Map<string, CanvasUndoMediaRef>();
  for (const snapshot of [...history.past, ...history.future]) {
    for (const ref of collectCanvasDocumentUndoMediaRefs(snapshot)) {
      if (!currentKeys.has(ref.key)) held.set(ref.key, ref);
    }
  }
  return [...held.values()].sort((left, right) => left.key.localeCompare(right.key));
}
