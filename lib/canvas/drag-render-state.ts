type CanvasRenderNodeLike = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  dragging?: boolean;
  measured?: { width?: number; height?: number };
};

/** React Flow resolves child world positions in array order, including on selection. */
export function orderCanvasParentsFirst<T extends { id: string; parentId?: string }>(nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const ordered: T[] = [];
  const visit = (node: T) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) visit(parent);
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
}

export function mergeCanvasRenderNodes<T extends CanvasRenderNodeLike>(
  currentNodes: T[],
  businessNodes: readonly T[],
  draggingIds: ReadonlySet<string>,
): T[] {
  businessNodes = orderCanvasParentsFirst(businessNodes);
  if (!draggingIds.size) {
    return currentNodes.length === businessNodes.length && currentNodes.every((node, index) => node === businessNodes[index])
      ? currentNodes
      : [...businessNodes];
  }
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return businessNodes.map((businessNode) => {
    if (!draggingIds.has(businessNode.id)) return businessNode;
    const currentNode = currentById.get(businessNode.id);
    if (!currentNode) return businessNode;

    return {
      ...businessNode,
      position: currentNode.position,
      dragging: currentNode.dragging,
      measured: currentNode.measured ?? businessNode.measured,
    };
  });
}

/** Position-only updates never normalize or clone unrelated node data. */
export function applyCanvasPositionChanges<T extends Pick<CanvasRenderNodeLike, "id" | "position">>(
  nodes: T[],
  changes: readonly { id: string; position?: { x: number; y: number } }[],
): T[] {
  const positions = new Map(changes.filter((change) => change.position).map((change) => [change.id, change.position!]));
  let changed = false;
  const next = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? next : nodes;
}
