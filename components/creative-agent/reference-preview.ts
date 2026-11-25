import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { getCanvasPrimaryImageOutput } from "@/lib/canvas/image-task";
import type { CreativeAgentReference } from "@/lib/creative-agent/contracts";

export type ReferencePreview = {
  kind: "image" | "video" | "audio" | "text";
  url?: string;
  thumbnailUrl?: string;
  text?: string;
};

export function getReferencePreview(document: Pick<CanvasDocumentV2, "nodes" | "edges">, reference: CreativeAgentReference): ReferencePreview | undefined {
  const data = document.nodes.find(node => node.id === reference.nodeId)?.data;
  if (!data) return;
  if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
    return { kind: data.kind, url: data.url, thumbnailUrl: data.variants?.thumbnail?.url || data.variants?.poster?.url || (data.kind === "video" ? data.posterUrl : undefined) };
  }
  if (data.kind === "prompt") return { kind: "text", text: data.text };
  if (data.kind === "llm") return { kind: "text", text: data.output || data.prompt };
  if (data.kind === "compare") return { kind: "image", url: data.beforeUrl || data.afterUrl };
  if (data.kind === "imageTask") {
    const batch = reference.batchId ? data.task.batches.find(item => item.id === reference.batchId)
      : [...data.task.batches].reverse().find(item => getCanvasPrimaryImageOutput(item));
    const output = reference.outputId ? batch?.outputs.find(item => item.id === reference.outputId && item.status === "success") : getCanvasPrimaryImageOutput(batch);
    if (output?.url) return { kind: "image", url: output.url };
    if (reference.outputId) return;
  }
  if (data.kind === "videoTask" || data.kind === "audioTask") {
    if (reference.outputId && reference.outputId !== data.requestKey) return;
    if (data.outputUrl && data.status === "success") return { kind: data.kind === "videoTask" ? "video" : "audio", url: data.outputUrl };
    if (reference.outputId) return;
  }
}
