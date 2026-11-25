type Point = { x: number; y: number };
type PathGeometry = { getTotalLength(): number; getPointAtLength(length: number): Point };
const lookups = new WeakMap<SVGPathElement, { d: string | null; lookup: ReturnType<typeof createCanvasEdgePointLookup> }>();
export function getCanvasEdgePointLookup(path: SVGPathElement) {
  const d = path.getAttribute("d");
  let cached = lookups.get(path);
  if (!cached || cached.d !== d) {
    cached = { d, lookup: createCanvasBezierPointLookup(d) ?? createCanvasEdgePointLookup(path) };
    lookups.set(path, cached);
  }
  return cached.lookup;
}

function canvasBezierPoint(d: string | null) {
  if (!d) return null;
  const number = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
  const values = d.match(number)?.map(Number);
  if (d.replace(number, "").replace(/[\s,]/g, "") !== "MC" || values?.length !== 8 || !values.every(Number.isFinite)) return null;
  return (t: number): Point => {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    return { x: a * values[0] + b * values[2] + c * values[4] + e * values[6], y: a * values[1] + b * values[3] + c * values[5] + e * values[7] };
  };
}

const selectionSamples = new WeakMap<SVGPathElement, { d: string | null; points: Point[] }>();

/** Selection needs curve coordinates, not expensive browser arc-length integration. */
export function getCanvasEdgeSelectionPoints(path: SVGPathElement): Point[] {
  const d = path.getAttribute("d");
  const cached = selectionSamples.get(path);
  if (cached?.d === d) return cached.points;
  const point = canvasBezierPoint(d);
  const length = point ? 0 : path.getTotalLength();
  const points = Array.from({ length: 65 }, (_, i) => {
    const value = point ? point(i / 64) : path.getPointAtLength(length * i / 64);
    return { x: value.x, y: value.y };
  });
  selectionSamples.set(path, { d, points });
  return points;
}

/** React Flow's single cubic curve needs no SVG arc-length integration on hover. */
export function createCanvasBezierPointLookup(d: string | null) {
  const point = canvasBezierPoint(d);
  if (!point) return null;
  const samples = Array.from({ length: 65 }, (_, i) => point(i / 64));
  const distance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  return (cursor: Point): Point | null => {
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (distance(samples[i], cursor) < distance(samples[best], cursor)) best = i;
    let from = Math.max(0, best - 1) / 64, to = Math.min(64, best + 1) / 64;
    for (let i = 0; i < 32; i++) {
      const a = from + (to - from) / 3, b = to - (to - from) / 3;
      if (distance(point(a), cursor) <= distance(point(b), cursor)) to = b;
      else from = a;
    }
    const closest = point((from + to) / 2);
    // Exact endpoints must remain exact, including a zero-length curve.
    return [samples[0], samples[64], closest].reduce((a, b) => distance(a, cursor) <= distance(b, cursor) ? a : b);
  };
}

/** Geometry changes invalidate the lookup; cursor movement never rebuilds it. */
export function createCanvasEdgePointLookup(path: PathGeometry) {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) return () => null;
  const points = Array.from({ length: 81 }, (_, i) => path.getPointAtLength(length * i / 80));
  const distance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  return (cursor: Point): Point | null => {
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (distance(points[i], cursor) < distance(points[best], cursor)) best = i;
    let point = points[best];
    const from = Math.max(0, best - 1) / 80;
    const to = Math.min(80, best + 1) / 80;
    for (let i = 0; i <= 10; i++) {
      const candidate = path.getPointAtLength(length * (from + (to - from) * i / 10));
      if (distance(candidate, cursor) < distance(point, cursor)) point = candidate;
    }
    return { x: point.x, y: point.y };
  };
}
