import { verifyImageFallback } from './helpers/canvas-ui-contract-harness';
import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("batch workbench image preview", () => {
  const root = process.cwd();
  const lightboxSource = readChineseUiSource(
    path.join(root, "components/ui/media-lightbox.tsx"),
    "utf8",
  );
  const gallerySource = readChineseUiSource(
    path.join(root, "components/batch-workbench/batch-media-gallery.tsx"),
    "utf8",
  );
  const taskCardSource = readChineseUiSource(
    path.join(root, "components/batch-workbench/batch-task-card.tsx"),
    "utf8",
  );
  const taskResultSource = readChineseUiSource(
    path.join(root, "components/batch-workbench/batch-task-result.tsx"),
    "utf8",
  );
  const workbenchSource = readChineseUiSource(
    path.join(root, "components/batch-workbench/batch-workbench-page.tsx"),
    "utf8",
  );
  const canvasNodeSource = readChineseUiSource(
    path.join(root, "components/canvas/CanvasNodeCard.tsx"),
    "utf8",
  );

  it("provides a centered non-fullscreen lightbox layout", () => {
    expect(lightboxSource).toContain(
      'layout?: "content" | "material-detail" | "floating"',
    );
    expect(lightboxSource).toContain('layout === "floating"');
    expect(lightboxSource).toContain("bg-black/35");
    expect(lightboxSource).toContain("max-w-[880px]");
    expect(lightboxSource).toContain("h-[min(76dvh,720px)]");
    expect(lightboxSource).toContain('"flex overflow-hidden"');
  });

  it("opens product and reference images directly from the shared gallery", () => {
    expect(gallerySource).toContain(
      'import { MediaLightbox } from "@/components/ui/media-lightbox"',
    );
    expect(gallerySource).toContain("const [previewIndex, setPreviewIndex]");
    expect(gallerySource).toContain("onClick={() => setPreviewIndex(index)}");
    expect(gallerySource).toContain("aria-label={`查看${displayLabel} ${index + 1}`}");
    expect(gallerySource).toContain('layout="floating"');
    expect(gallerySource).toContain(
      "`${activePreviewIndex + 1}/${relations.length}`",
    );
  });

  it("opens generated images as one navigable preview for the clicked group", () => {
    expect(taskCardSource).not.toContain(
      'import { MediaLightbox } from "@/components/ui/media-lightbox"',
    );
    expect(taskCardSource).toContain(
      "onPreviewResult?: (outputId: string) => void",
    );
    expect(taskCardSource).toContain(
      "onPreview={() => onPreviewResult?.(outputs[0]!.id)}",
    );
    expect(taskResultSource).toContain("onClick={onPreview}");
    expect(taskResultSource).toContain('aria-label="查看生成结果"');
    expect(taskResultSource).toContain("cursor-zoom-in");
    expect(workbenchSource).toContain(
      'import { MediaLightbox } from "@/components/ui/media-lightbox"',
    );
    expect(workbenchSource).toContain("buildBatchGroupResultPreview");
    expect(workbenchSource).toContain(
      "openGroupResultPreview(group.name, group.items, outputId)",
    );
    expect(workbenchSource).toContain('layout="floating"');
    expect(workbenchSource).toContain("groupResultPreview.index + 1");
    expect(workbenchSource).toContain("onPrev");
    expect(workbenchSource).toContain("onNext");
  });

  it("uses resilient image candidates in full-size viewers and canvas nodes", async () => {

    await verifyImageFallback();
  });
});
