// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindCanvasEdgeViewport } from "@/lib/canvas/edge-viewport";

describe("screen-sized edge layer", () => {
  it("promotes the bounded edge container, never individual world-sized SVG paths", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const rules = styles.match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const edgeRules = rules.filter(rule => rule.includes(".react-flow__edges"));
    expect(edgeRules.some(rule => !rule.split("{")[0].includes("svg") && rule.includes("will-change: transform"))).toBe(true);
    expect(edgeRules.filter(rule => rule.split("{")[0].includes("svg")).some(rule => /will-change:\s*transform/.test(rule))).toBe(false);
  });
  it("covers the visible screen through zoom and pan without rewriting SVG coordinates", () => {
    const edges = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    edges.append(svg);
    let state: { transform: [number, number, number]; width: number; height: number } = { transform: [0, 0, .1], width: 1355, height: 744 };
    const binding = bindCanvasEdgeViewport(edges, () => state);
    for (const zoom of [.1, .2, .25, .3, .4, .5, 1, 2, 4, 8, .4, .2, .1]) {
      for (const [x, y] of [[0, 0], [-2433.47, 1879.86], [810, -529], [-26000, -18000]]) {
        state = { ...state, transform: [x, y, zoom] }; binding.update();
        expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
        expect(svg.style.width).toBe("");
        const rasterZoom = Number(edges.style.getPropertyValue("--canvas-edge-raster-zoom"));
        const left = -parseFloat(edges.style.getPropertyValue("--canvas-edge-offset-x"));
        const top = -parseFloat(edges.style.getPropertyValue("--canvas-edge-offset-y"));
        const right = left + parseFloat(edges.style.width) / rasterZoom;
        const bottom = top + parseFloat(edges.style.height) / rasterZoom;
        expect(parseFloat(edges.style.width)).toBeCloseTo(state.width + 512);
        expect(parseFloat(edges.style.height)).toBeCloseTo(state.height + 512);
        expect(edges.style.transform).toBe(`translate(${left}px, ${top}px) scale(${1 / rasterZoom})`);
        // The shared crop must never intersect the visible screen.
        expect(left * zoom + x).toBeLessThanOrEqual(.00001);
        expect(top * zoom + y).toBeLessThanOrEqual(.00001);
        expect(right * zoom + x).toBeGreaterThanOrEqual(state.width - .00001);
        expect(bottom * zoom + y).toBeGreaterThanOrEqual(state.height - .00001);
      }
    }
    binding.dispose();
    expect(edges.style.clipPath).toBe("");
    expect(edges.style.transform).toBe("");
    expect(edges.style.width).toBe("");
    expect(edges.hasAttribute("data-canvas-edge-viewport")).toBe(false);
  });

  it("caps screen stroke width without thickening overview lines or mutating every edge", () => {
    const edges = document.createElement("div");
    let zoom = .1;
    const binding = bindCanvasEdgeViewport(edges, () => ({ transform: [0, 0, zoom], width: 1355, height: 792 }));
    for (zoom of [.1, .2, .5, 1, 2, 4, 8, 1.1, .1]) {
      binding.update();
      const unit = parseFloat(edges.style.getPropertyValue("--canvas-edge-unit"));
      expect(2 * unit * zoom).toBeCloseTo(Math.min(2, 2 * zoom));
    }
    binding.dispose();
    expect(edges.style.getPropertyValue("--canvas-edge-unit")).toBe("");
  });

  it("newly mounted SVGs need no asynchronous coordinate patch or per-edge mutation", () => {
    const edges = document.createElement("div");
    const binding = bindCanvasEdgeViewport(edges, () => ({ transform: [-200, 100, .5], width: 1000, height: 800 }));
    const transform = edges.style.transform;
    for (let i = 0; i < 453; i++) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M -10000 0 C -5000 0 5000 0 10000 0");
      svg.append(path); edges.append(svg);
      expect(svg.hasAttribute("viewBox")).toBe(false);
    }
    binding.update();
    expect(edges.style.transform).toBe(transform);
    expect(edges.hasAttribute("data-canvas-edge-viewport")).toBe(true);
    expect(edges.querySelectorAll("[viewBox]")).toHaveLength(0);
    binding.dispose();
  });

  it("reuses overscan during short pans and restores existing clip on cleanup", () => {
    const edges = document.createElement("div"); edges.style.clipPath = "inset(0px)";
    let x = 0;
    const binding = bindCanvasEdgeViewport(edges, () => ({ transform: [x, 0, .3], width: 1000, height: 800 }));
    const transform = edges.style.transform;
    for (x = 1; x < 100; x++) { binding.update(); expect(edges.style.transform).toBe(transform); }
    x = 600; binding.update(); expect(edges.style.transform).not.toBe(transform);
    binding.dispose(); expect(edges.style.clipPath).toBe("inset(0px)");
  });
});
