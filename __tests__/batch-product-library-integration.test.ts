import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMediaLibraryCapablePath } from "@/lib/media-library-events";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("batch workbench product library integration", () => {
  it("warms the shared product library on the batch workbench route", () => {
    expect(isMediaLibraryCapablePath("/batch-workbench")).toBe(true);
  });

  it("mounts one shared product library layer for every batch mode", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const shellStart = page.indexOf("export function BatchWorkbenchPage()");
    const imageWorkspace = page.slice(0, shellStart);
    const shell = page.slice(shellStart);

    expect(page).toContain('import { MediaLibraryPanel } from "@/components/media-library/media-library-panel"');
    expect(page.match(/<MediaLibraryPanel\b/g) || []).toHaveLength(1);
    expect(imageWorkspace).not.toContain("<MediaLibraryPanel");
    expect(shell).toContain("MEDIA_LIBRARY_EVENT_TOGGLE");
    expect(shell).toContain("MEDIA_LIBRARY_EVENT_OPEN");
    expect(shell).toContain("MEDIA_LIBRARY_EVENT_CLOSE");
    expect(shell).toContain("open={mediaLibraryOpen}");
    expect(shell).toContain("keepMounted");
    expect(shell).toContain('data-batch-unified-result-shell="true"');
  });

  it("accepts product-library item ID drops in full and compact upload regions", () => {
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(gallery).toContain('"application/x-media-library-item-id"');
    expect(gallery).toContain('"application/x-media-library-kind"');
    expect(gallery).toContain("readProductLibraryDrop");
    expect(gallery).toContain("onImportProductLibraryItem");
    expect(gallery).not.toContain("convertDroppedImageUrlToFile");
    expect(gallery.match(/onDrop=\{handleDrop\}/g) || []).toHaveLength(2);
    expect(gallery.match(/onDragOver=\{handleDragOver\}/g) || []).toHaveLength(2);
  });
});
