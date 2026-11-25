/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { expect, it, vi } from "vitest";
import { ToolShell } from "@/components/layout/tool-shell";

vi.mock("@/components/ui/media-assets-drawer", () => ({ MediaAssetsDrawer: () => null }));
vi.mock("@/components/media-library/media-library-panel", () => ({ MediaLibraryPanel: () => null }));

it("anchors the desktop toggle to the tool grid from the first render", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(React.createElement(ToolShell, {
        tabs: [],
        children: React.createElement("input", { defaultValue: "图片提示词" }),
      }));
    });

    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="收起工具区"]')!;
    const toolbox = host.querySelector("section")!;
    const draft = toolbox.querySelector("input")!;
    expect(toggle.parentElement).toBe(toolbox.parentElement);
    expect(toggle.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "right-0", "hidden", "lg:inline-flex"]));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(toolbox.id);

    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-label")).toBe("打开创作");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.classList.contains("left-0")).toBe(true);
    expect(toolbox.classList.contains("lg:hidden")).toBe(true);

    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toolbox.classList.contains("lg:hidden")).toBe(false);
    expect(toolbox.querySelector("input")).toBe(draft);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
