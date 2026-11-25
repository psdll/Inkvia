import { CANVAS_GROUP_GAP, CANVAS_GROUP_PADDING } from "./group-layout";
import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import { getCanvasCopyName, getCanvasImageOutputName, getCanvasMediaCopyName, getCanvasTaskGeneratedMediaName } from "@/lib/canvas/material-name";

export type CanvasMarqueeSelectionMode = "replace" | "union" | "toggle";

type CanvasSelectionRect = { x: number; y: number; width: number; height: number };

export function expandCanvasMultiSelectionBounds(
  bounds: CanvasSelectionRect,
  padding: number,
): CanvasSelectionRect {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

export function doesCanvasMarqueeIntersectNode(
  selection: CanvasSelectionRect,
  node: CanvasSelectionRect,
): boolean {
  return selection.x < node.x + node.width
    && selection.x + selection.width > node.x
    && selection.y < node.y + node.height
    && selection.y + selection.height > node.y;
}

export function resolveCanvasMarqueeSelection(
  previousIds: readonly string[],
  marqueeIds: readonly string[],
  mode: CanvasMarqueeSelectionMode,
): string[] {
  const previous = [...new Set(previousIds)];
  const marquee = [...new Set(marqueeIds)];
  if (mode === "replace") return marquee;

  const next = new Set(previous);
  for (const nodeId of marquee) {
    if (mode === "toggle" && next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
  }

  return [...previous, ...marquee].filter((nodeId, index, ordered) => (
    next.has(nodeId) && ordered.indexOf(nodeId) === index
  ));
}

type Point = { x: number; y: number };
type AlignMode = "left" | "right" | "top" | "bottom" | "horizontalCenter" | "verticalCenter";
type Distribution = "horizontal" | "vertical";

let sequence = 0;

function createId(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function dimensions(node: CanvasNode) {
  return { width: node.width ?? 240, height: node.height ?? 140 };
}

function absolutePosition(node: CanvasNode, nodes: CanvasNode[]): Point {
  if (!node.parentId) return node.position;
  const parent = nodes.find((candidate) => candidate.id === node.parentId);
  if (!parent) return node.position;
  const origin = absolutePosition(parent, nodes);
  return { x: origin.x + node.position.x, y: origin.y + node.position.y };
}

export function duplicateSelection(
  document: CanvasDocumentV2,
  selectedIds: string[],
  offset: Point = { x: 32, y: 32 },
  options: { preserveIncomingEdges?: boolean; copyInternalEdges?: boolean } = {},
): { document: CanvasDocumentV2; selectedIds: string[]; idMap: Map<string, string> } {
  const requested = new Set(selectedIds);
  const selected = new Set(selectedIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of document.nodes) {
      if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) {
        selected.add(node.id);
        expanded = true;
      }
    }
  }
  const idMap = new Map<string, string>();
  for (const node of document.nodes) {
    if (selected.has(node.id)) idMap.set(node.id, createId(node.type));
  }

  const copies = document.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => {
      const data = structuredClone(node.data);
      // A copy owns its configuration, never the original node's in-flight work.
      if (data.kind === "imageTask") {
        if (data.task.angleSource) {
          data.task.angleSource.sourceNodeId = idMap.get(data.task.angleSource.sourceNodeId) ?? data.task.angleSource.sourceNodeId;
        }
        if (data.task.pinnedSource) {
          data.task.pinnedSource.sourceNodeId = idMap.get(data.task.pinnedSource.sourceNodeId) ?? data.task.pinnedSource.sourceNodeId;
        }
        data.task.batches = data.task.batches.map(batch => ({
          ...batch,
          outputs: batch.outputs.filter(output => !["idle", "submitting", "running"].includes(output.status)),
        })).filter(batch => batch.outputs.length > 0);
      } else if ("status" in data && (data.status === "submitting" || data.status === "running")) {
        data.status = "idle";
        if (data.kind === "videoTask" || data.kind === "audioTask") {
          delete data.requestKey;
          delete data.generationId;
          delete data.startedAt;
          delete data.finishedAt;
          delete data.outputUrl;
          delete data.outputName;
          delete data.error;
          if (data.kind === "videoTask") {
            delete data.mediaId;
            delete data.variants;
          } else {
            delete data.waveformPeaks;
            delete data.durationSeconds;
            delete data.usageCharacters; delete data.audioOutputs; delete data.selectedAudioIndex;
          }
        } else if (data.kind === "llm") {
          delete data.output;
          delete data.error;
        }
      }
      if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
        data.name = getCanvasMediaCopyName(document, node.id);
      } else if (data.kind === "imageTask") {
        for (const batch of data.task.batches) {
          for (const output of batch.outputs) {
            const name = getCanvasImageOutputName(document, node.id, batch.id, output.id);
            if (name) output.name = getCanvasCopyName(name);
          }
        }
      } else if (data.kind === "videoTask" && data.outputUrl) {
        const name = getCanvasTaskGeneratedMediaName(document, node.id, data.outputUrl, "video");
        if (name) data.outputName = getCanvasCopyName(name);
      }
      return {
        ...node,
        id: idMap.get(node.id)!,
        position: node.parentId && selected.has(node.parentId)
          ? { ...node.position }
          : { x: node.position.x + offset.x, y: node.position.y + offset.y },
        parentId: node.parentId ? idMap.get(node.parentId) ?? node.parentId : undefined,
        data,
      };
    });
  const copiedEdges: CanvasEdge[] = document.edges
    .filter((edge) => options.copyInternalEdges !== false && selected.has(edge.source) && selected.has(edge.target))
    .map((edge) => ({
      ...edge,
      id: createId("edge"),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    }));
  const copiedIncomingEdges: CanvasEdge[] = options.preserveIncomingEdges
    ? document.edges
        .filter((edge) => !selected.has(edge.source) && selected.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: createId("edge"),
          target: idMap.get(edge.target)!,
        }))
    : [];

  return {
    document: { ...document, nodes: [...document.nodes, ...copies], edges: [...document.edges, ...copiedEdges, ...copiedIncomingEdges] },
    selectedIds: document.nodes.filter((node) => requested.has(node.id)).map((node) => idMap.get(node.id)!),
    idMap,
  };
}

export function groupSelection(
  document: CanvasDocumentV2,
  selectedIds: string[],
  title = "分组",
): { document: CanvasDocumentV2; groupId: string } {
  const selected = document.nodes.filter((node) => selectedIds.includes(node.id) && !node.parentId);
  if (selected.length < 2) throw new Error("At least two top-level nodes are required to create a group");

  const positions = selected.map((node) => ({ node, position: absolutePosition(node, document.nodes), ...dimensions(node) }));
  const left = Math.min(...positions.map((item) => item.position.x)) - CANVAS_GROUP_PADDING.x;
  const top = Math.min(...positions.map((item) => item.position.y)) - CANVAS_GROUP_PADDING.top;
  const right = Math.max(...positions.map((item) => item.position.x + item.width)) + CANVAS_GROUP_PADDING.x;
  const bottom = Math.max(...positions.map((item) => item.position.y + item.height)) + CANVAS_GROUP_PADDING.bottom;
  const groupId = createId("group");
  const group: CanvasNode = {
    id: groupId,
    type: "group",
    position: { x: left, y: top },
    width: right - left,
    height: bottom - top,
    zIndex: -1,
    data: { kind: "group", title, collapsed: false, tone: "neutral" },
  };
  const selectedSet = new Set(selected.map((node) => node.id));
  const children = document.nodes.map((node) => {
    if (!selectedSet.has(node.id)) return node;
    const absolute = absolutePosition(node, document.nodes);
    return {
      ...node,
      parentId: groupId,
      extent: undefined,
      position: { x: absolute.x - left, y: absolute.y - top },
    };
  });

  return { document: { ...document, nodes: [group, ...children] }, groupId };
}

export function stackSelection(document: CanvasDocumentV2, selectedIds: string[]) {
  const result = groupSelection(document, selectedIds);
  const front = document.nodes.find(node => selectedIds.includes(node.id) && !node.parentId)!;
  const width = Math.min(400, Math.max(200, front.width ?? 240));
  const height = width * (front.height ?? 300) / (front.width ?? 240);
  result.document = {
    ...result.document,
    nodes: result.document.nodes.map(node => node.id === result.groupId && node.data.kind === "group"
      ? { ...node, width, height, data: { ...node.data, stacked: true, collapsed: true } }
      : node.parentId === result.groupId ? { ...node, hidden: true } : node),
  };
  return result;
}

export function ungroupSelection(document: CanvasDocumentV2, groupId: string): CanvasDocumentV2 {
  const group = document.nodes.find((node) => node.id === groupId && node.type === "group");
  if (!group) return document;
  return {
    ...document,
    nodes: document.nodes
      .filter((node) => node.id !== groupId)
      .map((node) => node.parentId === groupId
        ? {
            ...node,
            position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y },
            parentId: undefined,
            extent: undefined,
            hidden: false,
          }
        : node),
  };
}

export function toggleGroupCollapsed(document: CanvasDocumentV2, groupId: string, collapsed?: boolean): CanvasDocumentV2 {
  const group = document.nodes.find((node) => node.id === groupId && node.type === "group" && node.data.kind === "group");
  if (!group || group.data.kind !== "group") return document;
  const nextCollapsed = collapsed ?? !group.data.collapsed;
  if (nextCollapsed === group.data.collapsed) return document;
  const expandedSize = nextCollapsed
    ? { width: group.width ?? 480, height: group.height ?? 320 }
    : group.data.expandedSize ?? { width: group.width ?? 480, height: 320 };

  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id === groupId && node.data.kind === "group") {
        return {
          ...node,
          width: expandedSize.width,
          height: nextCollapsed ? 56 : expandedSize.height,
          data: { ...node.data, collapsed: nextCollapsed, expandedSize },
        };
      }
      if (node.parentId === groupId) return { ...node, hidden: nextCollapsed };
      return node;
    }),
  };
}

export type CanvasGroupLayout = "tidy" | "grid" | "horizontal" | "vertical";

export function arrangeGroupChildren(document: CanvasDocumentV2, groupId: string, layout: CanvasGroupLayout = "tidy"): CanvasDocumentV2 {
  const group = document.nodes.find((node) => node.id === groupId && node.type === "group");
  const children = document.nodes.filter((node) => node.parentId === groupId);
  if (!group || !children.length) return document;

  // Infer rows from the current geometry, allowing small offsets from manual dragging.
  const visualRows: CanvasNode[][] = [];
  for (const child of [...children].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)) {
    const row = visualRows.at(-1);
    if (row && child.position.y - row[0].position.y <= Math.min(dimensions(child).height, dimensions(row[0]).height) / 2) row.push(child);
    else visualRows.push([child]);
  }
  visualRows.forEach((row) => row.sort((a, b) => a.position.x - b.position.x));
  if (layout === "tidy") {
    const positions = new Map<string, { x: number; y: number }>();
    let y = CANVAS_GROUP_PADDING.top;
    let right = CANVAS_GROUP_PADDING.x;
    for (const row of visualRows) {
      let x = CANVAS_GROUP_PADDING.x;
      for (const child of row) {
        positions.set(child.id, { x, y });
        x += dimensions(child).width + CANVAS_GROUP_GAP;
      }
      right = Math.max(right, x - CANVAS_GROUP_GAP);
      y += Math.max(...row.map(child => dimensions(child).height)) + CANVAS_GROUP_GAP;
    }
    const width = right + CANVAS_GROUP_PADDING.x;
    const height = y - CANVAS_GROUP_GAP + CANVAS_GROUP_PADDING.bottom;
    return {
      ...document,
      nodes: document.nodes.map(node => {
        if (node.id === groupId && node.data.kind === "group") {
          return { ...node, width, height, data: { ...node.data, collapsed: false, expandedSize: { width, height } } };
        }
        const position = positions.get(node.id);
        return position ? { ...node, position, extent: undefined, hidden: false } : node;
      }),
    };
  }
  const ordered = visualRows.flat();
  const rebuildGrid = layout === "grid";
  const gridColumns = Math.ceil(Math.sqrt(children.length));
  const rowGroups = layout === "horizontal" ? [ordered]
    : layout === "vertical" ? ordered.map((child) => [child])
      : rebuildGrid ? Array.from({ length: Math.ceil(ordered.length / gridColumns) }, (_, row) => ordered.slice(row * gridColumns, (row + 1) * gridColumns))
      : visualRows;
  const cells = new Map<string, { row: number; column: number }>(rowGroups.flatMap((row, rowIndex) => row.map((child, column) => (
    [child.id, { row: rowIndex, column }] as const
  ))));
  const columns = Math.max(...rowGroups.map((row) => row.length));
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(
    200,
    ...children.filter((node) => cells.get(node.id)!.column === column).map((node) => dimensions(node).width),
  ));
  const rows = rowGroups.length;
  const rowHeights = rowGroups.map((row) => Math.max(
    100,
    ...row.map((node) => dimensions(node).height),
  ));
  const xOffsets = columnWidths.map((_, index) => CANVAS_GROUP_PADDING.x + columnWidths.slice(0, index).reduce((sum, width) => sum + width + CANVAS_GROUP_GAP, 0));
  const yOffsets = rowHeights.map((_, index) => CANVAS_GROUP_PADDING.top + rowHeights.slice(0, index).reduce((sum, height) => sum + height + CANVAS_GROUP_GAP, 0));
  const width = CANVAS_GROUP_PADDING.x * 2 + columnWidths.reduce((sum, value) => sum + value, 0) + Math.max(0, columns - 1) * CANVAS_GROUP_GAP;
  const height = CANVAS_GROUP_PADDING.top + CANVAS_GROUP_PADDING.bottom + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows - 1) * CANVAS_GROUP_GAP;

  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id === groupId && node.data.kind === "group") {
        return { ...node, width, height, data: { ...node.data, collapsed: false, expandedSize: { width, height } } };
      }
      const cell = cells.get(node.id);
      if (!cell) return node;
      const { row, column } = cell;
      return { ...node, position: { x: xOffsets[column], y: yOffsets[row] }, extent: undefined, hidden: false };
    }),
  };
}

export function alignNodes(document: CanvasDocumentV2, selectedIds: string[], mode: AlignMode): CanvasDocumentV2 {
  const selected = document.nodes.filter((node) => selectedIds.includes(node.id));
  if (selected.length < 2) return document;
  const boxes = selected.map((node) => ({ node, ...dimensions(node) }));
  const left = Math.min(...boxes.map(({ node }) => node.position.x));
  const right = Math.max(...boxes.map(({ node, width }) => node.position.x + width));
  const top = Math.min(...boxes.map(({ node }) => node.position.y));
  const bottom = Math.max(...boxes.map(({ node, height }) => node.position.y + height));
  const horizontalCenter = (left + right) / 2;
  const verticalCenter = (top + bottom) / 2;
  const selectedSet = new Set(selectedIds);

  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!selectedSet.has(node.id)) return node;
      const { width, height } = dimensions(node);
      if (mode === "left") return { ...node, position: { ...node.position, x: left } };
      if (mode === "right") return { ...node, position: { ...node.position, x: right - width } };
      if (mode === "top") return { ...node, position: { ...node.position, y: top } };
      if (mode === "bottom") return { ...node, position: { ...node.position, y: bottom - height } };
      if (mode === "horizontalCenter") return { ...node, position: { ...node.position, x: horizontalCenter - width / 2 } };
      return { ...node, position: { ...node.position, y: verticalCenter - height / 2 } };
    }),
  };
}

export function distributeNodes(document: CanvasDocumentV2, selectedIds: string[], direction: Distribution): CanvasDocumentV2 {
  const selected = document.nodes.filter((node) => selectedIds.includes(node.id));
  if (selected.length < 3) return document;
  const axis = direction === "horizontal" ? "x" : "y";
  const sorted = [...selected].sort((a, b) => a.position[axis] - b.position[axis]);
  const start = sorted[0].position[axis];
  const end = sorted.at(-1)!.position[axis];
  const gap = (end - start) / (sorted.length - 1);
  const positionMap = new Map(sorted.map((node, index) => [node.id, start + gap * index]));
  return {
    ...document,
    nodes: document.nodes.map((node) => positionMap.has(node.id)
      ? { ...node, position: { ...node.position, [axis]: positionMap.get(node.id)! } }
      : node),
  };
}

export function autoArrangeNodes(document: CanvasDocumentV2): CanvasDocumentV2 {
  const topLevel = document.nodes.filter((node) => !node.parentId && node.type !== "group");
  if (!topLevel.length) return document;
  const horizontalGap = 120;
  const verticalGap = 120;
  const ids = new Set(topLevel.map((node) => node.id));
  const incoming = new Map(topLevel.map((node) => [node.id, 0]));
  const outgoing = new Map(topLevel.map((node) => [node.id, [] as string[]]));
  const predecessors = new Map(topLevel.map((node) => [node.id, [] as string[]]));
  for (const edge of document.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
    predecessors.get(edge.target)?.push(edge.source);
  }

  const levels = new Map<string, number>();
  const queue = topLevel.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) levels.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, (levels.get(id) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const node of topLevel) if (!levels.has(node.id)) levels.set(node.id, 0);

  const rows = new Map<number, string[]>();
  for (const node of topLevel) {
    const level = levels.get(node.id) ?? 0;
    rows.set(level, [...(rows.get(level) ?? []), node.id]);
  }
  const nodesById = new Map(topLevel.map((node) => [node.id, node]));
  const topLevelGroups = document.nodes.filter((node) => !node.parentId && node.type === "group");
  const originX = topLevelGroups.length
    ? Math.max(...topLevelGroups.map((node) => node.position.x + (node.width ?? 320))) + horizontalGap
    : 0;
  const positions = new Map<string, Point>();
  let levelX = originX;
  for (const level of [...rows.keys()].sort((left, right) => left - right)) {
    const rowIds = [...(rows.get(level) ?? [])].sort((leftId, rightId) => {
      const barycenter = (nodeId: string) => {
        const sources = predecessors.get(nodeId) ?? [];
        const centers = sources.flatMap((sourceId) => {
          const sourcePosition = positions.get(sourceId);
          const sourceNode = nodesById.get(sourceId);
          return sourcePosition && sourceNode
            ? [sourcePosition.y + (sourceNode.height ?? 180) / 2]
            : [];
        });
        return centers.length ? centers.reduce((sum, value) => sum + value, 0) / centers.length : null;
      };
      const leftBarycenter = barycenter(leftId);
      const rightBarycenter = barycenter(rightId);
      if (leftBarycenter !== null && rightBarycenter !== null && leftBarycenter !== rightBarycenter) return leftBarycenter - rightBarycenter;
      if (leftBarycenter !== null && rightBarycenter === null) return -1;
      if (leftBarycenter === null && rightBarycenter !== null) return 1;
      return (nodesById.get(leftId)?.position.y ?? 0) - (nodesById.get(rightId)?.position.y ?? 0);
    });
    let rowY = 0;
    let levelWidth = 0;
    for (const id of rowIds) {
      const node = nodesById.get(id);
      if (!node) continue;
      const width = node.width ?? 280;
      const height = node.height ?? 180;
      positions.set(id, { x: levelX, y: rowY });
      rowY += height + verticalGap;
      levelWidth = Math.max(levelWidth, width);
    }
    levelX += levelWidth + horizontalGap;
  }
  return {
    ...document,
    nodes: document.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node),
  };
}

export function removeSelection(document: CanvasDocumentV2, selectedIds: string[]): CanvasDocumentV2 {
  const removed = new Set(selectedIds);
  for (const node of document.nodes) if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
  return {
    ...document,
    nodes: document.nodes.filter((node) => !removed.has(node.id)),
    edges: document.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
  };
}
