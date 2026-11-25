export type CanvasAlignmentAxis = "x" | "y";

export type CanvasAlignmentRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasAlignmentGuide = {
  axis: CanvasAlignmentAxis;
  value: number;
  start: number;
  end: number;
  movingAnchor: number;
};

export type CanvasAlignmentResult = {
  offset: { x: number; y: number };
  guides: CanvasAlignmentGuide[];
};

type AxisAlignment = { offset: number; guide: CanvasAlignmentGuide; distance: number; id: string } | null;

type AlignmentOptions = {
  gridSize?: number;
  previousGuides?: readonly CanvasAlignmentGuide[];
};

function anchors(rect: CanvasAlignmentRect, axis: CanvasAlignmentAxis): number[] {
  const start = axis === "x" ? rect.x : rect.y;
  const size = axis === "x" ? rect.width : rect.height;
  return [start, start + size / 2, start + size];
}

/** Sorted anchors preserve distant alignment without scanning the entire graph. */
export class CanvasAlignmentIndex {
  private readonly axes: Record<CanvasAlignmentAxis, { value: number; index: number }[]>;

  constructor(private readonly candidates: readonly CanvasAlignmentRect[]) {
    const build = (axis: CanvasAlignmentAxis) => candidates.flatMap((rect, index) =>
      anchors(rect, axis).map(value => ({ value, index }))).sort((a, b) => a.value - b.value);
    this.axes = { x: build("x"), y: build("y") };
  }

  query(moving: CanvasAlignmentRect, threshold: number): readonly CanvasAlignmentRect[] {
    const found = new Set<number>();
    // Include the release radius and the final guide matching tolerance. Both
    // snap axes (and grid fallback) remain inside this radius of the input.
    const radius = threshold * 1.5 + 0.0001;
    for (const axis of ["x", "y"] as const) {
      const entries = this.axes[axis];
      for (const anchor of anchors(moving, axis)) {
        let low = 0;
        let high = entries.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (entries[middle].value < anchor - radius) low = middle + 1;
          else high = middle;
        }
        // A dense row/column already needs most references. Avoid collecting
        // and sorting a nearly complete list on top of the existing resolver.
        const denseEnd = low + Math.ceil(this.candidates.length * 0.75) - 1;
        if (this.candidates.length && entries[denseEnd]?.value <= anchor + radius) return this.candidates;
        for (let i = low; i < entries.length && entries[i].value <= anchor + radius; i++) found.add(entries[i].index);
      }
    }
    // Preserve document order, including ties and the order of exact guides.
    return [...found].sort((a, b) => a - b).map(index => this.candidates[index]);
  }
}

function findAxisAlignment(
  moving: CanvasAlignmentRect,
  candidates: readonly CanvasAlignmentRect[],
  axis: CanvasAlignmentAxis,
  threshold: number,
  options: AlignmentOptions,
): AxisAlignment {
  let result: AxisAlignment = null;
  let retained: AxisAlignment = null;
  const movingAnchors = anchors(moving, axis);
  const cross = axis === "x" ? "y" : "x";
  const [from, , to] = anchors(moving, cross);
  const previous = options.previousGuides?.find(guide => guide.axis === axis);
  // The caller supplies a zoom-adjusted 8px threshold: this neighborhood is
  // therefore 240 screen pixels at every zoom. Distant anchors remain eligible.
  const neighborhood = threshold * 30;
  const isNearby = (match: NonNullable<AxisAlignment>) => match.distance <= neighborhood;
  const score = (match: NonNullable<AxisAlignment>) => Math.abs(match.offset) / threshold
    + (isNearby(match) ? 0.6 * match.distance / neighborhood : 0);
  const better = (match: NonNullable<AxisAlignment>, current: NonNullable<AxisAlignment>) => {
    if (isNearby(match) !== isNearby(current)) return isNearby(match);
    const difference = score(match) - score(current);
    return difference < 0 || (difference === 0 && (match.distance < current.distance
      || (match.distance === current.distance && match.id < current.id)));
  };
  for (const candidate of candidates) {
    if (candidate.id === moving.id) continue;
    const [otherFrom, , otherTo] = anchors(candidate, cross);
    const distance = Math.max(0, from - otherTo, otherFrom - to);
    const targetAnchors = anchors(candidate, axis);
    for (let targetIndex = 0; targetIndex < 3; targetIndex++) {
      for (let movingIndex = 0; movingIndex < 3; movingIndex++) {
        // Centers align to centers; edges align to edges, not arbitrary midpoints.
        if ((targetIndex === 1) !== (movingIndex === 1)) continue;
        const value = targetAnchors[targetIndex];
        const offset = value - movingAnchors[movingIndex];
        const match = { offset, distance, id: candidate.id, guide: {
          axis, value, movingAnchor: movingIndex, start: Math.min(from, otherFrom), end: Math.max(to, otherTo),
        } };
        if (previous?.value === value && previous.movingAnchor === movingIndex && Math.abs(offset) < threshold * 1.5) {
          if (!retained || distance < retained.distance) retained = match;
        }
        if (Math.abs(offset) >= threshold) continue;
        if (!result || better(match, result)) result = match;
      }
    }
  }
  // A previously captured distant line must not steal a newly available local
  // target. Within the same neighborhood keep the existing release hysteresis.
  if (retained && !(result && isNearby(result) && !isNearby(retained))) return retained;
  return result;
}

export function resolveCanvasAlignment(
  moving: CanvasAlignmentRect,
  references: readonly CanvasAlignmentRect[] | CanvasAlignmentIndex,
  threshold: number,
  options: AlignmentOptions = {},
): CanvasAlignmentResult {
  const candidates = references instanceof CanvasAlignmentIndex ? references.query(moving, threshold) : references;
  const x = findAxisAlignment(moving, candidates, "x", threshold, options);
  const y = findAxisAlignment(moving, candidates, "y", threshold, options);
  const gridOffset = (value: number) => {
    const grid = options.gridSize;
    if (!grid || grid <= 0) return 0;
    const offset = Math.round(value / grid) * grid - value;
    return Math.abs(offset) < Math.min(threshold * 0.35, grid / 4) ? offset : 0;
  };
  const offset = { x: x?.offset ?? gridOffset(moving.x), y: y?.offset ?? gridOffset(moving.y) };
  const aligned = { ...moving, x: moving.x + offset.x, y: moving.y + offset.y };
  // Keep the captured anchor first for hysteresis; also show every exact match
  // at the final position (both edges and center), without duplicate lines.
  const matched = new Map<string, CanvasAlignmentGuide>();
  for (const primary of [x?.guide, y?.guide]) {
    if (primary) {
      const value = anchors(aligned, primary.axis)[primary.movingAnchor];
      matched.set(`${primary.axis}:${value}`, { ...primary, value });
    }
  }
  for (const axis of ["x", "y"] as const) {
    const cross = axis === "x" ? "y" : "x";
    const [from, , to] = anchors(aligned, cross);
    const movingAnchors = anchors(aligned, axis);
    for (const candidate of candidates) {
      if (candidate.id === moving.id) continue;
      const [otherFrom, , otherTo] = anchors(candidate, cross);
      const targetAnchors = anchors(candidate, axis);
      for (let movingIndex = 0; movingIndex < 3; movingIndex++) {
        for (let targetIndex = 0; targetIndex < 3; targetIndex++) {
          if ((targetIndex === 1) !== (movingIndex === 1)) continue;
          if (Math.abs(movingAnchors[movingIndex] - targetAnchors[targetIndex]) > 0.0001) continue;
          const value = movingAnchors[movingIndex];
          const key = `${axis}:${value}`;
          const existing = matched.get(key);
          matched.set(key, { axis, value, movingAnchor: movingIndex,
            start: Math.min(existing?.start ?? Infinity, from, otherFrom),
            end: Math.max(existing?.end ?? -Infinity, to, otherTo) });
        }
      }
    }
  }
  const guides = [...matched.values()];
  return { offset, guides };
}
