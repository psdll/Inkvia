import type { CanvasDocumentV2, CanvasNode } from "./document";
import { canvasNodeWorldPosition } from "./spatial-index";

export const CANVAS_GROUP_PADDING = { x: 80, top: 100, bottom: 60 };
export const CANVAS_GROUP_GAP = 160;

/** Join a drag selection one member at a time so unplaced nodes do not skew the layout. */
export function joinAndAlignCanvasGroups(document: CanvasDocumentV2, targets: ReadonlyMap<string, string>): CanvasDocumentV2 {
  let next = document;
  for (const [nodeId, groupId] of targets) {
    const node = next.nodes.find(item => item.id === nodeId);
    const group = next.nodes.find(item => item.id === groupId);
    if (!node || node.parentId || node.type === "group" || group?.data.kind !== "group" || group.data.collapsed) continue;
    next = alignNewCanvasGroupMember(joinCanvasGroups(next, new Map([[nodeId, groupId]]), true), nodeId);
  }
  return next;
}

/** Align only the newly joined member to the group's existing rows and columns. */
export function alignNewCanvasGroupMember(document: CanvasDocumentV2, nodeId: string): CanvasDocumentV2 {
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node?.parentId) return document;
  const siblings = document.nodes.filter(item => item.parentId === node.parentId && item.id !== nodeId);
  if (!siblings.length) return document;
  const width = node.width ?? 240;
  const height = node.height ?? 140;
  const cluster = (axis: "x" | "y") => {
    const size = axis === "x" ? "width" : "height";
    const fallback = axis === "x" ? 240 : 140;
    const groups: CanvasNode[][] = [];
    for (const item of [...siblings].sort((a, b) => a.position[axis] - b.position[axis])) {
      const last = groups.at(-1);
      if (last && item.position[axis] - last[0].position[axis] <= Math.min(item[size] ?? fallback, last[0][size] ?? fallback) / 2) last.push(item);
      else groups.push([item]);
    }
    const gaps = groups.slice(1).map((group, index) => group[0].position[axis]
      - Math.max(...groups[index].map(item => item.position[axis] + (item[size] ?? fallback)))).filter(gap => gap > 0).sort((a, b) => a - b);
    return { anchors: groups.map(group => group[0].position[axis]), gap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : CANVAS_GROUP_GAP };
  };
  const columns = cluster("x");
  const rows = cluster("y");
  const left = Math.min(...siblings.map(item => item.position.x));
  const right = Math.max(...siblings.map(item => item.position.x + (item.width ?? 240)));
  const top = Math.min(...siblings.map(item => item.position.y));
  const bottom = Math.max(...siblings.map(item => item.position.y + (item.height ?? 140)));
  // A single row stays horizontal; a single column stays vertical. A grid keeps
  // its columns, fills vacancies when possible, and can grow by a row.
  const xs = rows.anchors.length === 1
    ? [...columns.anchors, left - width - columns.gap, right + columns.gap]
    : columns.anchors;
  const ys = rows.anchors.length === 1
    ? rows.anchors
    : [...rows.anchors, top - height - rows.gap, bottom + rows.gap];
  const clearanceX = Math.min(40, columns.gap);
  const clearanceY = Math.min(40, rows.gap);
  const candidates = xs.flatMap(x => ys.map(y => ({ x, y }))).filter(point => siblings.every(item => (
    point.x + width + clearanceX <= item.position.x || point.x >= item.position.x + (item.width ?? 240) + clearanceX
    || point.y + height + clearanceY <= item.position.y || point.y >= item.position.y + (item.height ?? 140) + clearanceY
  )));
  candidates.sort((a, b) => Math.hypot(a.x - node.position.x, a.y - node.position.y) - Math.hypot(b.x - node.position.x, b.y - node.position.y));
  const position = candidates[0];
  if (!position) return document;
  const nodes = document.nodes.map(item => item.id === nodeId ? { ...item, position } : item);
  return { ...document, nodes: fitCanvasGroupBounds(nodes, [node.parentId], true) };
}

/** Detach one member without moving its siblings or changing any connections. */
export function moveCanvasNodeOutOfGroup(
  document: CanvasDocumentV2,
  nodeId: string,
  measured: ReadonlyMap<string, { width?: number; height?: number }> = new Map(),
): CanvasDocumentV2 {
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node?.parentId) return document;
  const byId = new Map(document.nodes.map(item => [item.id, item]));
  const origin = canvasNodeWorldPosition(node, byId);
  const width = measured.get(nodeId)?.width ?? node.width ?? 240;
  const height = measured.get(nodeId)?.height ?? node.height ?? 140;
  const gap = 40;
  // Descendants travel with a detached group, so only stationary nodes block it.
  const moving = new Set([nodeId]);
  const children = new Map<string, string[]>();
  for (const item of document.nodes) {
    if (!item.parentId) continue;
    const members = children.get(item.parentId) ?? [];
    members.push(item.id);
    children.set(item.parentId, members);
  }
  for (const id of moving) for (const child of children.get(id) ?? []) moving.add(child);
  const obstacles = document.nodes.filter(item => !moving.has(item.id)).map(item => ({
    ...canvasNodeWorldPosition(item, byId),
    width: measured.get(item.id)?.width ?? item.width ?? 240,
    height: measured.get(item.id)?.height ?? item.height ?? 140,
  }));
  // Search all four directions, including left/up. Jump over entire obstacles
  // rather than using a bounded spiral that could stop on an occupied location.
  const candidates = (["x", "y"] as const).flatMap(axis => {
    const other = axis === "x" ? "y" : "x";
    const size = axis === "x" ? width : height;
    const otherSize = axis === "x" ? height : width;
    const along = axis === "x" ? "width" : "height";
    const across = axis === "x" ? "height" : "width";
    const blockers = obstacles.filter(rect => origin[other] < rect[other] + rect[across] + gap
      && origin[other] + otherSize + gap > rect[other]);
    return [1, -1].map(direction => {
      let coordinate = origin[axis];
      const ordered = [...blockers].sort((a, b) => direction > 0
        ? a[axis] - b[axis]
        : (b[axis] + b[along]) - (a[axis] + a[along]));
      for (const rect of ordered) {
        if (coordinate < rect[axis] + rect[along] + gap && coordinate + size + gap > rect[axis]) {
          coordinate = direction > 0 ? rect[axis] + rect[along] + gap : rect[axis] - size - gap;
        }
      }
      return { ...origin, [axis]: coordinate };
    });
  });
  candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
  return { ...document, nodes: document.nodes.map(item => item.id === nodeId
    ? { ...item, parentId: undefined, extent: undefined, hidden: false, position: candidates[0] }
    : item) };
}

/** Rebase children when the frame moves; their world positions must stay fixed. */
export function fitCanvasGroupBounds(nodes: CanvasNode[], groupIds?: Iterable<string>, keepExtraSpace = false, geometry = createCanvasGroupDragGeometry(nodes, [])): CanvasNode[] {
  const { byId, children } = geometry;
  const affected = new Set(groupIds ?? children.keys());
  for (const id of affected) {
    const parentId = byId.get(id)?.parentId;
    if (parentId) affected.add(parentId);
  }
  const done = new Set<string>();
  const updates = new Map<string, CanvasNode>();
  let changed = false;
  const fit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    const index = geometry.indices.get(id);
    const group = updates.get(id) ?? (index === undefined ? byId.get(id) : nodes[index]);
    if (group?.data.kind !== "group" || group.data.collapsed) return;
    const members = children.get(id) ?? [];
    for (const member of members) if (affected.has(member.id)) fit(member.id);
    const current = members.map(member => updates.get(member.id) ?? nodes[geometry.indices.get(member.id)!] ?? byId.get(member.id)!);
    if (!current.length) return;
    const left = Math.min(keepExtraSpace ? 0 : Infinity, ...current.map(n => n.position.x - CANVAS_GROUP_PADDING.x));
    const top = Math.min(keepExtraSpace ? 0 : Infinity, ...current.map(n => n.position.y - CANVAS_GROUP_PADDING.top));
    const right = Math.max(keepExtraSpace ? group.width ?? 0 : -Infinity, ...current.map(n => n.position.x + (n.width ?? 240) + CANVAS_GROUP_PADDING.x));
    const bottom = Math.max(keepExtraSpace ? group.height ?? 0 : -Infinity, ...current.map(n => n.position.y + (n.height ?? 140) + CANVAS_GROUP_PADDING.bottom));
    const width = right - left;
    const height = bottom - top;
    if (left || top || width !== group.width || height !== group.height) {
      byId.set(id, { ...group, position: { x: group.position.x + left, y: group.position.y + top }, width, height });
      updates.set(id, byId.get(id)!);
      changed = true;
    }
    for (const member of current) {
      if (!left && !top && !member.extent) continue;
      byId.set(member.id, { ...member, extent: undefined, position: { x: member.position.x - left, y: member.position.y - top } });
      updates.set(member.id, byId.get(member.id)!);
      changed = true;
    }
  };
  for (const id of affected) fit(id);
  return changed ? nodes.map(node => updates.get(node.id) ?? node) : nodes;
}

function worldPosition(node: CanvasNode, byId: Map<string, CanvasNode>): { x: number; y: number } {
  return canvasNodeWorldPosition(node, byId);
}

/** Stable membership and ordering are built once at gesture start. */
export function createCanvasGroupDragGeometry(nodes: CanvasNode[], movingIds: readonly string[]) {
  const moving = new Set(movingIds);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, CanvasNode[]>();
  const indices = new Map<string, number>();
  nodes.forEach((node, index) => {
    indices.set(node.id, index);
    if (!node.parentId) return;
    const members = children.get(node.parentId) ?? [];
    members.push(node);
    children.set(node.parentId, members);
  });
  const groups = nodes.filter(node => {
    if (node.hidden || node.data.kind !== "group" || node.data.collapsed) return false;
    let ancestor: CanvasNode | undefined = node;
    const seen = new Set<string>();
    while (ancestor) {
      if (seen.has(ancestor.id)) return false;
      seen.add(ancestor.id);
      if (moving.has(ancestor.id)) return false;
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    return true;
  }).sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0));
  return { byId, children, groups, indices };
}

/** Membership changes only on release, when a free node's center is inside a frame. */
export function findCanvasGroupDropTargets(nodes: CanvasNode[], movingIds: readonly string[], geometry = createCanvasGroupDragGeometry(nodes, movingIds)): Map<string, string> {
  const { byId, groups } = geometry;
  const targets = new Map<string, string>();
  for (const id of movingIds) {
    const node = byId.get(id);
    if (!node || node.parentId || node.type === "group" || node.hidden) continue;
    const x = node.position.x + (node.width ?? 240) / 2;
    const y = node.position.y + (node.height ?? 140) / 2;
    const target = groups.find(candidate => {
      const group = byId.get(candidate.id)!;
      const origin = worldPosition(group, byId);
      return x >= origin.x && y >= origin.y && x <= origin.x + (group.width ?? 0) && y <= origin.y + (group.height ?? 0);
    });
    if (target) targets.set(id, target.id);
  }
  return targets;
}

/** External materials use the release point, not the eventual media rectangle's center. */
export function findCanvasGroupAtPoint(nodes: CanvasNode[], point: { x: number; y: number }): string | undefined {
  const { byId, groups } = createCanvasGroupDragGeometry(nodes, []);
  return groups.find(group => {
    let ancestor = group.parentId ? byId.get(group.parentId) : undefined;
    while (ancestor) {
      if (ancestor.hidden || (ancestor.data.kind === "group" && ancestor.data.collapsed)) return false;
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    const origin = worldPosition(group, byId);
    return point.x >= origin.x && point.y >= origin.y
      && point.x <= origin.x + (group.width ?? 0) && point.y <= origin.y + (group.height ?? 0);
  })?.id;
}

export function joinCanvasGroups(document: CanvasDocumentV2, targets: ReadonlyMap<string, string>, keepExtraSpace = false): CanvasDocumentV2 {
  if (!targets.size) return document;
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const nodes = document.nodes.map(node => {
    const group = byId.get(targets.get(node.id) ?? "");
    if (!group || group.data.kind !== "group" || group.data.collapsed || node.parentId || node.type === "group") return node;
    const origin = worldPosition(group, byId);
    return { ...node, parentId: group.id, extent: undefined, position: { x: node.position.x - origin.x, y: node.position.y - origin.y } };
  });
  const fitted = fitCanvasGroupBounds(nodes, targets.values(), keepExtraSpace);
  // React Flow requires every parent to precede its children, including imported documents.
  const ordered: CanvasNode[] = [];
  const added = new Set<string>();
  const fittedById = new Map(fitted.map(node => [node.id, node]));
  const add = (node: CanvasNode) => {
    if (added.has(node.id)) return;
    added.add(node.id);
    const parent = node.parentId ? fittedById.get(node.parentId) : undefined;
    if (parent) add(parent);
    ordered.push(node);
  };
  fitted.forEach(add);
  return { ...document, nodes: ordered };
}
