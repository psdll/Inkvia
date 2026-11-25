import { parseCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { canvasNodeWorldPosition } from "./spatial-index";
import { getCanvasLocalUploadPositions } from "./material-placement";
import { DEFAULT_CANVAS_MEDIA_NODE_SIZE } from "./media-size";

export const MAX_CANVAS_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_CANVAS_ARCHIVE_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_CANVAS_ARCHIVE_FILES = 2002;

/** A workflow carries configuration and completed results, not another canvas's jobs. */
export function detachWorkflowExecution(document: CanvasDocumentV2): CanvasDocumentV2 {
  const copy = structuredClone(document);
  for (const node of copy.nodes) {
    const data = node.data;
    if (data.kind === "imageTask") {
      data.task.batches = data.task.batches.map(batch => ({ ...batch, outputs: batch.outputs
        .filter(output => output.status === "success" && Boolean(output.url))
        .map(output => {
          const { generationId, requestKey, startedAt, finishedAt, error, ...result } = output;
          return result;
        }) })).filter(batch => batch.outputs.length > 0);
    } else if (data.kind === "videoTask" || data.kind === "audioTask") {
      delete data.generationId;
      delete data.requestKey;
      delete data.startedAt;
      delete data.finishedAt;
      delete data.error;
      if (data.status !== "success" || !data.outputUrl) {
        data.status = "idle";
        delete data.outputUrl;
        delete data.outputName;
        if (data.kind === "videoTask") { delete data.mediaId; delete data.variants; }
        else { delete data.waveformPeaks; delete data.durationSeconds; delete data.usageCharacters; delete data.audioOutputs; delete data.selectedAudioIndex; }
      }
    } else if (data.kind === "llm") {
      if (data.status !== "success" || !data.output) { data.status = "idle"; delete data.output; }
      delete data.error;
    } else if (data.kind === "loop") data.status = "idle";
  }
  return copy;
}

export function parseCanvasJson(text: string): CanvasDocumentV2 {
  if (new TextEncoder().encode(text).byteLength > MAX_CANVAS_JSON_BYTES) throw new Error("画布 JSON 过大");
  try {
    return parseCanvasDocumentV2(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("画布 JSON 格式无效");
    throw new Error("文件不是有效的画布 V2 文档");
  }
}

function isUnsafeArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => part === "..");
}

export function validateCanvasArchiveEntries(entries: Array<{ name: string; size: number }>) {
  if (entries.length > MAX_CANVAS_ARCHIVE_FILES) throw new Error("归档文件数量过多");
  let totalSize = 0;
  for (const entry of entries) {
    if (isUnsafeArchivePath(entry.name)) throw new Error("归档包含不安全路径");
    if (!Number.isFinite(entry.size) || entry.size < 0) throw new Error("归档条目大小无效");
    totalSize += entry.size;
    if (totalSize > MAX_CANVAS_ARCHIVE_BYTES) throw new Error("归档解压后过大（上限 10 GB）");
  }
  return { fileCount: entries.length, totalSize };
}

let transferSequence = 0;

function transferId(prefix: string) {
  transferSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${transferSequence.toString(36)}`;
}

export function selectCanvasSubgraph(document: CanvasDocumentV2, selectedIds: string[]): CanvasDocumentV2 {
  const selected = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of document.nodes) {
      if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) {
        selected.add(node.id);
        changed = true;
      }
    }
  }
  const nodes = document.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => ({
      ...structuredClone(node),
      position: (() => {
        const position = { ...node.position };
        if (node.parentId && !selected.has(node.parentId)) {
          const visited = new Set([node.id]);
          let parentId: string | undefined = node.parentId;
          while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            const parent = document.nodes.find((candidate) => candidate.id === parentId);
            if (!parent) break;
            position.x += parent.position.x; position.y += parent.position.y;
            parentId = parent.parentId;
          }
        }
        return position;
      })(),
      hidden: node.parentId && !selected.has(node.parentId) ? false : node.hidden,
      parentId: node.parentId && selected.has(node.parentId) ? node.parentId : undefined,
      extent: node.parentId && selected.has(node.parentId) ? node.extent : undefined,
    }));
  const edges = document.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)).map((edge) => structuredClone(edge));
  return { ...structuredClone(document), nodes, edges };
}

export function appendCanvasDocument(
  current: CanvasDocumentV2,
  imported: CanvasDocumentV2,
  offset: { x: number; y: number } = { x: 80, y: 80 },
): CanvasDocumentV2 {
  imported = detachWorkflowExecution(imported);
  if (imported.nodes.length && current.nodes.length) {
    const byId = new Map(imported.nodes.map(node => [node.id, node]));
    const bounds = imported.nodes.map(node => ({ ...canvasNodeWorldPosition(node, byId),
      width: node.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.width,
      height: node.height ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.height }));
    const left = Math.min(...bounds.map(rect => rect.x));
    const top = Math.min(...bounds.map(rect => rect.y));
    const width = Math.max(...bounds.map(rect => rect.x + rect.width)) - left;
    const height = Math.max(...bounds.map(rect => rect.y + rect.height)) - top;
    const [position] = getCanvasLocalUploadPositions([{ width, height }], { x: left + offset.x, y: top + offset.y }, current.nodes);
    offset = { x: position.x - left, y: position.y - top };
  }
  const idMap = new Map(imported.nodes.map((node) => [node.id, transferId(node.type)]));
  const remapReference = (id: string) => {
    if (idMap.has(id)) return idMap.get(id)!;
    for (const [before, after] of idMap) if (id.startsWith(`${before}:`)) return `${after}${id.slice(before.length)}`;
    return id;
  };
  const remapData = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remapData);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      key === "referenceOrder" && Array.isArray(entry) ? entry.map(remapReference)
        : (key === "sourceNodeId" || key === "id") && typeof entry === "string" ? remapReference(entry) : remapData(entry),
    ]));
  };
  const nodes = imported.nodes.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    data: remapData(node.data) as typeof node.data,
    position: node.parentId ? node.position : { x: node.position.x + offset.x, y: node.position.y + offset.y },
    parentId: node.parentId ? idMap.get(node.parentId) : undefined,
    extent: node.parentId && idMap.has(node.parentId) ? node.extent : undefined,
  }));
  const edges = imported.edges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: transferId("edge"),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    }));
  return { ...current, nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] };
}
