import type { CanvasDocumentV2 } from "@/lib/canvas/document";

export type CanvasTextReference = { id: string; sourceNodeId: string; name: string; content: string };

export function collectCanvasTextReferences(document: CanvasDocumentV2, nodeId: string, includeEmpty = false): CanvasTextReference[] {
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  return document.edges.flatMap(edge => {
    if (edge.target !== nodeId || seen.has(edge.source)) return [];
    seen.add(edge.source);
    const node = nodes.get(edge.source);
    if (!node || (node.data.kind !== "prompt" && node.data.kind !== "llm")) return [];
    const content = (node.data.kind === "prompt" ? node.data.text : node.data.output)?.trim() || "";
    if (!includeEmpty && !content) return [];
    return [{ id: node.id, sourceNodeId: node.id, name: node.data.title || (node.data.kind === "prompt" ? "文本参考" : "生成文本"), content }];
  });
}

// Canvas requests keep references separate. Providers accepting one prompt are
// adapted on the server, preserving the existing instruction/reference order.
export function composeCanvasModelPrompt(prompt: string, textList: unknown): string {
  const references = Array.isArray(textList) ? textList.filter((text): text is string => typeof text === "string").map(text => text.trim()).filter(Boolean) : [];
  return [prompt.trim(), ...references].filter(Boolean).join("");
}
