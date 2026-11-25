import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("image and video tool upload gallery", () => {
  it("uses the batch-workbench zoom cursor and navigable floating preview", () => {
    const dropzone = readFileSync("components/ui/multi-upload-dropzone.tsx", "utf8");

    expect(dropzone).toContain("data-upload-gallery");
    expect(dropzone).toContain('kind !== "audio" ? "cursor-zoom-in" : ""');
    expect(dropzone).toContain('onClick={!replaceOnItemDrop && kind !== "audio" ? () => {');
    expect(dropzone).not.toContain("data-upload-zoom-trigger");
    expect(dropzone).not.toContain("<ZoomIn");
    expect(dropzone).toContain("suppressPreviewClickRef");
    expect(dropzone).toContain("if (suppressPreviewClickRef.current) return;");
    expect(dropzone).toContain("auto-rows-[96px] overflow-y-auto");
    expect(dropzone).not.toContain("hiddenCount");
    expect(dropzone).toContain("previewableItems");
    expect(dropzone).toContain('kind !== "audio"');
    expect(dropzone).toContain('layout="floating"');
    expect(dropzone).toContain("counterAlwaysVisible");
    expect(dropzone).toContain("hasPrev={");
    expect(dropzone).toContain("hasNext={");
    expect(dropzone).toContain("onPrev={");
    expect(dropzone).toContain("onNext={");
    expect(dropzone).not.toMatch(/data-upload-card-actions[\s\S]{0,600}<ZoomIn/);
  });

  it("uses pointer dragging so the gallery can still receive wheel input while reordering", () => {
    const dropzone = readFileSync("components/ui/multi-upload-dropzone.tsx", "utf8");

    expect(dropzone).toContain("data-upload-replace-index={i}");
    expect(dropzone).toContain("if (!replaceOnItemDrop || disabled || event.button !== 0) return;");
    expect(dropzone).toContain("cursor-grab");
    expect(dropzone).toContain("active:cursor-grabbing");
    expect(dropzone).toContain("pointerDragRef");
    expect(dropzone).toContain("setPointerCapture(event.pointerId)");
    expect(dropzone).toContain("document.elementFromPoint(clientX, clientY)");
    expect(dropzone).toContain("onPointerMove={(event) => {");
    expect(dropzone).toContain("onPointerUp={(event) => {");
    expect(dropzone).toContain("onPointerCancel={(event) => {");
    expect(dropzone).not.toContain("draggable={!disabled}");
    expect(dropzone).not.toContain("draggable={!disabled && replaceOnItemDrop}");
    expect(dropzone).not.toContain("onDragStart={(event) => {");
    expect(dropzone).toContain('if (!replaceOnItemDrop || !reorderDragging) return;');
    expect(dropzone).toContain("event.currentTarget.scrollTop += event.deltaY;");
    expect(dropzone).toContain("overscroll-contain");
    expect(dropzone).not.toContain("swapSourceIndex");
    expect(dropzone).not.toContain("setSwapSourceIndex");
    expect(dropzone).not.toContain("handleItemClick");
    expect(dropzone).not.toContain("再点一张交换位置");
    expect(dropzone).not.toContain("onClick={canActivateCard");
  });

  it("offers a separate labelled preview action for reorderable images and videos", () => {
    const dropzone = readFileSync("components/ui/multi-upload-dropzone.tsx", "utf8");
    const previewButton = dropzone.match(
      /<button\s+data-upload-preview-button[\s\S]*?<\/button>/,
    )?.[0];

    expect(previewButton).toBeDefined();
    expect(dropzone).toContain('replaceOnItemDrop && kind !== "audio" ? (');
    expect(previewButton).toContain('aria-label={`放大第 ${i + 1} 个素材`}');
    expect(previewButton).toContain("openZoom(i)");
  });
});
