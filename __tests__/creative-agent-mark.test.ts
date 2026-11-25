// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AgentMark from "@/components/creative-agent/AgentMark";
import AgentMarkdown from "@/components/creative-agent/AgentMarkdown";
import BrandLogo from "@/components/ui/BrandLogo";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("gives every brand and Agent instance its own shared paint for the original dot and stroke", async () => {
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(BrandLogo), React.createElement(BrandLogo, { variant: "wordmark" }), React.createElement(AgentMark, { state: "idle" }), React.createElement(AgentMark, { state: "thinking" }))));
  const marks = [...host.querySelectorAll("svg")];
  const ids = marks.map(mark => mark.querySelector("linearGradient")!.id);
  expect(new Set(ids).size).toBe(4);
  for (const [index, mark] of marks.entries()) {
    // The Agent mark crops its viewBox to the logo so it reads larger at 18px.
    expect(mark.getAttribute("viewBox")).toBe(index < 2 ? "0 0 64 64" : "7 8 48 48");
    expect([...mark.querySelectorAll("stop")].map(stop => stop.getAttribute("stop-color"))).toEqual(["#2EE6A8", "#8A7BFF"]);
    const dot = mark.querySelector("circle")!;
    expect(["cx", "cy", "r"].map(name => dot.getAttribute(name))).toEqual(["21", "16", "6.5"]);
    expect(dot.getAttribute("fill")).toBe(`url(#${ids[index]})`);
    // The white glint is a highlight layer on top of the stroke, not part of the logo paint.
    if (index >= 2) expect(mark.querySelectorAll('path[stroke="#fff"]')).toHaveLength(1);
    for (const path of mark.querySelectorAll('path:not([stroke="#fff"])')) {
      expect(path.getAttribute("d")).toBe("M21 30V40Q21 50 31 50H43");
      expect(path.getAttribute("stroke-width")).toBe("9");
      expect(path.getAttribute("stroke")).toBe(`url(#${ids[index]})`);
    }
  }
});

it("switches animation states without replacing the mark or its gradient", async () => {
  await act(async () => root.render(React.createElement(AgentMark, { state: "idle", size: 18 })));
  const mark = host.querySelector("svg")!;
  const id = mark.querySelector("linearGradient")!.id;
  for (const state of ["thinking", "done", "idle"] as const) {
    await act(async () => root.render(React.createElement(AgentMark, { state, size: 18 })));
    expect(host.querySelector("svg")).toBe(mark);
    expect(mark.dataset.state).toBe(state);
    expect(mark.querySelector("linearGradient")!.id).toBe(id);
    // base outline (always visible), trail, flowing segment, glint
    expect([...mark.querySelectorAll("path")].map(path => path.getAttribute("pathLength"))).toEqual([null, "100", "100", "100"]);
  }
});

it("finishes the reasoning mark while retaining the reasoning text and duration", async () => {
  const thinking = { content: "核对构图和素材", streaming: true, duration: 1.5 };
  await act(async () => root.render(React.createElement(AgentMarkdown, { text: "", streaming: true, thinking })));
  expect(host.querySelector("summary svg")?.getAttribute("data-state")).toBe("thinking");
  expect(host.textContent).toContain("思考中...");
  await act(async () => root.render(React.createElement(AgentMarkdown, { text: "完成", thinking: { ...thinking, streaming: false } })));
  expect(host.querySelector("summary svg")?.getAttribute("data-state")).toBe("done");
  expect(host.textContent).toContain("思考过程");
  expect(host.textContent).toContain("1.5 秒");
});
