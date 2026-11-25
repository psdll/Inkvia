import type { MetricPoint } from "./metric-health";

/** Percentage charts share a fixed scale; missing samples must not imply continuity. */
export function buildResourceTrend(points: MetricPoint[], stepMs = 60_000) {
  const samples = [...points]
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const start = samples[0]?.timestamp ?? 0;
  const end = samples[samples.length - 1]?.timestamp ?? start;
  const segments: Array<{ path: string; area: string }> = [];
  let segment: Array<{ x: number; y: number }> = [];
  let previous: number | null = null;
  const flush = () => {
    if (segment.length >= 2) {
      const path = segment.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
      segments.push({ path, area: `${path} L ${segment[segment.length - 1].x.toFixed(2)} 100 L ${segment[0].x.toFixed(2)} 100 Z` });
    }
    segment = [];
  };
  for (const sample of samples) {
    if (!Number.isFinite(sample.value) || sample.value < 0 || sample.value > 100) {
      flush();
      previous = null;
      continue;
    }
    if (previous !== null && sample.timestamp - previous > stepMs * 1.5) flush();
    if (previous === sample.timestamp) continue;
    segment.push({ x: ((sample.timestamp - start) / Math.max(1, end - start)) * 300, y: 100 - sample.value });
    previous = sample.timestamp;
  }
  flush();
  return { segments, start, end };
}
