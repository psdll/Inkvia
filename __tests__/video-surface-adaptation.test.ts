import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("video surface adaptation", () => {
  it("reuses the shared Xiaohongshu-style video badge on home cards", () => {
    const source = readFileSync(
      "components/home/inspiration-discovery-section.tsx",
      "utf8",
    );

    expect(source).toContain('import { VideoBadge } from "@/components/ui/hover-preview-video";');
    expect(source).toContain("<VideoBadge />");
    expect(source).not.toContain("VideoIcon");
    expect(source).not.toContain("absolute left-2 top-2");
  });

  it("portals the inspiration detail over the complete app viewport", () => {
    const source = readFileSync(
      "components/templates/inspiration-detail-fullscreen.tsx",
      "utf8",
    );

    expect(source).toContain('import { createPortal } from "react-dom";');
    expect(source).toContain("return createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain('className="fixed inset-0 z-[120]');
    expect(source).toContain('className="relative flex min-w-0 flex-1');
  });

  it("uses a compact inline player that opens the lightbox when its surface is clicked", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(source).toContain("<AppVideoPlayer");
    expect(source).toContain("compact");
    expect(source).toContain("showCenterControl={false}");
    expect(source).toContain("playOnSurfaceClick={false}");
    expect(source).toContain("<MediaLightbox");
    expect(source).toContain("onClick={() => setVideoPreviewOpen(true)}");
    expect(source).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
  });
});
