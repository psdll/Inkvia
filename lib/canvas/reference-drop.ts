export type CanvasReferenceInsertion = {
  nodeId: string;
  referenceId?: string;
  placement: "before" | "after";
};

export function isCanvasReferenceMediaDrag(dataTransfer: Pick<DataTransfer, "types">) {
  return Array.from(dataTransfer.types).some((type) => [
    "Files", "application/x-canvas-lib", "application/x-media-library-items",
    "application/x-media-library-url", "application/x-history-image-url",
    "application/x-history-media-url", "application/x-local-upload-path", "text/uri-list",
  ].includes(type));
}

export function getCanvasReferenceInsertion(target: EventTarget | null, x: number, y: number): CanvasReferenceInsertion | null {
  if (!(target instanceof Element)) return null;
  const strip = target.closest<HTMLElement>("[data-canvas-reference-task-id]");
  const nodeId = strip?.dataset.canvasReferenceTaskId;
  if (!strip || !nodeId) return null;
  let card = target.closest<HTMLElement>("[data-canvas-reference-id]");
  if (!card) {
    let nearestDistance = Infinity;
    for (const candidate of strip.querySelectorAll<HTMLElement>("[data-canvas-reference-id]")) {
      const rect = candidate.getBoundingClientRect();
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        card = candidate;
      }
    }
  }
  if (!card) return { nodeId, placement: "after" };
  const rect = card.getBoundingClientRect();
  const placement = y < rect.top ? "before" : y > rect.bottom ? "after"
    : x < rect.left + rect.width / 2 ? "before" : "after";
  return { nodeId, referenceId: card.dataset.canvasReferenceId, placement };
}
