import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCanvasConnectionAutoPan } from "@/lib/canvas/connection-auto-pan";

// Compare against the exact XYFlow dependency used by the single-node handler.
const require = createRequire(import.meta.url);
const reactFlowRequire = createRequire(require.resolve("@xyflow/react"));
const { calcAutoPan } = reactFlowRequire("@xyflow/system");

function setup() {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const bounds = { left: 100, top: 80, width: 800, height: 600 };
  const state = {
    domNode: { getBoundingClientRect: () => bounds } as HTMLDivElement,
    autoPanOnConnect: true,
    autoPanSpeed: 15,
    panBy: vi.fn(async (_delta: { x: number; y: number }) => true),
  };
  let pointer: { clientX: number; clientY: number } | null = null;
  const onPan = vi.fn();
  const stop = startCanvasConnectionAutoPan(() => state, () => pointer, onPan);
  return {
    state, bounds, frames, onPan, stop,
    point: (x: number, y: number) => { pointer = { clientX: x, clientY: y }; },
    tick: async () => {
      const pending = Array.from(frames.values());
      frames.clear();
      for (const callback of pending) await callback(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("multi-connection automatic viewport panning", () => {
  it.each([[105, 380], [895, 380], [500, 85], [500, 675], [895, 675]])("matches single-node panning at screen point %s,%s", async (x, y) => {
    const test = setup();
    test.point(x, y);
    test.state.autoPanSpeed = 23;
    await test.tick();
    const [dx, dy] = calcAutoPan({ x: x - test.bounds.left, y: y - test.bounds.top }, test.bounds, 23);
    expect(test.state.panBy).toHaveBeenCalledWith({ x: dx, y: dy });
    expect(test.onPan).toHaveBeenCalledOnce();
    test.stop();
  });

  it("continues with a stationary edge pointer, refreshes the endpoint after pan, and stops in the center", async () => {
    const test = setup();
    await test.tick();
    expect(test.state.panBy).not.toHaveBeenCalled();
    test.point(895, 380);
    let viewportX = 0;
    let endpoint = 0;
    test.state.panBy.mockImplementation(async ({ x }) => { viewportX += x; return true; });
    test.onPan.mockImplementation(() => { endpoint = (895 - 100 - viewportX) / 0.23; });
    await test.tick();
    const firstEndpoint = endpoint;
    await test.tick();
    expect(test.state.panBy).toHaveBeenCalledTimes(2);
    expect(endpoint).toBeGreaterThan(firstEndpoint);
    expect(endpoint * 0.23 + viewportX + 100).toBeCloseTo(895);
    test.point(500, 380);
    await test.tick();
    expect(test.state.panBy).toHaveBeenCalledTimes(2);
    test.stop();
    expect(test.frames.size).toBe(0);
  });

  it("honors the single-node auto-pan switch and constrained viewport", async () => {
    const test = setup();
    test.point(895, 380);
    test.state.autoPanOnConnect = false;
    await test.tick();
    expect(test.state.panBy).not.toHaveBeenCalled();
    test.state.autoPanOnConnect = true;
    test.state.panBy.mockResolvedValue(false);
    await test.tick();
    expect(test.onPan).not.toHaveBeenCalled();
    test.stop();
  });

  it("does not restart or publish after cancellation during a pending pan", async () => {
    const test = setup();
    test.point(895, 380);
    let finish!: (value: boolean) => void;
    test.state.panBy.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const ticking = test.tick();
    test.stop();
    finish(true);
    await ticking;
    expect(test.onPan).not.toHaveBeenCalled();
    expect(test.frames.size).toBe(0);
  });
});
