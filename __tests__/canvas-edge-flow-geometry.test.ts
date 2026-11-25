import { afterEach, expect, it, vi } from "vitest";
import { traceFlowStroke, getVisibleFlowLines } from "@/lib/canvas/edge-flow-geometry";
const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix;
afterEach(() => vi.unstubAllGlobals());

it("clips long curves at the screen edge while retaining their original flow phase", () => {
  const lines = getVisibleFlowLines("M-10000,50 C0,50 10000,50 20000,50", matrix, 0, 0, 1000, 800)!;
  expect(lines).toHaveLength(1);
  expect(lines[0].x1).toBeCloseTo(-4); expect(lines[0].x2).toBeCloseTo(1004);
  expect(lines[0].from).toBeCloseTo(99.96); expect(lines[0].to).toBeCloseTo(110.04);
});
it("keeps curved screen crossings, excludes offscreen curves, and supports reversed curves", () => {
  const lines = getVisibleFlowLines("M-100,100 C200,0 800,800 1100,700", matrix, 0, 0, 1000, 800)!;
  expect(lines.length).toBeGreaterThan(8);
  expect(lines.every(l => l.x1 >= -4 && l.x2 <= 1004 && l.from < l.to)).toBe(true);
  expect(getVisibleFlowLines("M-100,-100 C200,-200 800,-300 1100,-100", matrix, 0, 0, 1000, 800)).toEqual([]);
  expect(getVisibleFlowLines("M2000,50 C1500,50 1000,50 -1000,50", matrix, 0, 0, 1000, 800)![0].x1).toBeCloseTo(1004);
  expect(getVisibleFlowLines("M0,0 L100,100", matrix, 0, 0, 1000, 800)).toBeNull();
});
it("handles zero-length geometry and applies viewport scale and translation", () => {
  expect(getVisibleFlowLines("M0,0 C0,0 0,0 0,0", matrix, 0, 0, 1000, 800)).toEqual([]);
  const lines = getVisibleFlowLines("M0,0 C100,0 200,0 300,0", { ...matrix, a: .5, d: .5, e: 300, f: 200 } as DOMMatrix, 10, 20, 1000, 800)!;
  expect(lines[0]).toEqual({ x1: 290, y1: 180, x2: 440, y2: 180, from: 0, to: 300 });
});
it("moves all three packets continuously, including fractional dash boundaries", () => {
  class Path { points: Array<[number, number]> = []; moveTo(x: number, y: number) { this.points.push([x,y]); } lineTo(x: number,y: number) { this.points.push([x,y]); } }
  const line = { x1: 0, y1: 0, x2: 300, y2: 0, from: 0, to: 300 };
  const tail = new Path(), head = new Path();
  traceFlowStroke([line], 0, "tail", tail); traceFlowStroke([line], 0, "head", head);
  expect(tail.points.map(p => p[0])).toEqual([0,24,100,124,200,224]);
  expect(head.points.map(p => p[0])).toEqual([24,36,124,136,224,236]);
  const shifted = new Path(); traceFlowStroke([line], 10, "head", shifted);
  shifted.points.forEach((p, i) => expect(p[0]).toBeCloseTo([34,46,134,146,234,246][i]));
  const fractional = new Path(); traceFlowStroke([{...line, from: 23.999999999999996}], .123456789, "head", fractional);
  expect(fractional.points.length).toBeGreaterThan(0);
  expect(fractional.points.every(p => p.every(Number.isFinite))).toBe(true);
});
