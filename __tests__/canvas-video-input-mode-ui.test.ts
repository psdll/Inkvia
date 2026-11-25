// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import { sora2Models } from "@/lib/sora2";

const models = vi.hoisted(() => ({ video: [] as any[] }));
vi.mock("@/components/canvas/use-canvas-models", async original => ({ ...await original<any>(), useCanvasModels: () => models }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  models.video = sora2Models;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(sora2Models)("only enables text mode for an empty $id node", async spec => {
  await act(async () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasNodeEditorContext.Provider, { value: {
      getTaskAssets: () => [], hasTaskMediaReferences: () => false,
      isPanelVisible: () => true, isTaskPanelVisible: () => true,
      getTaskResultName: () => "视频", getMediaName: () => "视频",
    } as any }, React.createElement(CanvasNodeCard, {
      id: "task", type: "videoTask", selected: true, dragging: false,
      data: { kind: "videoTask", model: spec.id, inputMode: "multimodal", prompt: "", mediaPaths: [], status: "idle" },
      isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    })),
  )));
  const trigger = host.querySelector<HTMLButtonElement>("[data-canvas-video-parameter-trigger]")!;
  expect(trigger.firstElementChild?.textContent).toBe("文生视频 ·");
  await act(async () => trigger.click());
  const enabled = [...document.querySelectorAll<HTMLButtonElement>('section[aria-label="视频生成模式"] button:not(:disabled)')];
  expect(enabled.map(option => option.textContent)).toEqual(["文生视频"]);
  expect(enabled[0].dataset.selected).toBe("true");
});
