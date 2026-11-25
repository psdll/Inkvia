import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_VIDEO_PLAYBACK_RATES,
  clampAppVideoTime,
  formatAppVideoTime,
  getNextAppVideoPlaybackRate,
} from "@/components/ui/app-video-player";

const source = readFileSync(
  path.join(process.cwd(), "components/ui/app-video-player.tsx"),
  "utf8",
);

describe("AppVideoPlayer", () => {
  it("formats and clamps video time consistently", () => {
    expect(formatAppVideoTime(0)).toBe("0:00");
    expect(formatAppVideoTime(65.9)).toBe("1:05");
    expect(formatAppVideoTime(Number.NaN)).toBe("0:00");

    expect(clampAppVideoTime(-2, 10)).toBe(0);
    expect(clampAppVideoTime(12, 10)).toBe(10);
    expect(clampAppVideoTime(4, Number.NaN)).toBe(0);
  });

  it("cycles through the fixed Xiaohongshu-style playback rates", () => {
    expect(APP_VIDEO_PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.5, 2]);
    expect(getNextAppVideoPlaybackRate(1)).toBe(1.5);
    expect(getNextAppVideoPlaybackRate(2)).toBe(0.5);
  });

  it("owns accessible custom controls without enabling native controls", () => {
    expect(source).toContain("data-app-video-player");
    expect(source).toContain("data-app-video-controls");
    expect(source).toContain('aria-label="视频进度"');
    expect(source).toContain("requestPictureInPicture");
    expect(source).toContain("requestFullscreen");
    expect(source).toContain("document.pictureInPictureEnabled");
    expect(source).toContain("document.fullscreenEnabled");
    expect(source).toContain("2_500");
    expect(source).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
  });

  it("uses the Xiaohongshu control composition and slide-down inactive state", () => {
    expect(source).toContain("data-app-video-progress");
    expect(source).toContain("data-app-video-rate-menu");
    expect(source).toContain("data-app-video-volume-popover");
    expect(source).toContain("h-[100px]");
    expect(source).toContain("translate-y-full");
    expect(source).toContain("duration-300");
    expect(source).not.toContain("sm:block");
  });

  it("does not cover ended videos with a large replay badge", () => {
    expect(source).toContain("data-app-video-start");
    expect(source).toContain("onEnded");
    expect(source).not.toContain("data-app-video-replay");
  });

  it("does not invent a quality selector when only one media source exists", () => {
    expect(source).not.toContain("data-app-video-quality");
    expect(source).not.toContain("清晰度");
  });

  it("keeps the real playback-rate menu open when its trigger is clicked", () => {
    expect(source).toContain('onClick={() => setRateMenuOpen(true)}');
    expect(source).not.toContain('onClick={() => setRateMenuOpen((open) => !open)}');
  });

  it("can suppress the center control while keeping compact fullscreen controls", () => {
    expect(source).toContain("showCenterControl?: boolean;");
    expect(source).toContain("showCenterControl = true");
    expect(source).toContain("showCenterControl && paused && !ended");
    expect(source).toContain("canPictureInPicture && !compact");
    expect(source).toContain("canFullscreen ? (");
  });

  it("supports a truly small card mode without forcing surface clicks to play", () => {
    expect(source).toContain("playOnSurfaceClick?: boolean;");
    expect(source).toContain("playOnSurfaceClick = true");
    expect(source).toContain("if (playOnSurfaceClick) togglePlayback();");
    expect(source).toContain('? "h-12 px-1.5 pb-1.5"');
    expect(source).toContain('? "flex h-7 w-7');
    expect(source).toContain("compact ? \"h-4 w-4\"");
  });

  it("can keep each card's controls hidden until that player is hovered", () => {
    expect(source).toContain("controlsOnHover?: boolean;");
    expect(source).toContain("controlsOnHover = false");
    expect(source).toContain("React.useState(!controlsOnHover)");
    expect(source).toContain("if (controlsOnHover) {");
    expect(source).toContain("onMouseEnter={revealControls}");
  });

  it("keeps the rate and volume popovers physically connected to their triggers", () => {
    expect(source).toContain('compact ? "bottom-7" : "bottom-9"');
    expect(source).not.toContain('compact ? "bottom-9" : "bottom-[53px]"');
    expect(source).not.toContain('compact ? "bottom-9" : "bottom-11"');
  });

  it("scales rate and volume popovers down with compact card controls", () => {
    expect(source).toContain('compact ? "w-10 rounded-md py-1"');
    expect(source).toContain('compact ? "h-6 text-[10px]"');
    expect(source).toContain('compact ? "h-16 w-5 rounded-md" : "h-20 w-6 rounded-lg"');
    expect(source).toContain('compact ? "h-12 w-1" : "h-16 w-1"');
    expect(source).toContain("[&::-webkit-slider-thumb]:h-2.5");
    expect(source).toContain("[&::-moz-range-thumb]:h-2.5");
  });
});
