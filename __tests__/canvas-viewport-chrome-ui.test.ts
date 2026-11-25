import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const board = read("components/canvas/SmartCanvasBoard.tsx");
const chrome = read("components/canvas/CanvasViewportChrome.tsx");
const editor = read("components/canvas/CanvasEditorPage.tsx");
const styles = read("app/globals.css");

describe("canvas viewport chrome", () => {
  it("uses the approved zoom and pointer interaction policy", () => {
    expect(board).toContain("minZoom={CANVAS_MIN_ZOOM}");
    expect(board).toContain("maxZoom={CANVAS_MAX_ZOOM}");
    expect(board).toContain("snapToGrid={false}");
    expect(board).toContain("resolveCanvasAlignment");
    expect(board).toContain("panOnDrag={handToolActive ? CANVAS_HAND_PAN_BUTTONS : CANVAS_SELECT_PAN_BUTTONS}");
    expect(board).toContain("panOnScroll");
    expect(board).toContain("zoomOnScroll={false}");
    expect(board).toContain("zoomOnPinch");
    expect(board).toContain("connectionRadius={80}");
  });

  it("renders a dynamic one-pixel dot grid and screen-fixed zoom control", () => {
    expect(chrome).toContain("getCanvasDotGap(zoom)");
    expect(chrome).toContain('appearance.pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots');
    expect(chrome).toContain('appearance.pattern !== "solid"');
    expect(chrome).toContain("size={1}");
    expect(chrome).toContain('"var(--canvas-bg-dot)"');
    expect(chrome).toContain("Math.round(zoom * 100)");
    expect(chrome).toContain("CANVAS_ZOOM_STEP");
    expect(chrome).toContain("const ZOOM_DURATION_MS = 200");
    expect(chrome).toContain("const PRESET_DURATION_MS = 300");
    expect(chrome).toContain("duration: zoomDuration(ZOOM_DURATION_MS)");
    expect(chrome).toContain("duration: zoomDuration(PRESET_DURATION_MS)");
    expect(chrome).toContain("parseCanvasZoomPercent");
    expect(chrome).toContain('inputMode="decimal"');
  });

  it("persists animated viewport controls and restores the saved viewport without fitting", () => {
    expect(chrome).toContain("onViewportCommit?: (viewport: CanvasDocumentV2[\"viewport\"]) => void");
    expect(chrome).toContain("operation.then(() => onViewportCommit?.(flow.getViewport()))");
    expect(board).toContain("const commitViewport = React.useCallback");
    expect(board).toContain("<CanvasViewportChrome onViewportCommit={commitViewport}");
    expect(board).toContain("onMoveEnd={handleMoveEnd}");
    const moveEnd = board.slice(board.indexOf("const handleMoveEnd"), board.indexOf("const contextNode"));
    expect(moveEnd).toContain("setViewportInteracting(false)");
    expect(moveEnd).toContain("commitViewport(viewport)");
    expect(board).not.toContain("fitInitialViewRef");
    expect(board).not.toContain("fitView={fitInitialViewRef.current}");
    expect(board).toContain("const migrateLegacyViewportRef = React.useRef(");
    expect(board).toContain("migrateLegacyViewportRef.current = false");
    expect(board).toContain("commitViewport(instance.getViewport())");
    expect(editor).toContain("readCanvasViewportPreference(window.localStorage");
    expect(editor).toContain("writeCanvasViewportPreference(window.localStorage");
  });

  it("shows quick starts only on an empty new canvas", () => {
    expect(board).toContain("document.nodes.length === 0");
    expect(board).toContain("双击画布");
    expect(board).toContain("自由生成节点");
    expect(board).toContain("故事脚本生成");
    expect(board).toContain("角色三视图");
    expect(board).toContain("全能参考生视频");
    expect(board).toContain("音频生视频");
  });

  it("dismisses the zoom menu outside and lets Escape close it before returning focus", () => {
    expect(chrome).toContain("const viewportControlsRef = React.useRef<HTMLDivElement>(null)");
    expect(chrome).toContain("const zoomMenuTriggerRef = React.useRef<HTMLButtonElement>(null)");
    expect(chrome).toMatch(/<button\s+ref=\{zoomMenuTriggerRef\}(?:(?!<\/button>)[\s\S])*?aria-label="打开缩放菜单"/);
    expect(chrome).toContain('document.addEventListener("pointerdown", handleOutsidePointerDown, true)');
    expect(chrome).toContain('document.addEventListener("keydown", handleMenuKeyDown, true)');
    expect(chrome).toContain("viewportControlsRef.current?.contains(event.target as globalThis.Node)");
    expect(chrome).toContain('event.key !== "Escape"');
    expect(chrome).toContain("zoomMenuTriggerRef.current?.focus()");
  });

  it("keeps the 150 by 110 minimap hidden until explicitly toggled", () => {
    expect(chrome).toContain("const [minimapVisible, setMinimapVisible] = React.useState(false)");
    expect(chrome).toContain("{minimapVisible ? (");
    expect(chrome).toContain("<MiniMap");
    expect(chrome).toContain("width: 150, height: 110");
    expect(chrome).toContain('aria-label={minimapVisible ? "隐藏小地图" : "显示小地图"}');
  });

  it("uses neutral native selection rectangles and global Canvas tokens", () => {
    expect(styles).toContain("--canvas-bg: #141414");
    expect(styles).toContain("--canvas-bg-dot: #474747");
    expect(styles).toContain("--canvas-controls-bg: #262626");
    expect(styles).toContain("--canvas-selection-bg: #ffffff0f");
    expect(styles).toContain(".canvas-smart-flow .react-flow__selection");
    expect(styles).toContain("border: 1px dotted var(--canvas-selection-border)");
    expect(styles).not.toContain(".canvas-marquee-selection-bounds");
  });
});
