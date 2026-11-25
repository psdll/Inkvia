import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"),
  "utf8",
);
const assetsSource = readFileSync(
  resolve(process.cwd(), "app/works/page.tsx"),
  "utf8",
);
describe("admin works video preview", () => {
  it("keeps the video poster static even when the card is hovered", () => {
    const mediaStart = panelSource.indexOf(
      "mediaSrc || imageCandidates.length ? (",
    );
    const mediaEnd = panelSource.indexOf(
      "{isVideo ? (",
      mediaStart,
    );
    const mediaPreview = panelSource.slice(mediaStart, mediaEnd);

    expect(mediaStart).toBeGreaterThanOrEqual(0);
    expect(mediaEnd).toBeGreaterThan(mediaStart);
    expect(mediaPreview).toContain("<ResilientImage");
    expect(mediaPreview).toContain("candidates={imageCandidates}");
    expect(mediaPreview).toContain('loading="eager"');
    expect(mediaPreview).not.toContain("<HoverPreviewVideo");
    expect(mediaPreview).not.toContain("<video");
  });

  it("matches the user assets hover dimmer and emphasized play ring", () => {
    const hoverClasses = [
      "bg-[var(--overlay)] opacity-0 group-hover/media:opacity-100 transition-opacity",
      "h-16 w-16 rounded-full bg-[var(--panel-bg)]/90 border border-[var(--border)]",
      "border-l-[16px] border-l-[var(--app-fg)] border-y-[10px] border-y-transparent",
    ];

    for (const classNames of hoverClasses) {
      expect(assetsSource).toContain(classNames);
      expect(panelSource).toContain(classNames);
    }
  });
});
