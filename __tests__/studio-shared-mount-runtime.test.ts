import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioToolTabs } from "@/components/studio/studio-tool-tabs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("StudioToolTabs", () => {
  it("renders two evenly sized options without face replacement", async () => {
    const onSelectTool = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(StudioToolTabs, {
        activeTool: "image",
        onSelectTool,
      }));
    });

    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "图片生成",
      "视频生成",
    ]);
    expect(buttons[0]?.parentElement?.className).toContain("grid-cols-2");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTool).toHaveBeenCalledWith("video");

    await act(async () => root.unmount());
  });

  it("keeps inactive hover visually distinct from the selected fill", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(StudioToolTabs, {
        activeTool: "image",
        onSelectTool: vi.fn(),
      }));
    });

    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons[0]?.className).toContain("bg-[var(--panel-2)]");
    expect(buttons[1]?.className).not.toContain("hover:bg-[var(--panel-2)]");
    expect(buttons[1]?.className).toContain(
      "hover:bg-[color-mix(in_srgb,var(--panel-2)_45%,transparent)]",
    );

    await act(async () => root.unmount());
  });

  it("switches the selected button without animating its fill or border width", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSelectTool = vi.fn();

    await act(async () => {
      root.render(React.createElement(StudioToolTabs, {
        activeTool: "image",
        onSelectTool,
      }));
    });

    await act(async () => {
      root.render(React.createElement(StudioToolTabs, {
        activeTool: "video",
        onSelectTool,
      }));
    });

    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true"))
      .toEqual([buttons[1]]);
    for (const button of buttons) {
      expect(button.className).toContain("border");
      expect(button.className).toContain("transition-[color]");
      expect(button.className).not.toContain("transition-all");
    }
    expect(buttons[0]?.className).toContain("border-transparent");
    expect(buttons[1]?.className).toContain("border-[var(--border)]");

    await act(async () => root.unmount());
  });
});
