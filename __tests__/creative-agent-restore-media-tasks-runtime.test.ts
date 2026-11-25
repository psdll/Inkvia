// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { buildCreativeAgentMediaTask } from "@/lib/creative-agent/media-task";
import { useRestoreAgentMediaTasks } from "@/components/creative-agent/use-restore-media-tasks";

afterEach(() => vi.unstubAllGlobals());
it("recovers asynchronously against current layout, respects undo, and skips read-only canvases", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mediaId = "ffffffff-ffff-4fff-8fff-ffffffffffff", url = "/uploads/result.png";
  const original: CanvasDocumentV2 = { ...createEmptyCanvasDocumentV2(), nodes: [{ id: "result", type: "image", position: { x: 1, y: 2 }, data: { kind: "image", origin: "generated", mediaId, url } }] };
  const current = { current: original }, preview = { current: null };
  const commit = vi.fn((next: CanvasDocumentV2) => { current.current = next; });
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  function Harness({ readOnly = false }: { readOnly?: boolean }) {
    useRestoreAgentMediaTasks(8, current.current, readOnly, current, commit, preview);
    return null;
  }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Harness, { readOnly: true })));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(React.createElement(Harness)));
    current.current = { ...original, nodes: [{ ...original.nodes[0], position: { x: 91, y: 92 } }] };
    await act(async () => {
      resolve(new Response(JSON.stringify({ generationCanvasId: 8, generationTask: buildCreativeAgentMediaTask({ id: 12, type: "image_edit", model: "nano-banana-pro", templateData: null }, { mediaId, url }) })));
    });
    expect(current.current.nodes[0]).toMatchObject({ type: "imageTask", position: { x: 91, y: 92 } });
    await act(async () => root.render(React.createElement(Harness)));
    current.current = original; // User undo must not immediately trigger recovery again.
    await act(async () => root.render(React.createElement(Harness)));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});
