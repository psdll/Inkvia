import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("shared video player adoption", () => {
  it.each([
    "components/history/unified-history-panel.tsx",
    "components/video/VideoHistoryPanel.tsx",
    "components/batch-workbench/live-video-task-card.tsx",
    "components/templates/inspiration-detail-fullscreen.tsx",
    "components/canvas/CanvasMediaPreview.tsx",
    "app/material-inspirations/page.tsx",
    "components/ui/media-compare-lightbox.tsx",
    "components/ui/multi-upload-dropzone.tsx",
  ])("uses AppVideoPlayer for interactive video in %s", (file) => {
    const source = read(file);
    expect(source).toContain("AppVideoPlayer");
    expect(source).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
  });

});
