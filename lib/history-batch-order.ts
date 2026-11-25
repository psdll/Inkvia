export type HistoryBatchOrderItem = {
  id: string;
  createdAt: string;
  params?: Record<string, unknown> | null;
  externalTaskId?: string | null;
  requestKey?: string | null;
  batchId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  batchSubmittedAt?: string | null;
};

export type SubmissionBatchMetadata = {
  id: string;
  index: number;
  size: number;
  submittedAt: string;
};

export function getSubmissionBatchMetadata(item: HistoryBatchOrderItem): SubmissionBatchMetadata | null {
  const directId = String(item.batchId || "").trim();
  const directIndex = Number(item.batchIndex);
  const directSize = Number(item.batchSize);
  const rawBatch = item.params && typeof item.params.batch === "object" && item.params.batch && !Array.isArray(item.params.batch)
    ? item.params.batch as Record<string, unknown>
    : null;
  const id = directId || String(rawBatch?.id || "").trim();
  const index = Number.isInteger(directIndex) && directIndex > 0 ? directIndex : Number(rawBatch?.index);
  const size = Number.isInteger(directSize) && directSize > 0 ? directSize : Number(rawBatch?.size);
  const submittedAt = String(item.batchSubmittedAt || rawBatch?.submittedAt || item.createdAt || "").trim();
  if (!id || !Number.isInteger(index) || index < 1) return null;
  return { id, index, size: Number.isInteger(size) && size > 0 ? size : 1, submittedAt };
}

export function getSubmissionBatchKey(item: HistoryBatchOrderItem) {
  const batch = getSubmissionBatchMetadata(item);
  return batch ? `${batch.id}:${batch.index}` : null;
}

export function getSubmissionTaskKey(item: HistoryBatchOrderItem) {
  const batchKey = getSubmissionBatchKey(item);
  if (batchKey) return `batch:${batchKey}`;
  const requestKey = String(item.requestKey || "").trim();
  return requestKey ? `request:${requestKey}` : null;
}

export function isSameSubmissionBatchTask(a: HistoryBatchOrderItem, b: HistoryBatchOrderItem) {
  const keyA = getSubmissionTaskKey(a);
  return Boolean(keyA && keyA === getSubmissionTaskKey(b));
}

export function getHistoryDisplayGroupKey(item: HistoryBatchOrderItem) {
  const batch = getSubmissionBatchMetadata(item);
  if (batch && batch.size > 1) return `batch:${batch.id}`;
  const externalTaskId = String(item.externalTaskId || "").trim();
  return externalTaskId ? `task:${externalTaskId}` : `item:${item.id}`;
}

export function compareHistoryDisplayGroupItems(a: HistoryBatchOrderItem, b: HistoryBatchOrderItem) {
  const batchA = getSubmissionBatchMetadata(a);
  const batchB = getSubmissionBatchMetadata(b);
  if (batchA && batchB && batchA.id === batchB.id && batchA.index !== batchB.index) {
    return batchA.index - batchB.index;
  }
  const idA = Number(a.id);
  const idB = Number(b.id);
  if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;
  return String(a.id).localeCompare(String(b.id));
}

export function shouldKeepSubmissionBatchPlaceholder(
  pending: HistoryBatchOrderItem,
  visibleItems: HistoryBatchOrderItem[],
) {
  return Boolean(getSubmissionTaskKey(pending) && !visibleItems.some((item) => isSameSubmissionBatchTask(pending, item)));
}

export function sortHistoryBySubmissionOrder<T extends HistoryBatchOrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const batchA = getSubmissionBatchMetadata(a);
    const batchB = getSubmissionBatchMetadata(b);
    if (batchA && batchB && batchA.id === batchB.id) return batchA.index - batchB.index;

    const aTime = new Date(batchA?.submittedAt || a.createdAt || 0).getTime();
    const bTime = new Date(batchB?.submittedAt || b.createdAt || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    const groupA = batchA ? `batch:${batchA.id}` : `item:${a.id}`;
    const groupB = batchB ? `batch:${batchB.id}` : `item:${b.id}`;
    if (groupA !== groupB) return groupB.localeCompare(groupA);
    return String(b.id).localeCompare(String(a.id));
  });
}
