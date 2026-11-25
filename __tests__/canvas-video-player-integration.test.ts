import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const playerStart = source.indexOf("function CanvasVideoPlayer(");
const playerEnd = source.indexOf("\nfunction useElapsedSeconds", playerStart);
const playerSource = source.slice(playerStart, playerEnd);

describe("canvas video player integration", () => {
  it("uses one interactive player for uploaded and generated video nodes", () => {
    expect(source).toContain("function CanvasVideoPlayer(");
    expect(source).not.toContain("createCanvasVideoPlaybackController");
    expect(playerSource).toContain("const [hovered, setHovered]");
    expect(playerSource).toContain("data-canvas-video-poster");
    expect(playerSource).toContain("prepared ? <video");
    expect(playerSource).not.toContain("hovered ? 300 : 0");
    expect(playerSource).not.toContain("startHoverPlayback");
    expect(playerSource).toContain("1500");
    expect(playerSource).toContain("runtime.videos.add");
    expect(source.match(/<CanvasVideoPlayer/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("onMouseEnter");
    expect(source).toContain("onMouseLeave");
    expect(source).toContain("onClick");
    expect(source).toContain("onEnded");
  });

  it("uses hover-only custom progress and volume controls without native extras", () => {
    expect(playerSource).toContain("data-canvas-video-controls");
    expect(playerSource).toContain('aria-label="视频进度"');
    expect(playerSource).toContain('aria-label="音量"');
    expect(playerSource).toContain("group-hover/video:opacity-100");
    expect(playerSource).not.toContain("\n      controls");
  });

  it("suppresses hover playback for both single-node and multi-node connection drags", () => {
    expect(playerSource).toContain("const connectionInProgress = useCanvasConnectionInProgress()");
    expect(playerSource).toContain("if (!connectionInProgress && !interacting) return;");
    expect(playerSource).toContain("video.pause()");
    expect(playerSource).toContain("video.currentTime = 0");
  });

  it("keeps the video body draggable while isolating playback controls", () => {
    expect(playerSource).toContain("group/video relative overflow-hidden");
    expect(playerSource).not.toContain("group/video nodrag nowheel");
    expect(playerSource).toContain("data-canvas-video-controls");
    expect(playerSource).toContain('className="nodrag pointer-events-none');
    expect(playerSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(playerSource).toContain("onClick={togglePlayback}");
  });

  it("connects toolbar and player to the same node frame actions", () => {
    expect(playerSource).toContain('<CanvasVideoFrameControl placement="player"');
    expect(source.match(/<CanvasVideoFrameControl placement="toolbar"/g)).toHaveLength(2);
    expect(source).toContain("<CanvasVideoFrameProvider key={src}");
    expect(playerSource).toContain('crossOrigin="anonymous"');
  });
});
