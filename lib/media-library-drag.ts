export const MEDIA_LIBRARY_DRAG_ITEMS_TYPE = "application/x-media-library-items";

export type MediaLibraryDragItem = {
  id: number;
  url: string;
  kind: string;
};

export function resolveMediaLibraryModifierSelection({
  orderedIds,
  selectedIds,
  clickedId,
  anchorId,
  ctrlOrMeta,
  shift,
}: {
  orderedIds: number[];
  selectedIds: number[];
  clickedId: number;
  anchorId: number | null;
  ctrlOrMeta: boolean;
  shift: boolean;
}) {
  if (shift) {
    const resolvedAnchor = anchorId && orderedIds.includes(anchorId) ? anchorId : clickedId;
    const start = orderedIds.indexOf(resolvedAnchor);
    const end = orderedIds.indexOf(clickedId);
    if (start < 0 || end < 0) {
      return {
        selectedIds: selectedIds.includes(clickedId) ? selectedIds : [...selectedIds, clickedId],
        anchorId: resolvedAnchor,
      };
    }
    const [from, to] = start < end ? [start, end] : [end, start];
    const range = orderedIds.slice(from, to + 1);
    return {
      selectedIds: Array.from(new Set([...selectedIds, ...range])),
      anchorId: resolvedAnchor,
    };
  }

  if (ctrlOrMeta) {
    return {
      selectedIds: selectedIds.includes(clickedId)
        ? selectedIds.filter((id) => id !== clickedId)
        : [...selectedIds, clickedId],
      anchorId: clickedId,
    };
  }

  return { selectedIds, anchorId };
}

export function getMediaLibraryDragSelection(
  items: MediaLibraryDragItem[],
  currentId: number,
  selectedIds: number[],
) {
  const draggedIds = selectedIds.includes(currentId)
    ? new Set(selectedIds)
    : new Set([currentId]);
  return items.filter((item) => draggedIds.has(item.id) && Boolean(item.url));
}

export function writeMediaLibraryDragItems(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  items: MediaLibraryDragItem[],
) {
  if (!items.length) return;
  const first = items[0];
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(MEDIA_LIBRARY_DRAG_ITEMS_TYPE, JSON.stringify(items));
  dataTransfer.setData("application/x-media-library-item-id", String(first.id));
  dataTransfer.setData("application/x-media-library-url", first.url);
  dataTransfer.setData("application/x-media-library-kind", first.kind);
  dataTransfer.setData("text/uri-list", items.map((item) => item.url).join("\r\n"));
  dataTransfer.setData("text/plain", items.map((item) => item.url).join("\n"));
}

export function readMediaLibraryDragItems(
  dataTransfer: Pick<DataTransfer, "getData">,
): MediaLibraryDragItem[] {
  const encoded = dataTransfer.getData(MEDIA_LIBRARY_DRAG_ITEMS_TYPE);
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded);
      if (Array.isArray(parsed)) {
        const normalized = parsed.flatMap((item): MediaLibraryDragItem[] => {
          const id = Number(item?.id);
          const url = String(item?.url || "").trim();
          const kind = String(item?.kind || "").trim();
          return Number.isSafeInteger(id) && id > 0 && url ? [{ id, url, kind }] : [];
        });
        if (normalized.length) return normalized;
      }
    } catch {}
  }

  const id = Number(dataTransfer.getData("application/x-media-library-item-id"));
  const url = String(dataTransfer.getData("application/x-media-library-url") || "").trim();
  const kind = String(dataTransfer.getData("application/x-media-library-kind") || "").trim();
  return Number.isSafeInteger(id) && id > 0 && url ? [{ id, url, kind }] : [];
}
