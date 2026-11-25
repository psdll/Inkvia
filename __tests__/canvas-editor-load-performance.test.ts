import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("canvas editor initial loading", () => {
  it("starts downloading the board while bootstrap data is still loading", () => {
    const editor = read("components/canvas/CanvasEditorPage.tsx");

    expect(editor).toContain("const loadSmartCanvasBoard = () => import(");
    expect(editor).toContain("dynamic(loadSmartCanvasBoard");
    expect(editor).toContain("void loadSmartCanvasBoard();");
  });

  it("keeps interaction-only tools out of the initial board chunk", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const nodeCard = read("components/canvas/CanvasNodeCard.tsx");

    expect(board).not.toContain('import CanvasMediaPreview from "@/components/canvas/CanvasMediaPreview"');
    expect(board).not.toContain('import CanvasShortcutPanel from "@/components/canvas/CanvasShortcutPanel"');
    expect(board).not.toContain('import ImageEditorModal from "@/components/canvas/ImageEditorModal"');
    expect(board).not.toContain('import { PresetPromptsTrigger } from "@/components/presets/preset-prompts"');
    expect(board).toContain('dynamic(() => import("@/components/canvas/CanvasMediaPreview")');
    expect(board).toContain('dynamic(() => import("@/components/canvas/ImageEditorModal")');
    expect(board).toContain('dynamic(() => import("@/components/presets/preset-prompts")');

    expect(nodeCard).not.toContain('import { PromptRichEditor } from "@/components/ui/prompt-rich-editor"');
    const loader = nodeCard.match(/const (\w+) = \(\) => import\("@\/components\/ui\/prompt-rich-editor"\)/)?.[1];
    expect(loader).toBeTruthy();
    expect(nodeCard).toContain('dynamic(' + loader);
  });

  it("defers optional panels and only warms speech for projects containing audio tasks", () => {
    const editor = read("components/canvas/CanvasEditorPage.tsx");
    const workspace = read("components/canvas/CanvasWorkspace.tsx");
    expect(editor).toContain("<CanvasWorkspace");
    expect(workspace).toContain('dynamic(() => import("./CanvasLibraryPanel")');
    expect(workspace).toContain('dynamic(() => import("./CanvasWorkflowPanel")');
    expect(editor).not.toContain('import CanvasLibraryPanel,');
    expect(editor).toContain('document?.nodes.some(node => node.data.kind === "audioTask")');
    expect(editor).toContain('useCanvasLibraryPreviewWarmup(warmupsReady ?');
    expect(read("components/canvas/SmartCanvasBoard.tsx")).toContain('performance.mark(`canvas:${canvasId}:board-ready`)');
  });

  it("coalesces Strict Mode bootstrap and run-list requests", () => {
    const bootstrap = read("lib/canvas/bootstrap-client.ts");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(bootstrap).toContain("const inFlightCanvasBootstraps = new Map");
    expect(board).toContain('import { fetchJsonOnce } from "@/lib/client/inflight-json"');
    expect(board).toContain("fetchJsonOnce<RunListPayload>(`/api/canvas/${canvasId}/runs`)");
  });
});
