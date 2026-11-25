import RBush from "rbush";
import type { CanvasEdge, CanvasNode, CanvasViewport } from "@/lib/canvas/document";

export type SpatialBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type SpatialPoint = { x: number; y: number };

export type CanvasNodeSpatialItem = SpatialBounds & {
  id: string;
  zIndex: number;
  renderOrder: number;
  node: CanvasNode;
};

export type CanvasEdgeSpatialItem = SpatialBounds & {
  id: string;
  renderOrder: number;
  edge: CanvasEdge;
  points: SpatialPoint[];
};

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;

export function canvasNodeWorldPosition(node: CanvasNode, nodes: ReadonlyMap<string, CanvasNode>): SpatialPoint {
  let x = node.position.x;
  let y = node.position.y;
  const visited = new Set([node.id]);
  let parent = node.parentId ? nodes.get(node.parentId) : undefined;
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? nodes.get(parent.parentId) : undefined;
  }
  return { x, y };
}

function nodeItem(node: CanvasNode, renderOrder: number, nodes: ReadonlyMap<string, CanvasNode>): CanvasNodeSpatialItem {
  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;
  const position = canvasNodeWorldPosition(node, nodes);
  return {
    minX: position.x,
    minY: position.y,
    maxX: position.x + width,
    maxY: position.y + height,
    id: node.id,
    zIndex: node.zIndex ?? 0,
    renderOrder,
    node,
  };
}

function center(node: CanvasNode, nodes: ReadonlyMap<string, CanvasNode>): SpatialPoint {
  const position = canvasNodeWorldPosition(node, nodes);
  return {
    x: position.x + (node.width ?? DEFAULT_NODE_WIDTH) / 2,
    y: position.y + (node.height ?? DEFAULT_NODE_HEIGHT) / 2,
  };
}

function edgeItem(edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>, renderOrder: number): CanvasEdgeSpatialItem | null {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return null;
  const points = [center(source, nodes), center(target, nodes)];
  return {
    minX: Math.min(points[0].x, points[1].x),
    minY: Math.min(points[0].y, points[1].y),
    maxX: Math.max(points[0].x, points[1].x),
    maxY: Math.max(points[0].y, points[1].y),
    id: edge.id,
    renderOrder,
    edge,
    points,
  };
}

function pointToSegmentDistance(point: SpatialPoint, start: SpatialPoint, end: SpatialPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

export function screenPixelsToWorld(pixels: number, zoom: number): number {
  return Math.max(0, pixels) / Math.max(zoom, 0.0001);
}

export function viewportToWorldBounds(
  viewport: CanvasViewport,
  screenWidth: number,
  screenHeight: number,
  overscanPixels = 0,
): SpatialBounds {
  const zoom = Math.max(viewport.zoom, 0.0001);
  return {
    minX: (-viewport.x - overscanPixels) / zoom,
    minY: (-viewport.y - overscanPixels) / zoom,
    maxX: (screenWidth - viewport.x + overscanPixels) / zoom,
    maxY: (screenHeight - viewport.y + overscanPixels) / zoom,
  };
}

export class CanvasSpatialIndex {
  private readonly nodes = new Map<string, CanvasNode>();
  private readonly edges = new Map<string, CanvasEdge>();
  private readonly children = new Map<string, Set<string>>();
  private readonly incidentEdges = new Map<string, Set<string>>();
  private readonly nodeItems = new Map<string, CanvasNodeSpatialItem>();
  private readonly edgeItems = new Map<string, CanvasEdgeSpatialItem>();
  private readonly nodeTree = new RBush<CanvasNodeSpatialItem>();
  private readonly edgeTree = new RBush<CanvasEdgeSpatialItem>();

  constructor(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]) {
    nodes.forEach((node) => this.nodes.set(node.id, node));
    edges.forEach((edge) => this.edges.set(edge.id, edge));
    nodes.forEach(node => { if (node.parentId) this.addTo(this.children, node.parentId, node.id); });
    edges.forEach(edge => {
      this.addTo(this.incidentEdges, edge.source, edge.id);
      this.addTo(this.incidentEdges, edge.target, edge.id);
    });
    const nodeItems = nodes.map((node, index) => nodeItem(node, index, this.nodes));
    const edgeItems = edges
      .map((edge, index) => edgeItem(edge, this.nodes, index))
      .filter((item): item is CanvasEdgeSpatialItem => Boolean(item));
    nodeItems.forEach((item) => this.nodeItems.set(item.id, item));
    edgeItems.forEach((item) => this.edgeItems.set(item.id, item));
    this.nodeTree.load(nodeItems);
    this.edgeTree.load(edgeItems);
  }

  get nodeCount(): number { return this.nodeItems.size; }
  private addTo(index: Map<string, Set<string>>, key: string, id: string) {
    let ids = index.get(key);
    if (!ids) index.set(key, ids = new Set());
    ids.add(id);
  }
  get edgeCount(): number { return this.edgeItems.size; }

  searchNodes(bounds: SpatialBounds): CanvasNodeSpatialItem[] {
    return this.nodeTree.search(bounds);
  }

  searchEdges(bounds: SpatialBounds): CanvasEdgeSpatialItem[] {
    return this.edgeTree.search(bounds);
  }

  hitTestNode(point: SpatialPoint, tolerance: number): CanvasNodeSpatialItem | null {
    const candidates = this.nodeTree.search({
      minX: point.x - tolerance,
      minY: point.y - tolerance,
      maxX: point.x + tolerance,
      maxY: point.y + tolerance,
    });
    return candidates
      .filter((item) => (
        point.x >= item.minX - tolerance
        && point.x <= item.maxX + tolerance
        && point.y >= item.minY - tolerance
        && point.y <= item.maxY + tolerance
      ))
      .sort((left, right) => right.zIndex - left.zIndex || right.renderOrder - left.renderOrder)[0] ?? null;
  }

  hitTestEdge(point: SpatialPoint, tolerance: number): CanvasEdgeSpatialItem | null {
    const candidates = this.edgeTree.search({
      minX: point.x - tolerance,
      minY: point.y - tolerance,
      maxX: point.x + tolerance,
      maxY: point.y + tolerance,
    });
    return candidates
      .filter((item) => item.points.some((segmentStart, index) => (
        index < item.points.length - 1
        && pointToSegmentDistance(point, segmentStart, item.points[index + 1]) <= tolerance
      )))
      .sort((left, right) => right.renderOrder - left.renderOrder)[0] ?? null;
  }

  updateNode(previous: CanvasNode, next: CanvasNode): void {
    if (previous.parentId !== next.parentId) {
      if (previous.parentId) this.children.get(previous.parentId)?.delete(previous.id);
      if (next.parentId) this.addTo(this.children, next.parentId, next.id);
    }
    this.nodes.set(next.id, next);
    const affected = new Set([previous.id, next.id]);
    // Moving a group also moves every descendant in world space.
    for (const id of affected) for (const child of this.children.get(id) ?? []) affected.add(child);
    for (const id of affected) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const oldItem = this.nodeItems.get(id);
      if (oldItem) this.nodeTree.remove(oldItem, (left, right) => left.id === right.id);
      const nextItem = nodeItem(node, oldItem?.renderOrder ?? this.nodeItems.size, this.nodes);
      this.nodeItems.set(id, nextItem);
      this.nodeTree.insert(nextItem);
    }
    const edges = new Set<string>();
    for (const id of affected) for (const edge of this.incidentEdges.get(id) ?? []) edges.add(edge);
    for (const id of edges) {
      const edge = this.edges.get(id)!;
      this.updateEdge(edge, edge);
    }
  }

  updateEdge(previous: CanvasEdge, next: CanvasEdge): void {
    this.incidentEdges.get(previous.source)?.delete(previous.id);
    this.incidentEdges.get(previous.target)?.delete(previous.id);
    this.addTo(this.incidentEdges, next.source, next.id);
    this.addTo(this.incidentEdges, next.target, next.id);
    const oldItem = this.edgeItems.get(previous.id);
    if (oldItem) this.edgeTree.remove(oldItem, (left, right) => left.id === right.id);
    this.edges.set(next.id, next);
    const nextItem = edgeItem(next, this.nodes, oldItem?.renderOrder ?? this.edgeItems.size);
    if (nextItem) {
      this.edgeItems.set(next.id, nextItem);
      this.edgeTree.insert(nextItem);
    } else {
      this.edgeItems.delete(next.id);
    }
  }
}
