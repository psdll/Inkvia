import type { CanvasNodeData } from "./document";

/** Only actual visual results can replace a node with a thumbnail. */
export function hasCanvasThumbnailContent(data: CanvasNodeData): boolean {
  switch (data.kind) {
    case "image": case "video": return Boolean(data.url);
    case "imageTask": {
      const outputs = data.task.batches.at(-1)?.outputs ?? [];
      return !outputs.some(output => output.status === "running" || output.status === "submitting")
        && outputs.some(output => output.status === "success" && output.url);
    }
    case "videoTask": return data.status === "success" && Boolean(data.outputUrl);
    case "audio": case "audioTask": case "prompt": case "llm":
    case "group": case "loop": case "compare": case "breakdown": return false;
    default: { const exhaustive: never = data; return exhaustive; }
  }
}
