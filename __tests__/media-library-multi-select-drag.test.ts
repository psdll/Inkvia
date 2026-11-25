import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMediaLibraryDragSelection,
  readMediaLibraryDragItems,
  resolveMediaLibraryModifierSelection,
  writeMediaLibraryDragItems,
} from "@/lib/media-library-drag";

const root = process.cwd();
const read = (file: string) => {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
};

describe("product library multi-select drag", () => {
  it("toggles independent items with Ctrl and selects an inclusive Shift range", () => {
    const first = resolveMediaLibraryModifierSelection({
      orderedIds: [1, 2, 3, 4, 5],
      selectedIds: [],
      clickedId: 2,
      anchorId: null,
      ctrlOrMeta: true,
      shift: false,
    });
    const second = resolveMediaLibraryModifierSelection({
      orderedIds: [1, 2, 3, 4, 5],
      selectedIds: first.selectedIds,
      clickedId: 5,
      anchorId: first.anchorId,
      ctrlOrMeta: false,
      shift: true,
    });

    expect(first).toEqual({ selectedIds: [2], anchorId: 2 });
    expect(second).toEqual({ selectedIds: [2, 3, 4, 5], anchorId: 2 });
  });

  it("drags the whole selected set in library order and preserves the legacy item contract", () => {
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData(type: string, value: string) {
        values.set(type, value);
      },
      getData(type: string) {
        return values.get(type) || "";
      },
    } as Pick<DataTransfer, "effectAllowed" | "setData" | "getData">;
    const items = [
      { id: 1, url: "/one.png", kind: "image" },
      { id: 2, url: "/two.png", kind: "image" },
      { id: 3, url: "/three.png", kind: "image" },
    ];
    const dragged = getMediaLibraryDragSelection(items, 3, [3, 1]);

    writeMediaLibraryDragItems(dataTransfer, dragged);

    expect(dragged.map((item) => item.id)).toEqual([1, 3]);
    expect(readMediaLibraryDragItems(dataTransfer)).toEqual(dragged);
    expect(values.get("application/x-media-library-item-id")).toBe("1");
  });

  it("shares one modifier-selection and grouped drag contract", () => {
    const contract = read("lib/media-library-drag.ts");

    expect(contract).toContain("MEDIA_LIBRARY_DRAG_ITEMS_TYPE");
    expect(contract).toContain("resolveMediaLibraryModifierSelection");
    expect(contract).toContain("getMediaLibraryDragSelection");
    expect(contract).toContain("writeMediaLibraryDragItems");
    expect(contract).toContain("readMediaLibraryDragItems");
    expect(contract).toContain("orderedIds.slice(from, to + 1)");
  });

  it("enables Ctrl toggle, Shift range and grouped dragging in the shared panel", () => {
    const panel = read("components/media-library/media-library-panel.tsx");

    expect(panel).toContain("resolveMediaLibraryModifierSelection");
    expect(panel).toContain("getMediaLibraryDragSelection");
    expect(panel).toContain("writeMediaLibraryDragItems");
    expect(panel).toContain("event.ctrlKey || event.metaKey || event.shiftKey");
    expect(panel).toContain("selectedIds.includes(item.id)");
    expect(panel).toContain("draggable={Boolean(mediaUrl)}");
    expect(panel).not.toContain("draggable={Boolean(mediaUrl) && !selectionMode}");
  });

  it("clears the drag selection whenever the product library closes", () => {
    const panel = read("components/media-library/media-library-panel.tsx");

    expect(panel).toContain('if (open) return;\n    setSelectedIds([]);\n    selectedIdsRef.current = [];\n    lastSelectedIdRef.current = null;');
  });

  it("appends every grouped product-library item in multi-upload regions", () => {
    const dropzone = read("components/ui/multi-upload-dropzone.tsx");

    expect(dropzone).toContain("MEDIA_LIBRARY_DRAG_ITEMS_TYPE");
    expect(dropzone).toContain("readMediaLibraryDragItems");
    expect(dropzone).toContain("appendFromUrls");
    expect(dropzone).toContain("libraryItems.map((item) => item.url)");
  });

  it("keeps single-upload regions capacity-safe while understanding the grouped contract", () => {
    const dropzone = read("components/ui/upload-dropzone.tsx");

    expect(dropzone).toContain("MEDIA_LIBRARY_DRAG_ITEMS_TYPE");
    expect(dropzone).toContain("readMediaLibraryDragItems");
    expect(dropzone).toContain("libraryItems[0]?.url");
  });

  it("imports grouped product-library items sequentially in batch upload regions", () => {
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(gallery).toContain("MEDIA_LIBRARY_DRAG_ITEMS_TYPE");
    expect(gallery).toContain("readMediaLibraryDragItems");
    expect(gallery).toContain("droppedItems.reduce<Promise<void>>");
    expect(gallery).toContain("droppedItems.length > remaining");
  });
});
