import RBush from "rbush";

export type MarqueeRect = { x: number; y: number; width: number; height: number };
export type MarqueeCandidate = MarqueeRect & { id: string; parentId?: string; hidden?: boolean; selectable?: boolean };
type Item = { minX: number; minY: number; maxX: number; maxY: number; id: string; order: number };

/** Build once per gesture using current absolute measured bounds. */
export function createMarqueeIndex(nodes: readonly MarqueeCandidate[], parentId?: string) {
  const bounds = new Map(nodes.map((node, order) => [node.id, {
    minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height, id: node.id, order,
  }]));
  for (const node of nodes) {
    const parent = node.parentId ? bounds.get(node.parentId) : undefined;
    if (!parent || node.hidden) continue;
    parent.minX = Math.min(parent.minX, node.x);
    parent.minY = Math.min(parent.minY, node.y);
    parent.maxX = Math.max(parent.maxX, node.x + node.width);
    parent.maxY = Math.max(parent.maxY, node.y + node.height);
  }
  const tree = new RBush<Item>();
  tree.load(nodes.filter((node) => (node.parentId || undefined) === parentId && !node.hidden && node.selectable !== false).map((node) => bounds.get(node.id)!));
  return (rect: MarqueeRect) => tree.search({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height })
    .filter((item) => rect.x < item.maxX && rect.x + rect.width > item.minX && rect.y < item.maxY && rect.y + rect.height > item.minY)
    .sort((a, b) => a.order - b.order).map((item) => item.id);
}

export function stableMarqueeIds(current: string[], next: string[]): string[] {
  const ids = new Set(next);
  return current.length === next.length && current.every((id) => ids.has(id)) ? current : next;
}

export function sampledPathIntersectsRect(points: readonly { x: number; y: number }[], rect: MarqueeRect): boolean {
  return points.some((point, index) => {
    if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return true;
    const previous = points[index - 1];
    if (!previous) return false;
    // Clip the segment, so sparse samples cannot skip a small selection box.
    let enter = 0;
    let exit = 1;
    for (const axis of ["x", "y"] as const) {
      const delta = point[axis] - previous[axis];
      const min = rect[axis];
      const max = min + (axis === "x" ? rect.width : rect.height);
      if (delta === 0) {
        if (previous[axis] < min || previous[axis] > max) return false;
        continue;
      }
      const from = (min - previous[axis]) / delta;
      const to = (max - previous[axis]) / delta;
      enter = Math.max(enter, Math.min(from, to));
      exit = Math.min(exit, Math.max(from, to));
      if (enter > exit) return false;
    }
    return true;
  });
}

/** Keep the latest update, and synchronously publish it on pointer release. */
export function createMarqueeFrame<T>(publish: (value: T) => void, request: (callback: () => void) => number, cancel: (id: number) => void) {
  let frame: number | null = null;
  let latest: T | undefined;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    if (latest !== undefined) { const value = latest; latest = undefined; publish(value); }
  };
  return {
    push(value: T) { latest = value; if (frame === null) frame = request(flush); },
    flush,
    cancel() { if (frame !== null) cancel(frame); frame = null; latest = undefined; },
  };
}
