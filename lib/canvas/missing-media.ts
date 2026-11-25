import type { CanvasDocumentV2 } from "@/lib/canvas/document";

function normalizeUploadUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0] || "";
  }
  const index = pathname.indexOf("/uploads/");
  return index >= 0 ? pathname.slice(index) : "";
}

export function removeCanvasMissingMediaNodes(document: CanvasDocumentV2, urls: readonly string[]) {
  const missingUrls = new Set(urls.map(normalizeUploadUrl).filter(Boolean));
  if (!missingUrls.size) return document;
  const removedNodeIds = new Set(document.nodes
    .filter((node) => (
      (node.data.kind === "image" || node.data.kind === "video" || node.data.kind === "audio")
      && missingUrls.has(normalizeUploadUrl(node.data.url))
    ))
    .map((node) => node.id));
  if (!removedNodeIds.size) return document;
  return {
    ...document,
    nodes: document.nodes.filter((node) => !removedNodeIds.has(node.id)),
    edges: document.edges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)),
  };
}
