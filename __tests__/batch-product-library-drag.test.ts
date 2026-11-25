import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("batch product-library drag contract", () => {
  it("emits a stable item ID and never converts a dropped URL into a File", () => {
    const panel = read("components/media-library/media-library-panel.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(panel).toContain(
      'setData("application/x-media-library-item-id", String(item.id))',
    );
    expect(gallery).toContain("onImportProductLibraryItem");
    expect(gallery).toContain(
      'getData("application/x-media-library-item-id")',
    );
    expect(gallery).not.toContain("convertDroppedImageUrlToFile");
    expect(gallery).not.toContain("fetch(source)");
  });
});
