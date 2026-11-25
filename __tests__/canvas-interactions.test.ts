import { verifyContextCreation } from './helpers/canvas-board-contract-harness';

import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const shortcuts = readFileSync("components/canvas/CanvasShortcutPanel.tsx", "utf8");

describe("canvas interactions", () => {
  it("uses a fixed bottom icon dock mapped to real project actions", () => {
    const dockStart = board.lastIndexOf('data-canvas-bottom-dock');
    const dock = board.slice(dockStart, board.indexOf("</Panel>", dockStart));

    expect(board).toContain('position="bottom-center"');
    expect(dock).toContain("h-[52px]");
    for (const label of ["添加节点", "工作流", "生成历史", "快捷键", "产物库"]) {
      expect(dock).toContain(`aria-label="${label}"`);
    }
    expect(dock).toContain('data-canvas-tool-trigger');
    expect(dock).not.toContain('aria-label="运行日志"');
    expect(board).not.toContain("还没有运行记录");
    expect(board).not.toContain('position="top-right"');
  });

  it("shows the reference panel categories with only supported project actions", () => {
    for (const token of ["创作", "缩放", "移动画布", "其他", "复制节点和连线", "创建副本", "抓手工具", "整理画布", "Delete / Backspace"]) {
      expect(shortcuts).toContain(token);
    }
    expect(shortcuts).not.toContain('{ keys: ["滚轮"], description: "缩放画布" }');
    expect(shortcuts).not.toContain("合并分镜组");
    expect(shortcuts).toContain("重做");
    expect(shortcuts).toContain('["Ctrl", "Shift", "Z"]');
  });

  it("scopes canvas shortcuts, supports select-all and escape, and keeps task multi-selection", () => {
    const keydownStart = board.lastIndexOf("const onKeyDown = (event: KeyboardEvent) =>");
    const keydown = board.slice(keydownStart, board.indexOf('window.addEventListener("keydown"', keydownStart));
    const nodeClick = board.slice(board.indexOf("const handleFlowNodeClick"), board.indexOf("const handleFlowNodeDoubleClick"));

    expect(board).toContain("tabIndex={-1}");
    expect(keydown).toContain("event.defaultPrevented");
    expect(keydown).toContain("wrapRef.current?.contains(target)");
    expect(keydown).toContain('event.key.toLowerCase() === "a"');
    expect(keydown).toContain("documentRef.current.nodes.map((node) => node.id)");
    expect(keydown).toContain('event.key === "Escape"');
    expect(nodeClick).toContain("event.shiftKey || event.ctrlKey || event.metaKey");
  });

  it("creates nodes at the double-click or context-menu flow position", async () => {

    for (const kind of ["imageTask", "videoTask", "audioTask", "llm"]) await verifyContextCreation(kind);
  });

  it("routes the remaining product-library entries through the same mutually exclusive toggle", () => {
    const keydownStart = board.lastIndexOf("const onKeyDown = (event: KeyboardEvent) =>");
    const keydown = board.slice(keydownStart, board.indexOf('window.addEventListener("keydown"', keydownStart));

    expect(keydown).toContain("toggleLibraryPanel();");
    expect(board).not.toContain("openAssetLibrary: toggleLibraryPanel");
  });
});
