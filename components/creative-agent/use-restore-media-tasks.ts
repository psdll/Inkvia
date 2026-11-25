import * as React from "react";
import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { restoreCreativeAgentMediaTasks, type AgentMediaTaskRecovery } from "@/lib/creative-agent/restore-media-tasks";

export function useRestoreAgentMediaTasks(canvasId: number, document: CanvasDocumentV2, readOnly: boolean, current: React.MutableRefObject<CanvasDocumentV2>, commit: (document: CanvasDocumentV2) => void, arrangementPreview: React.MutableRefObject<unknown>) {
  const requests = React.useMemo(() => new Map<string, Promise<Partial<AgentMediaTaskRecovery> | null>>(), [canvasId]);
  const attempted = React.useMemo(() => new Set<string>(), [canvasId]);
  const candidates = JSON.stringify(document.nodes.flatMap(node => {
    const data = node.data;
    return (data.kind === "image" || data.kind === "video") && data.origin === "generated" && data.mediaId && data.url
      ? [{ nodeId: node.id, mediaId: data.mediaId, url: data.url }] : [];
  }));
  React.useEffect(() => {
    if (readOnly) return;
    let disposed = false;
    const items: Pick<AgentMediaTaskRecovery, "nodeId" | "mediaId" | "url">[] = JSON.parse(candidates).filter((item: unknown) => !attempted.has(JSON.stringify(item)));
    void Promise.all(items.map(async item => {
      if (!requests.has(item.mediaId)) requests.set(item.mediaId,
        fetch(`/api/canvas/media/${encodeURIComponent(item.mediaId)}?generation=1`)
          .then(response => response.ok ? response.json() : null).catch(() => null));
      const result = await requests.get(item.mediaId);
      return result?.generationTask && result.generationCanvasId === canvasId ? { ...item, generationTask: result.generationTask, generationCanvasId: canvasId } : null;
    })).then(results => {
      if (disposed || arrangementPreview.current) return;
      items.forEach(item => attempted.add(JSON.stringify(item)));
      const next = restoreCreativeAgentMediaTasks(current.current, canvasId, results.filter((item): item is AgentMediaTaskRecovery => Boolean(item)));
      if (next !== current.current) commit(next);
    });
    return () => { disposed = true; };
  }, [canvasId, candidates, readOnly, current, commit, arrangementPreview, requests, attempted]);
}
