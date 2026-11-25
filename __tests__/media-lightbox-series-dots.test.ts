import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const seriesLightboxes = [
  {
    name: "uploaded media",
    file: "components/ui/multi-upload-dropzone.tsx",
    count: "count: previewableItems.length",
    activeIndex: "activeIndex: activePreviewIndex",
  },
  {
    name: "video task references",
    file: "components/history/unified-history-panel.tsx",
    count: "count: referencePreview.items.length",
    activeIndex: "activeIndex: referencePreview.index",
  },
  {
    name: "batch media gallery",
    file: "components/batch-workbench/batch-media-gallery.tsx",
    count: "count: relations.length",
    activeIndex: "activeIndex: activePreviewIndex",
  },
  {
    name: "work detail media",
    file: "components/works/work-detail-modal.tsx",
    count: "count: zoomPreview.entries.length",
    activeIndex: "activeIndex: zoomPreview.index",
  },
  {
    name: "batch result media",
    file: "components/batch-workbench/batch-workbench-page.tsx",
    count: "count: groupResultPreview.entries.length",
    activeIndex: "activeIndex: groupResultPreview.index",
  },
  {
    name: "material library series",
    file: "app/admin/material-assets/page.tsx",
    count: "count: previewMediaItems.length",
    activeIndex: "activeIndex: safePreviewMediaIndex",
  },
  {
    name: "administrator user material series",
    file: "components/admin/UserMaterialAssetsPanel.tsx",
    count: "count: lightboxMediaItems.length",
    activeIndex: "activeIndex: lightboxMediaIndex",
  },
] as const;

describe("multi-media lightbox dots", () => {
  it.each(seriesLightboxes)("shows shared series dots for $name", ({ file, count, activeIndex }) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");

    expect(source).toContain("<MediaLightbox");
    expect(source).toContain("dots={");
    expect(source).toContain(count);
    expect(source).toContain(activeIndex);
  });
});
