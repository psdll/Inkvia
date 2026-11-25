import type { CanvasNode } from "@/lib/canvas/document";

export const CANVAS_DERIVED_NODE_HORIZONTAL_GAP = 120;
export const CANVAS_DERIVED_NODE_CLEARANCE = 40;
export const CANVAS_DERIVED_NODE_COLUMN_CAPACITY = 5;

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = Point & Size;
type DerivedSlotAssignment = { columnIndex: number; slotIndex: number };

const DERIVED_COLUMN_PAIR_SEQUENCE: ReadonlyArray<DerivedSlotAssignment> = [
  { columnIndex: 0, slotIndex: 0 },
  { columnIndex: 0, slotIndex: 1 },
  { columnIndex: 0, slotIndex: 2 },
  { columnIndex: 1, slotIndex: 0 },
  { columnIndex: 1, slotIndex: 1 },
  { columnIndex: 1, slotIndex: 2 },
  { columnIndex: 0, slotIndex: 3 },
  { columnIndex: 0, slotIndex: 4 },
  { columnIndex: 1, slotIndex: 3 },
  { columnIndex: 1, slotIndex: 4 },
];

export type CanvasPlacementNode = Pick<
  CanvasNode,
  "id" | "position" | "width" | "height" | "parentId"
>;

function positiveSize(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function absolutePosition(
  node: CanvasPlacementNode,
  nodesById: ReadonlyMap<string, CanvasPlacementNode>,
  visiting = new Set<string>(),
): Point {
  if (!node.parentId || visiting.has(node.id)) return node.position;
  const parent = nodesById.get(node.parentId);
  if (!parent) return node.position;
  const nextVisiting = new Set(visiting);
  nextVisiting.add(node.id);
  const parentPosition = absolutePosition(parent, nodesById, nextVisiting);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

function nodeRect(
  node: CanvasPlacementNode,
  nodesById: ReadonlyMap<string, CanvasPlacementNode>,
): Rect {
  return {
    ...absolutePosition(node, nodesById),
    width: positiveSize(node.width, DEFAULT_NODE_WIDTH),
    height: positiveSize(node.height, DEFAULT_NODE_HEIGHT),
  };
}

function overlapsWithClearance(candidate: Rect, occupied: Rect) {
  return (
    candidate.x < occupied.x + occupied.width + CANVAS_DERIVED_NODE_CLEARANCE
    && candidate.x + candidate.width + CANVAS_DERIVED_NODE_CLEARANCE > occupied.x
    && candidate.y < occupied.y + occupied.height + CANVAS_DERIVED_NODE_CLEARANCE
    && candidate.y + candidate.height + CANVAS_DERIVED_NODE_CLEARANCE > occupied.y
  );
}

function collidingRects(candidate: Rect, occupied: readonly Rect[]) {
  return occupied.filter((rect) => overlapsWithClearance(candidate, rect));
}

function moveVerticallyUntilFree(
  candidate: Rect,
  direction: "up" | "down",
  occupied: readonly Rect[],
) {
  let next = candidate;
  for (let attempt = 0; attempt <= occupied.length; attempt += 1) {
    const collisions = collidingRects(next, occupied);
    if (!collisions.length) return next;
    next = {
      ...next,
      y: direction === "down"
        ? Math.max(...collisions.map((rect) => rect.y + rect.height + CANVAS_DERIVED_NODE_CLEARANCE))
        : Math.min(...collisions.map((rect) => rect.y - next.height - CANVAS_DERIVED_NODE_CLEARANCE)),
    };
  }
  return next;
}

function moveRightUntilFree(candidate: Rect, occupied: readonly Rect[]) {
  let next = candidate;
  for (let attempt = 0; attempt <= occupied.length; attempt += 1) {
    const collisions = collidingRects(next, occupied);
    if (!collisions.length) return next;
    next = {
      ...next,
      x: Math.max(...collisions.map((rect) => rect.x + rect.width + CANVAS_DERIVED_NODE_HORIZONTAL_GAP)),
    };
  }
  return next;
}

function assignmentForIndex(index: number): DerivedSlotAssignment {
  const pairIndex = Math.floor(index / DERIVED_COLUMN_PAIR_SEQUENCE.length);
  const assignment = DERIVED_COLUMN_PAIR_SEQUENCE[index % DERIVED_COLUMN_PAIR_SEQUENCE.length];
  return {
    columnIndex: pairIndex * 2 + assignment.columnIndex,
    slotIndex: assignment.slotIndex,
  };
}

export function findDerivedNodePosition(
  nodes: readonly CanvasPlacementNode[],
  sourceId: string,
  size: Size,
  reserved: readonly CanvasPlacementNode[] = [],
  fallback: Point = { x: 0, y: 0 },
): Point {
  if (![...nodes, ...reserved].some((node) => node.id === sourceId)) return fallback;
  let candidateId = "__derived-candidate__";
  const usedIds = new Set([...nodes, ...reserved].map((node) => node.id));
  while (usedIds.has(candidateId)) candidateId += "_";
  const candidate: CanvasPlacementNode = {
    id: candidateId,
    position: fallback,
    width: positiveSize(size.width, DEFAULT_NODE_WIDTH),
    height: positiveSize(size.height, DEFAULT_NODE_HEIGHT),
  };
  const reservedIds = reserved.map((node) => node.id);
  const arranged = reflowDerivedNodePositions(
    [...nodes.filter((node) => !reservedIds.includes(node.id)), ...reserved, candidate],
    sourceId,
    [...reservedIds, candidateId],
  );
  return arranged.find((node) => node.id === candidateId)?.position || fallback;
}

export function reflowDerivedNodePositions<T extends CanvasPlacementNode>(
  nodes: readonly T[],
  sourceId: string,
  derivedNodeIds: readonly string[],
  ignoredNodeIds: readonly string[] = [],
): T[] {
  const excludedIds = new Set([...derivedNodeIds, ...ignoredNodeIds]);
  const occupied = nodes.filter((node) => !excludedIds.has(node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const source = nodesById.get(sourceId);
  if (!source) return [...nodes];
  const sourceRect = nodeRect(source, nodesById);
  const occupiedRects = occupied.map((node) => nodeRect(node, nodesById));
  const placedRects: Rect[] = [];
  const positions = new Map<string, Point>();
  const assignments = derivedNodeIds.map((nodeId, index) => ({
    nodeId,
    ...assignmentForIndex(index),
  }));
  const columnWidths = new Map<number, number>();
  for (const assignment of assignments) {
    const node = nodesById.get(assignment.nodeId);
    if (!node) continue;
    columnWidths.set(
      assignment.columnIndex,
      Math.max(
        columnWidths.get(assignment.columnIndex) || 0,
        positiveSize(node.width, DEFAULT_NODE_WIDTH),
      ),
    );
  }
  const columns: Array<{ x: number; width: number; slots: Rect[] } | undefined> = [];

  for (const assignment of assignments) {
    const node = nodesById.get(assignment.nodeId);
    if (!node) continue;
    const size = {
      width: positiveSize(node.width, DEFAULT_NODE_WIDTH),
      height: positiveSize(node.height, DEFAULT_NODE_HEIGHT),
    };
    let column = columns[assignment.columnIndex];
    let placed: Rect;

    if (column && assignment.slotIndex > 0) {
      const direction = assignment.slotIndex % 2 === 1 ? "up" : "down";
      const baseY = direction === "down"
        ? Math.max(...column.slots.map((rect) => rect.y + rect.height)) + CANVAS_DERIVED_NODE_CLEARANCE
        : Math.min(...column.slots.map((rect) => rect.y)) - size.height - CANVAS_DERIVED_NODE_CLEARANCE;
      const candidate = { x: column.x, y: baseY, ...size };
      placed = moveVerticallyUntilFree(candidate, direction, [...occupiedRects, ...placedRects]);
    } else {
      const previousColumn = columns[assignment.columnIndex - 1];
      const startX = previousColumn
        ? previousColumn.x + previousColumn.width + CANVAS_DERIVED_NODE_HORIZONTAL_GAP
        : sourceRect.x + sourceRect.width + CANVAS_DERIVED_NODE_HORIZONTAL_GAP;
      placed = moveRightUntilFree(
        { x: startX, y: sourceRect.y, ...size },
        [...occupiedRects, ...placedRects],
      );
      column = {
        x: placed.x,
        width: columnWidths.get(assignment.columnIndex) || size.width,
        slots: [],
      };
      columns[assignment.columnIndex] = column;
    }

    positions.set(node.id, { x: placed.x, y: placed.y });
    column.slots.push(placed);
    placedRects.push(placed);
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}
