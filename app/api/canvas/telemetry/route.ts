import { NextRequest, NextResponse } from "next/server";
import {
  CANVAS_COUNTER_METRICS,
  CANVAS_HISTOGRAM_METRICS,
  canvasMetrics,
  type CanvasCounterMetric,
  type CanvasHistogramMetric,
} from "@/lib/canvas/observability";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const counters = new Set<string>(CANVAS_COUNTER_METRICS);
const histograms = new Set<string>(CANVAS_HISTOGRAM_METRICS);

export async function POST(req: NextRequest) {
  if (!(await getUserId(req))) return NextResponse.json({ success: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    observations?: Array<{ name?: string; value?: number }>;
    increments?: Array<{ name?: string; value?: number }>;
  } | null;
  if (!body) return NextResponse.json({ success: false }, { status: 400 });
  for (const item of (body.observations || []).slice(0, 20)) {
    if (item.name && histograms.has(item.name)) canvasMetrics.observe(item.name as CanvasHistogramMetric, Number(item.value));
  }
  for (const item of (body.increments || []).slice(0, 20)) {
    if (item.name && counters.has(item.name)) canvasMetrics.increment(item.name as CanvasCounterMetric, Number(item.value));
  }
  return NextResponse.json({ success: true });
}
