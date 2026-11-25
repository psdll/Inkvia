import type { CanvasDocumentV2, CanvasNodeData } from "@/lib/canvas/document";

export function getCanvasTextNodeTitle(document: CanvasDocumentV2, nodeId: string): string {
  const nodes = document.nodes.filter(node => node.data.kind === "llm" || node.data.kind === "prompt");
  const node = nodes.find(node => node.id === nodeId);
  return (node?.data.kind === "prompt" || node?.data.kind === "llm") && node.data.title
    ? node.data.title
    : `文本节点 ${Math.max(1, nodes.findIndex(node => node.id === nodeId) + 1)}`;
}

export function getCanvasTextTaskFrameSize(data: Extract<CanvasNodeData, { kind: "llm" }>) {
  return data.output !== undefined && data.resultFrameSize
    ? data.resultFrameSize
    : { width: 350, height: !data.output && !data.error && data.status === "idle" ? 350 : 200 };
}

export function startCanvasTextWriting(document: CanvasDocumentV2, nodeId: string): CanvasDocumentV2 {
  const node = document.nodes.find(candidate => candidate.id === nodeId);
  if (node?.data.kind !== "llm" || node.data.status === "running" || node.data.status === "submitting") return document;
  const text = node.data.output || "";
  return {
    ...document,
    nodes: document.nodes.map(candidate => candidate.id === nodeId ? {
      ...node, type: "prompt", width: 350, height: 200,
      data: { kind: "prompt", text, title: getCanvasTextNodeTitle(document, nodeId), format: "markdown" },
    } : candidate),
  };
}
