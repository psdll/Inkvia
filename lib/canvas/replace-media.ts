import { getCanvasPrimaryImageOutput } from "./image-task";
import type { CanvasDocumentV2, CanvasMediaIdentity, CanvasNodeData } from "./document";
import { getCanvasMediaNodeSize } from "./media-size";

export type ReplacementMedia = CanvasMediaIdentity & { kind: "image" | "video" | "audio"; url: string; posterUrl?: string };

export function canvasReplacementTarget(data: CanvasNodeData, outputId?: string) {
  if (data.kind === "image" || data.kind === "video" || data.kind === "audio") return { kind: data.kind, url: data.url };
  if (data.kind === "imageTask") {
    const batch = data.task.batches.at(-1);
    const output = outputId ? batch?.outputs.find(item => item.id === outputId && item.status === "success" && item.url) : getCanvasPrimaryImageOutput(batch);
    if (output) return { kind: "image" as const, url: output.url!, outputId: output.id };
  }
  if ((data.kind === "videoTask" || data.kind === "audioTask") && data.status === "success" && data.outputUrl)
    return { kind: data.kind === "videoTask" ? "video" as const : "audio" as const, url: data.outputUrl };
  return null;
}

export function replaceCanvasMedia(document: CanvasDocumentV2, nodeId: string, media: ReplacementMedia, outputId?: string): CanvasDocumentV2 {
  const target = document.nodes.find(node => node.id === nodeId);
  if (!target) throw new Error("节点已删除，无法替换");
  const source = canvasReplacementTarget(target.data, outputId);
  if (!source || source.kind !== media.kind) throw new Error("只能替换相同类型的素材");
  const original = media.variants?.original;
  const size = original?.width && original?.height ? getCanvasMediaNodeSize(original.width, original.height) : undefined;
  return { ...document, nodes: document.nodes.map(node => {
    if (node.id !== nodeId) return node;
    if (node.data.kind === "imageTask") return { ...node, data: { ...node.data, task: { ...node.data.task,
      batches: node.data.task.batches.map(batch => ({ ...batch, outputs: batch.outputs.map(output => output.id === source.outputId
        ? { ...output, url: media.url, mediaId: media.mediaId, width: original?.width, height: original?.height, generationId: undefined, requestKey: undefined } : output) })) } } };
    if (node.data.kind === "videoTask" || node.data.kind === "audioTask") {
      const data = { ...node.data, outputUrl: media.url, generationId: undefined, requestKey: undefined };
      if (data.kind === "videoTask") { data.mediaId = media.mediaId; data.variants = media.variants || (media.posterUrl ? { poster: { url: media.posterUrl } } : undefined); }
      else { delete data.waveformPeaks; delete data.durationSeconds; delete data.audioOutputs; delete data.selectedAudioIndex; }
      return { ...node, data };
    }
    const data = { ...node.data, url: media.url, mediaId: media.mediaId, variants: media.variants };
    if (data.kind === "image") delete data.localPreview;
    if (data.kind === "video") data.posterUrl = media.posterUrl || media.variants?.poster?.url;
    if (data.kind === "audio") { delete data.waveformPeaks; delete data.durationSeconds; delete data.sunoTrack; }
    return { ...node, ...(media.kind !== "audio" ? size : undefined), data };
  }) };
}
