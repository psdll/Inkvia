import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("canvas media node layout", () => {
  it("mounts the interactive node video on hover and keeps a static poster underneath", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const start = node.indexOf("function CanvasVideoPlayer(");
    const end = node.indexOf("\nfunction useElapsedSeconds", start);
    const player = node.slice(start, end);

    expect(player).toContain("const [hovered, setHovered] = React.useState(false)");
    expect(player).toContain("data-canvas-video-poster");
    expect(player).toContain("setHovered(true)");
    expect(player).toContain("setHovered(false)");
    expect(player).toContain("(!hovered && !needsFrame && !clipEditing)");
    expect(player).toContain("clipEditing || hovered || selected");
    expect(player).toContain("transition-opacity duration-300 ease-out");
    expect(player).toContain("prepared ? <video");
    expect(player).not.toContain("hovered ? 300 : 0");
    expect(player).toContain("video.currentTime = 0;");
  });

  it("uses a full-viewport black preview with image zoom controls", () => {
    const preview = read("components/canvas/CanvasMediaPreview.tsx");

    expect(preview).toContain("data-canvas-media-preview");
    expect(preview).toContain("fixed inset-0 z-[240] flex flex-col bg-black");
    expect(preview).toContain('controlPreset="canvasPreview"');
    expect(preview).toContain("const previewVideoRef = React.useRef<HTMLVideoElement | null>(null)");
    expect(preview).toContain("const startPreviewPlayback = async () =>");
    expect(preview).toContain("video.currentTime = 0;");
    expect(preview).toContain("await video.play()");
    expect(preview).toContain("ref={previewVideoRef}");
    expect(preview).toContain('aria-label="缩小图片"');
    expect(preview).toContain('aria-label="放大图片"');
    expect(preview).not.toContain("下载当前");
    expect(preview).not.toContain("下载全部");
    expect(preview).not.toContain("复制提示词");
    expect(preview).not.toContain("重新运行");
  });

  it("shows the running effect with an accessible status and a real cancel action", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const effect = read("components/canvas/CanvasGenerationEffect.tsx");

    expect(effect).toContain("data-canvas-generation-status");
    expect(effect).toContain('role="status"');
    expect(node).toContain("<CanvasGenerationStatus elapsed={elapsed}");
    expect(node).toMatch(/<CanvasGenerationEffect label=\{[^\n]*canvasGenerationStatusText\(elapsed\)\}/);
    expect(node).toContain("editor?.cancelNode(id)");
    expect(effect).toContain('aria-label="取消生成"');
    expect(effect).toContain("onCancel();");
  });

  it("uses the sampled neutral gray for every image and video task result surface", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const styles = read("app/globals.css");
    const surfaceStyles = styles.slice(
      styles.indexOf(".canvas-task-result-media-surface"),
      styles.indexOf(".canvas-material-frame-selected"),
    );

    expect(node).toMatch(/data-canvas-task-result-media\s+className="canvas-task-result-media-surface/);
    expect(surfaceStyles).toContain("background: var(--canvas-task-result-placeholder-media-bg)");
    expect(styles).toContain("--canvas-task-result-placeholder-media-bg: #262626");
  });
});
