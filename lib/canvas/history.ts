import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { preserveCanvasTaskExecutions } from "@/lib/canvas/task-history";

export type CanvasHistory = {
  past: CanvasDocumentV2[];
  future: CanvasDocumentV2[];
  present: CanvasDocumentV2;
  limit: number;
};

export function createCanvasHistory(present: CanvasDocumentV2, limit = 50): CanvasHistory {
  return { past: [], future: [], present, limit: Math.max(1, limit) };
}

export function pushCanvasHistory(history: CanvasHistory, present: CanvasDocumentV2): CanvasHistory {
  if (history.present === present) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    future: [],
    present,
  };
}

export function replaceCanvasHistoryPresent(
  history: CanvasHistory,
  present: CanvasDocumentV2,
): CanvasHistory {
  return history.present === present ? history : { ...history, present, future: [] };
}

export function undoCanvasHistory(history: CanvasHistory): CanvasHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future].slice(0, history.limit),
    present: preserveCanvasTaskExecutions(previous, history.present),
  };
}

export function redoCanvasHistory(history: CanvasHistory): CanvasHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: preserveCanvasTaskExecutions(next, history.present),
    future: history.future.slice(1),
  };
}
