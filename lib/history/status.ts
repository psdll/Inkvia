export type HistoryStatusRecord = {
  id: number;
  type: string;
  status: string;
  localPath: string | null;
  displayUrl?: string | null;
  phase?: string | null;
  errorMsg: string | null;
  requestKey?: string | null;
  batchId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  batchSubmittedAt?: string | null;
  createdAt?: string;
  updatedAt: string;
};

export function parseHistoryStatusIds(value: string | null | undefined, limit = 100): number[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!value || safeLimit === 0) return [];
  const seen = new Set<number>();
  for (const part of value.split(",")) {
    const id = Number(part.trim());
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    if (seen.size >= safeLimit) break;
  }
  return Array.from(seen);
}

export function sameHistoryStatusSnapshot(a: HistoryStatusRecord[], b: HistoryStatusRecord[]): boolean {
  if (a.length !== b.length) return false;
  const bById = new Map(b.map((item) => [item.id, item]));
  return a.every((item) => {
    const other = bById.get(item.id);
    return Boolean(
      other &&
      item.type === other.type &&
      item.status === other.status &&
      item.localPath === other.localPath &&
      item.displayUrl === other.displayUrl &&
      item.phase === other.phase &&
      item.errorMsg === other.errorMsg &&
      item.updatedAt === other.updatedAt,
    );
  });
}

export function jitterPollDelay(baseMs: number, random: () => number = Math.random): number {
  const safeBase = Math.max(0, Number.isFinite(baseMs) ? baseMs : 0);
  const ratio = Math.max(0, Math.min(1, random()));
  return Math.round(safeBase * (0.9 + ratio * 0.2));
}
