import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCanvasAlignment, type CanvasAlignmentRect } from "@/lib/canvas/alignment-guides";

const styles = readFileSync("app/globals.css", "utf8");

function rect(id: string, x: number, y: number, width = 100, height = 80): CanvasAlignmentRect {
  return { id, x, y, width, height };
}

describe("canvas alignment guides", () => {
  it("requires an anchor inside the supplied threshold", () => {
    expect(resolveCanvasAlignment(rect("moving", 192, 20), [rect("target", 300, 400)], 8).guides).toEqual([]);
    expect(resolveCanvasAlignment(rect("moving", 193, 20), [rect("target", 300, 400)], 8).offset.x).toBe(7);
  });
  it("snaps matching edges and returns the corresponding vertical guide", () => {
    const result = resolveCanvasAlignment(rect("moving", 196, 30), [rect("target", 300, 400)], 6);

    expect(result.offset).toEqual({ x: 4, y: 0 });
    expect(result.guides).toMatchObject([{ axis: "x", value: 300, start: 30, end: 480 }]);
  });

  it("snaps center anchors independently on each axis", () => {
    const result = resolveCanvasAlignment(rect("moving", 199, 98), [rect("target", 200, 100)], 4);

    expect(result.offset).toEqual({ x: 1, y: 2 });
    expect(result.guides.filter(g => g.axis === "x").map(g => g.value)).toEqual([200, 250, 300]);
    expect(result.guides.filter(g => g.axis === "y").map(g => g.value)).toEqual([100, 140, 180]);
  });

  it("does not snap when every anchor falls outside the threshold", () => {
    const result = resolveCanvasAlignment(rect("moving", 190, 20), [rect("target", 300, 400)], 6);

    expect(result).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
  });

  it("chooses the closest candidate anchor to avoid visible guide jumping", () => {
    const result = resolveCanvasAlignment(rect("moving", 198, 10), [rect("near", 300, 400), rect("far", 304, 600)], 8);

    expect(result.offset.x).toBe(2);
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: "x", value: 300 }));
  });

  it("keeps the same screen-space capture radius at different zoom levels", () => {
    for (const zoom of [0.2, 0.6, 1, 2]) {
      const result = resolveCanvasAlignment(rect("moving", 300 - 5 / zoom, 0), [rect("target", 300, 400)], 8 / zoom);
      expect(result.offset.x * zoom).toBeCloseTo(5);
    }
  });
  it("prefers object alignment over the grid and does not quantize every drag step", () => {
    expect(resolveCanvasAlignment(rect("moving", 196, 31), [rect("target", 300, 400)], 8, {gridSize:12}).offset).toEqual({x:4,y:0});
    expect(resolveCanvasAlignment(rect("moving", 193, 31), [], 8, {gridSize:12}).offset).toEqual({x:-1,y:0});
  });
  it("recognizes distant references and breaks equal-distance ties by proximity", () => {
    expect(resolveCanvasAlignment(rect("moving", 198, 0), [rect("far", 300, 9000)], 8).offset.x).toBe(2);
    const result = resolveCanvasAlignment(rect("moving", 198, 0), [rect("far", 300, 600),rect("near", 296, 150)], 8);
    expect(result.offset.x).toBe(-2);
  });
  it("retains the captured anchor until the pointer leaves its release radius", () => {
    const candidates = [rect("one",300,400),rect("two",306,400)];
    const first = resolveCanvasAlignment(rect("moving",198,0),candidates,8);
    const retained = resolveCanvasAlignment(rect("moving",205,0),candidates,8,{previousGuides:first.guides});
    expect(retained.offset.x).toBe(-5);
    const released = resolveCanvasAlignment(rect("moving",213,0),candidates,8,{previousGuides:first.guides});
    expect(released.offset.x).toBe(-7);
  });
  it("does not confuse edges with centers", () => {
    expect(resolveCanvasAlignment(rect("moving",149,0),[rect("target",200,400)],4).guides).toEqual([]);
  });

  it("shows exactly three horizontal lines for a distant aligned row without duplicates", () => {
    const result = resolveCanvasAlignment(rect("moving", 3000, 99), [rect("a",0,100),rect("b",500,100)], 8);
    expect(result.guides.map(g => [g.axis,g.value])).toEqual([["y",100],["y",140],["y",180]]);
  });
  it("shows exactly three vertical lines for a distant aligned column", () => {
    const result = resolveCanvasAlignment(rect("moving",99,5000), [rect("a",100,0)], 8);
    expect(result.guides.map(g => [g.axis,g.value])).toEqual([["x",100],["x",150],["x",200]]);
  });

  it.each(["above", "below", "left", "right"])("prioritizes a nearby %s neighbor over a more exact distant anchor", direction => {
    const vertical = direction === "above" || direction === "below";
    const sign = direction === "above" || direction === "left" ? -1 : 1;
    const moving = rect("moving",0,0);
    const near = vertical ? rect("near",5,sign*180) : rect("near",sign*200,5);
    const far = vertical ? rect("far",1,sign*4000) : rect("far",sign*4000,1);
    const axis = vertical ? "x" : "y";
    for (const candidates of [[near,far],[far,near]]) {
      expect(resolveCanvasAlignment(moving,candidates,8).offset[axis]).toBe(5);
    }
  });
  it("releases a distant captured line when a nearby target enters capture range", () => {
    const far = rect("far",1,4000);
    const first = resolveCanvasAlignment(rect("moving",0,0),[far],8);
    const result = resolveCanvasAlignment(rect("moving",0,0),[far,rect("near",5,180)],8,{previousGuides:first.guides});
    expect(result.offset.x).toBe(5);
  });
  it("keeps a nearby captured line despite a more exact distant line", () => {
    const near = rect("near",5,180);
    const first = resolveCanvasAlignment(rect("moving",0,0),[near],8);
    const result = resolveCanvasAlignment(rect("moving",1,0),[near,rect("far",1,4000)],8,{previousGuides:first.guides});
    expect(result.offset.x).toBe(4);
  });
  it("falls back to distant alignment when the nearby node is outside capture range", () => {
    expect(resolveCanvasAlignment(rect("moving",0,0),[rect("near",20,180),rect("far",1,4000)],8).offset.x).toBe(1);
  });
  it("preserves neighborhood priority at different zoom levels", () => {
    for (const zoom of [0.2,0.6,1,2]) {
      const scaled = (id: string,x: number,y: number) => rect(id,x/zoom,y/zoom,100/zoom,80/zoom);
      expect(resolveCanvasAlignment(scaled("moving",0,0),[scaled("near",5,180),scaled("far",1,4000)],8/zoom).offset.x*zoom).toBeCloseTo(5);
    }
  });

  it("renders thin one-pixel guides without a widening glow", () => {
    const guideStyles = styles.slice(
      styles.indexOf(".canvas-alignment-guide {"),
      styles.indexOf(".canvas-alignment-guide-horizontal"),
    );

    expect(guideStyles).toContain("opacity: 0.62");
    expect(guideStyles).toContain("filter: none");
    expect(guideStyles).not.toContain("drop-shadow");
  });
});
