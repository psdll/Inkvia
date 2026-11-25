import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";

export const CANVAS_MAX_NODE_BYTES = 64 * 1024;
export const CANVAS_MAX_EDGE_BYTES = 4 * 1024;
export const CANVAS_MAX_TEXT_BYTES = 20 * 1024;
export const CANVAS_MAX_MARKDOWN_TEXT_BYTES = 256 * 1024;
export const CANVAS_MAX_MARKDOWN_NODE_BYTES = 512 * 1024;
/** A ten-minute film's 拉片 (150 shots); stays below one mutation request. */
export const CANVAS_MAX_BREAKDOWN_NODE_BYTES = 900 * 1024;
export const CANVAS_MAX_LABEL_BYTES = 512;
// Keep ordinary batches small while allowing one complete imported document.
export const CANVAS_MUTATION_BATCH_TARGET_BYTES = 64 * 1024;
export const CANVAS_MAX_MUTATION_BYTES = 1024 * 1024;
export const CANVAS_MAX_MUTATION_OPERATIONS = 100;
export const CANVAS_MAX_NODES = 10_000;
export const CANVAS_MAX_EDGES = 30_000;
export const CANVAS_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const CANVAS_MAX_JSON_DEPTH = 16;
export const CANVAS_MAX_MEDIA_REFERENCES = 32;
export const CANVAS_MAX_TAG_BYTES = 64;
export const CANVAS_MAX_TAGS_PER_NODE = 50;
export const CANVAS_MAX_WORLD_COORDINATE = 10_000_000;
export const CANVAS_MAX_NODE_DIMENSION = 100_000;

export class CanvasLimitError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasLimitError";
  }
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : utf8ByteLength(serialized);
}

function assertJsonDepth(value: unknown, depth = 0): void {
  if (depth > CANVAS_MAX_JSON_DEPTH) {
    throw new CanvasLimitError("JSON_DEPTH_LIMIT", `JSON nesting exceeds ${CANVAS_MAX_JSON_DEPTH}`);
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) assertJsonDepth(item, depth + 1);
}

function validateStrings(value: unknown, path = "node", markdown = false): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateStrings(item, `${path}[${index}]`, markdown));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (typeof item === "string") {
      const bytes = utf8ByteLength(item);
      const textLimit = markdown && nextPath === "node.data.text" ? CANVAS_MAX_MARKDOWN_TEXT_BYTES : CANVAS_MAX_TEXT_BYTES;
      if ((key === "prompt" || key === "system" || key === "text") && bytes > textLimit) {
        throw new CanvasLimitError("TEXT_BYTE_LIMIT", `${nextPath} exceeds ${textLimit} bytes`);
      }
      if ((key === "title" || key === "name") && bytes > CANVAS_MAX_LABEL_BYTES) {
        throw new CanvasLimitError("LABEL_BYTE_LIMIT", `${nextPath} exceeds ${CANVAS_MAX_LABEL_BYTES} bytes`);
      }
    } else {
      validateStrings(item, nextPath, markdown);
    }
  }
}

function validateReferenceCounts(node: CanvasNode): void {
  const data = node.data as unknown as Record<string, unknown>;
  const mediaPaths = data.mediaPaths;
  if (Array.isArray(mediaPaths) && mediaPaths.length > CANVAS_MAX_MEDIA_REFERENCES) {
    throw new CanvasLimitError("MEDIA_REFERENCE_LIMIT", `node ${node.id} exceeds ${CANVAS_MAX_MEDIA_REFERENCES} media references`);
  }
  const task = data.task;
  if (task && typeof task === "object") {
    const references = (task as Record<string, unknown>).references;
    if (Array.isArray(references) && references.length > CANVAS_MAX_MEDIA_REFERENCES) {
      throw new CanvasLimitError("MEDIA_REFERENCE_LIMIT", `node ${node.id} exceeds ${CANVAS_MAX_MEDIA_REFERENCES} media references`);
    }
  }
}

function validateTags(value: unknown, path = "data"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTags(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (key === "tags" && Array.isArray(item)) {
      if (item.length > CANVAS_MAX_TAGS_PER_NODE) {
        throw new CanvasLimitError("NODE_TAG_COUNT_LIMIT", `${nextPath} exceeds ${CANVAS_MAX_TAGS_PER_NODE} tags`);
      }
      item.forEach((tag, index) => {
        if (typeof tag === "string" && utf8ByteLength(tag) > CANVAS_MAX_TAG_BYTES) {
          throw new CanvasLimitError("NODE_TAG_BYTE_LIMIT", `${nextPath}[${index}] exceeds ${CANVAS_MAX_TAG_BYTES} bytes`);
        }
      });
    } else {
      validateTags(item, nextPath);
    }
  }
}

export function validateCanvasNodeBudget(node: CanvasNode): void {
  if (
    !Number.isFinite(node.position.x)
    || !Number.isFinite(node.position.y)
    || Math.abs(node.position.x) > CANVAS_MAX_WORLD_COORDINATE
    || Math.abs(node.position.y) > CANVAS_MAX_WORLD_COORDINATE
  ) {
    throw new CanvasLimitError("NODE_POSITION_LIMIT", `node ${node.id} position exceeds world bounds`);
  }
  for (const [dimension, value] of [["width", node.width], ["height", node.height]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > CANVAS_MAX_NODE_DIMENSION)) {
      throw new CanvasLimitError("NODE_SIZE_LIMIT", `node ${node.id} ${dimension} exceeds size bounds`);
    }
  }
  assertJsonDepth(node);
  const markdown = node.data.kind === "prompt" && node.data.format === "markdown";
  validateStrings(node, "node", markdown);
  validateReferenceCounts(node);
  validateTags(node.data);
  const bytes = serializedByteLength(node);
  // A long film's shot breakdown is a document too, like a Markdown note.
  const nodeLimit = node.data.kind === "breakdown" ? CANVAS_MAX_BREAKDOWN_NODE_BYTES : markdown ? CANVAS_MAX_MARKDOWN_NODE_BYTES : CANVAS_MAX_NODE_BYTES;
  if (bytes > nodeLimit) {
    throw new CanvasLimitError("NODE_BYTE_LIMIT", `node ${node.id} exceeds ${nodeLimit} bytes`);
  }
}

export function validateCanvasEdgeBudget(edge: CanvasEdge): void {
  assertJsonDepth(edge);
  const bytes = serializedByteLength(edge);
  if (bytes > CANVAS_MAX_EDGE_BYTES) {
    throw new CanvasLimitError("EDGE_BYTE_LIMIT", `edge ${edge.id} exceeds ${CANVAS_MAX_EDGE_BYTES} bytes`);
  }
}

export function validateCanvasDocumentBudget(document: CanvasDocumentV2): void {
  if (document.nodes.length > CANVAS_MAX_NODES) {
    throw new CanvasLimitError("CANVAS_NODE_LIMIT", `canvas exceeds ${CANVAS_MAX_NODES} nodes`);
  }
  if (document.edges.length > CANVAS_MAX_EDGES) {
    throw new CanvasLimitError("CANVAS_EDGE_LIMIT", `canvas exceeds ${CANVAS_MAX_EDGES} edges`);
  }
  assertJsonDepth(document);
  document.nodes.forEach(validateCanvasNodeBudget);
  document.edges.forEach(validateCanvasEdgeBudget);
  const bytes = serializedByteLength(document);
  if (bytes > CANVAS_MAX_DOCUMENT_BYTES) {
    throw new CanvasLimitError("DOCUMENT_BYTE_LIMIT", `canvas exceeds ${CANVAS_MAX_DOCUMENT_BYTES} bytes`);
  }
}
