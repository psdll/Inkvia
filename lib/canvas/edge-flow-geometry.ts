export type FlowLine = { x1: number; y1: number; x2: number; y2: number; from: number; to: number };
type Point = { x: number; y: number };
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Flatten a cubic once per viewport change, then clip it before animation.
// Sending very long offscreen dashed curves to Canvas still burdens rasterization.
export function getVisibleFlowLines(d: string, m: DOMMatrix, left: number, top: number, width: number, height: number): FlowLine[] | null {
  if (!/^M[^a-z]*C[^a-z]*$/i.test(d)) return null;
  const values = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  if (!values || values.length !== 8) return null;
  const points: Point[] = [];
  for (let i = 0; i < 8; i += 2) points.push({ x: m.a * values[i] + m.c * values[i + 1] + m.e - left, y: m.b * values[i] + m.d * values[i + 1] + m.f - top });
  const polyline: Point[] = [points[0]];
  function flatten(a: Point, b: Point, c: Point, end: Point, depth: number) {
    const chord = Math.hypot(end.x - a.x, end.y - a.y);
    const polygon = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(end.x - c.x, end.y - c.y);
    const distance = (p: Point) => chord ? Math.abs((end.x - a.x) * (a.y - p.y) - (a.x - p.x) * (end.y - a.y)) / chord : Math.hypot(p.x - a.x, p.y - a.y);
    if (depth >= 12 || (Math.max(distance(b), distance(c)) <= .25 && polygon - chord <= .25)) { polyline.push(end); return; }
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, end);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd);
    flatten(a, ab, abc, center, depth + 1); flatten(center, bcd, cd, end, depth + 1);
  }
  flatten(points[0], points[1], points[2], points[3], 0);
  const lengths = [0];
  for (let i = 1; i < polyline.length; i++) lengths.push(lengths[i - 1] + Math.hypot(polyline[i].x - polyline[i - 1].x, polyline[i].y - polyline[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (!total) return [];
  const lines: FlowLine[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1], b = polyline[i], dx = b.x - a.x, dy = b.y - a.y;
    let low = 0, high = 1;
    // Liang–Barsky clipping, padded for the line's antialiased edge.
    for (const [p, q] of [[-dx, a.x + 4], [dx, width + 4 - a.x], [-dy, a.y + 4], [dy, height + 4 - a.y]]) {
      if (p === 0) { if (q < 0) high = -1; continue; }
      if (p < 0) low = Math.max(low, q / p); else high = Math.min(high, q / p);
    }
    if (low >= high) continue;
    const start = lengths[i - 1], length = lengths[i] - start;
    lines.push({ x1: a.x + dx * low, y1: a.y + dy * low, x2: a.x + dx * high, y2: a.y + dy * high, from: (start + length * low) / total * 300, to: (start + length * high) / total * 300 });
  }
  return lines;
}

export function traceFlowStroke(lines: FlowLine[], phase: number, part: "tail" | "head", pen: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo">): void {
  for (const line of lines) {
    let cursor = line.from;
    while (cursor < line.to - 1e-8) {
      const cycle = Math.floor((cursor - phase + 1e-7) / 100);
      const local = cursor - phase - cycle * 100;
      const boundary = local < 24 - 1e-7 ? 24 : local < 36 - 1e-7 ? 36 : 100;
      const end = Math.min(line.to, phase + cycle * 100 + boundary);
      if (boundary === (part === "tail" ? 24 : 36)) {
        const a = (cursor - line.from) / (line.to - line.from), b = (end - line.from) / (line.to - line.from);
        pen.moveTo(line.x1 + (line.x2 - line.x1) * a, line.y1 + (line.y2 - line.y1) * a);
        pen.lineTo(line.x1 + (line.x2 - line.x1) * b, line.y1 + (line.y2 - line.y1) * b);
      }
      cursor = end;
    }
  }
}
