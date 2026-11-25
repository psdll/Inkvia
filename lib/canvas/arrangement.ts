import type { CanvasDocumentV2, CanvasNode } from "./document";

export type CanvasArrangeOptions = {
  category: "none" | "connections" | "media";
  layout: "tidy" | "grid" | "horizontal" | "vertical";
  followConnections: boolean;
};
export const DEFAULT_CANVAS_ARRANGE_OPTIONS: CanvasArrangeOptions = {
  category: "none",
  layout: "tidy",
  followConnections: false,
};
const GAP = 120;
const SECTION_GAP = 240;
type Point = { x: number; y: number };
const width = (node: CanvasNode) => node.width ?? 280;
const height = (node: CanvasNode) => node.height ?? 180;

function materialType(node: CanvasNode) {
  if (node.type === "image" || node.type === "imageTask") return 0;
  if (node.type === "video" || node.type === "videoTask") return 1;
  if (node.type === "audio" || node.type === "audioTask") return 2;
  if (node.type === "prompt" || node.type === "llm") return 3;
  if (node.type === "group") return 4;
  return 5;
}

/** Arrange top-level units; a group and its descendants always travel together. */
export function arrangeCanvas(
  document: CanvasDocumentV2,
  options: CanvasArrangeOptions,
): CanvasDocumentV2 {
  const roots = document.nodes.filter((node) => !node.parentId);
  if (roots.length < 2) return document;
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const rootOf = new Map<string, string>();
  for (const node of document.nodes) {
    let current = node;
    const seen = new Set<string>();
    while (current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    rootOf.set(node.id, current.id);
  }
  const rootIds = new Set(roots.map((node) => node.id));
  const links = new Map<string, Set<string>>(
    roots.map((node) => [node.id, new Set()]),
  );
  const neighbors = new Map<string, Set<string>>(
    roots.map((node) => [node.id, new Set()]),
  );
  for (const edge of document.edges) {
    const source = rootOf.get(edge.source),
      target = rootOf.get(edge.target);
    if (
      !source ||
      !target ||
      source === target ||
      !rootIds.has(source) ||
      !rootIds.has(target)
    )
      continue;
    links.get(source)!.add(target);
    neighbors.get(source)!.add(target);
    neighbors.get(target)!.add(source);
  }
  const ordered = [...roots].sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.position.x - b.position.x ||
      a.id.localeCompare(b.id),
  );
  const positions = new Map<string, Point>();
  const origin = {
    x: Math.min(...roots.map((node) => node.position.x)),
    y: Math.min(...roots.map((node) => node.position.y)),
  };

  const pack = (
    nodes: CanvasNode[],
    point: Point,
    layout: CanvasArrangeOptions["layout"],
  ) => {
    if (!nodes.length) return 0;
    if (layout === "tidy") {
      const rows: CanvasNode[][] = [];
      for (const node of [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)) {
        const row = rows.at(-1);
        if (row && node.position.y - row[0].position.y <= Math.min(height(node), height(row[0])) / 2) row.push(node);
        else rows.push([node]);
      }
      let y = point.y;
      for (const row of rows) {
        let x = point.x;
        for (const node of row.sort((a, b) => a.position.x - b.position.x)) {
          positions.set(node.id, { x, y });
          x += width(node) + GAP;
        }
        y += Math.max(...row.map(height)) + GAP;
      }
      return y - point.y - GAP;
    }
    const columns =
      layout === "horizontal"
        ? nodes.length
        : layout === "vertical"
          ? 1
          : Math.ceil(Math.sqrt(nodes.length));
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights: number[] = [];
    nodes.forEach((node, index) => {
      columnWidths[index % columns] = Math.max(
        columnWidths[index % columns],
        width(node),
      );
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, height(node));
    });
    let y = point.y;
    for (let row = 0; row < rowHeights.length; row++) {
      let x = point.x;
      for (let column = 0; column < columns; column++) {
        const node = nodes[row * columns + column];
        if (node) positions.set(node.id, { x, y });
        x += columnWidths[column] + GAP;
      }
      y += rowHeights[row] + GAP;
    }
    return y - point.y - GAP;
  };

  const graph = (nodes: CanvasNode[], point: Point) => {
    const ids = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    for (const node of nodes)
      for (const target of links.get(node.id)!)
        if (ids.has(target)) incoming.set(target, incoming.get(target)! + 1);
    const queue = nodes
      .filter((node) => incoming.get(node.id) === 0)
      .map((node) => node.id);
    const remaining = new Set(ids);
    const level = new Map(nodes.map((node) => [node.id, 0]));
    let cursor = 0;
    while (remaining.size) {
      // Cyclic workflows have no strict upstream order. Break the cycle stably
      // and still give every unit a distinct, non-overlapping position.
      if (cursor === queue.length) queue.push(remaining.values().next().value!);
      const id = queue[cursor++];
      if (!remaining.delete(id)) continue;
      for (const target of links.get(id)!) {
        if (!remaining.has(target)) continue;
        level.set(target, Math.max(level.get(target)!, level.get(id)! + 1));
        incoming.set(target, incoming.get(target)! - 1);
        if (incoming.get(target) === 0) queue.push(target);
      }
    }
    const levels = new Map<number, CanvasNode[]>();
    for (const node of nodes) {
      const rank = level.get(node.id)!;
      const members = levels.get(rank) ?? [];
      members.push(node);
      levels.set(rank, members);
    }
    let x = point.x,
      y = point.y,
      totalHeight = 0;
    for (const rank of [...levels.keys()].sort((a, b) => a - b)) {
      const members = levels.get(rank)!;
      if (options.layout === "vertical") {
        const rowHeight = pack(members, { x, y }, "horizontal");
        y += rowHeight + GAP;
        totalHeight = y - point.y - GAP;
      } else {
        totalHeight = Math.max(
          totalHeight,
          pack(members, { x, y }, "vertical"),
        );
        x += Math.max(...members.map(width)) + GAP;
      }
    }
    return totalHeight;
  };
  let sections: CanvasNode[][];
  if (options.category === "media") {
    sections = Array.from({ length: 6 }, (_, kind) =>
      ordered.filter((node) => materialType(node) === kind),
    );
  } else if (options.category === "connections") {
    const seen = new Set<string>();
    sections = [];
    for (const node of ordered) {
      if (seen.has(node.id) || !neighbors.get(node.id)!.size) continue;
      const ids = new Set([node.id]);
      for (const id of ids) {
        seen.add(id);
        for (const neighbor of neighbors.get(id)!) ids.add(neighbor);
      }
      sections.push(ordered.filter((item) => ids.has(item.id)));
    }
    sections.push(ordered.filter((node) => !neighbors.get(node.id)!.size));
  } else sections = [ordered];
  let y = origin.y;
  for (const section of sections.filter((section) => section.length)) {
    const connected = section.some((node) => neighbors.get(node.id)!.size);
    const useGraph =
      (options.category === "connections" && connected) ||
      (options.category === "none" && options.layout !== "tidy" && options.followConnections);
    const sectionHeight = useGraph
      ? graph(section, { x: origin.x, y })
      : pack(section, { x: origin.x, y }, options.layout);
    y += sectionHeight + SECTION_GAP;
  }
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      positions.has(node.id)
        ? { ...node, position: positions.get(node.id)! }
        : node,
    ),
  };
}
